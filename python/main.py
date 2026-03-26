import datetime
import math
import time
from enum import Enum
from zoneinfo import ZoneInfo
import os

from arduino.app_bricks.dbstorage_tsstore import TimeSeriesStore
from arduino.app_bricks.web_ui import WebUI
from arduino.app_utils import App, Bridge
from DFRobot_PH import DFRobot_PH
import time_manager
from time_manager import get_current_time

PHDATA_PATH = "phdata.txt"

# =========================
# Gestione file calibrazione pH
# =========================

def ensure_phdata_exists():
    default_neutral = 1500.0
    default_acid    = 2032.44

    # se il file non esiste, crealo con default
    if not os.path.exists(PHDATA_PATH):
        print("[PH] phdata.txt non trovato, lo creo con valori di default.")
        with open(PHDATA_PATH, "w") as f:
            f.write(f"neutralVoltage={default_neutral}\n")
            f.write(f"acidVoltage={default_acid}\n")
        return

    # se esiste, prova a leggerlo; se è corrotto, ricrea
    try:
        with open(PHDATA_PATH, "r") as f:
            neutral_line = f.readline().strip()
            acid_line    = f.readline().strip()

        if not neutral_line.startswith("neutralVoltage=") or not acid_line.startswith("acidVoltage="):
            raise ValueError("Formato phdata.txt non valido")

        float(neutral_line.split("=", 1)[1])
        float(acid_line.split("=", 1)[1])

        print("[PH] phdata.txt trovato e valido.")
    except Exception as e:
        print(f"[PH] phdata.txt invalido ({e}), ricreo con valori di default.")
        with open(PHDATA_PATH, "w") as f:
            f.write(f"neutralVoltage={default_neutral}\n")
            f.write(f"acidVoltage={default_acid}\n")

# =========================
# Config & globali
# =========================

# Istanza bridge verso Arduino
bridge = Bridge()

# Condividi il bridge con time_manager (evita doppie connessioni)
time_manager.init(bridge)

# Time-series DB
db = TimeSeriesStore()

# Web UI
ui = WebUI()

# Espone endpoint REST per la UI (grafici storici)
# Misure discrete/state usano max; valori continui usano mean
_MAX_AGGR_RESOURCES = {"fsm_state", "float_ok", "dosing_ph_before", "dosing_ph_after",
                       "dosing_ec_before", "dosing_ec_after"}

def on_get_samples(resource: str, start: str, aggr_window: str):
    aggr_func = "max" if resource in _MAX_AGGR_RESOURCES else "mean"
    samples = db.read_samples(
        measure=resource,
        start_from=start,
        aggr_window=aggr_window,
        aggr_func=aggr_func,
        limit=500,
    )
    return [{"ts": s[1], "value": s[2]} for s in samples]

ui.expose_api("GET", "/get_samples/{resource}/{start}/{aggr_window}", on_get_samples)

# API per comandi manuali
def on_command(cmd: str):
    print(f"[API] Ricevuto comando: {cmd}")
    if cmd == "start_irrigation":
        enter_state(State.IRRIGATING)
        bridge.call("start_irrigation")
        lcd_show_status(1)
    elif cmd == "stop_all":
        # Ferma tutto e torna in IDLE
        bridge.call("stop_irrigation")
        bridge.call("stop_recirculation")
        bridge.call("refill_off")
        stop_all_dosing()
        enter_state(State.IDLE)
        lcd_show_status(0)
    elif cmd == "start_recirculation":
        enter_state(State.RECIRCULATING)
        bridge.call("start_recirculation")
        lcd_show_status(4)
    elif cmd == "refill_on":
        enter_state(State.REFILLING)
        bridge.call("refill_on")
        lcd_show_status(5)
    elif cmd == "ph_on":
        bridge.call("ph_down_on")
    elif cmd == "ph_off":
        bridge.call("ph_down_off")
    elif cmd == "ec_on":
        bridge.call("nutrients_on")
    elif cmd == "ec_off":
        bridge.call("nutrients_off")
    
    return {"status": "ok", "cmd": cmd}

ui.expose_api("GET", "/api/command/{cmd}", on_command)

# Timezone
tz = ZoneInfo("Europe/Rome")

# Libreria pH
ensure_phdata_exists()
ph_sensor = DFRobot_PH()
ph_sensor.begin()   # legge phdata.txt

# Ore irrigazione automatica (schedule fissa, usate anche in IDLE)
WATERING_HOURS = [7, 8, 9, 10, 11, 12, 13, 15, 16, 17, 18, 19, 21]
irrigated_today = {}  # {hour: [list_of_dates_str]}
_last_cleanup_date = ""  # per pulizia a mezzanotte

# Intervallo lettura sensori (secondi)
interval = 30  # 30 secondi

# =========================
# Conversioni sensori (EC)
# =========================

def ec_from_voltage(ec_v, temperature_c):
    """
    Conversione EC molto semplice (da calibrare sui tuoi sensori).
    Esempio: 0 V -> 0 mS/cm, 2.5 V -> 1.5 mS/cm.
    Sostituisci con i tuoi punti di calibrazione reali.
    """
    EC_VOLTAGE_0 = 0.0      # V a 0 mS/cm (misura reale)
    EC_VOLTAGE_1500 = 1.5   # V a 1500 µS/cm (1.5 mS/cm) (misura reale)

    if ec_v <= EC_VOLTAGE_0:
        return 0.0

    span_v = EC_VOLTAGE_1500 - EC_VOLTAGE_0
    if span_v <= 0:
        return 0.0

    ec_ms = 1.5 * (ec_v - EC_VOLTAGE_0) / span_v  # 0..1.5 mS/cm
    return round(ec_ms, 3)

# =========================
# Macchina a stati
# =========================

class State(Enum):
    IDLE          = 0
    REFILLING     = 1
    IRRIGATING    = 2
    DOSING        = 3
    MIXING        = 4
    RECIRCULATING = 5
    ERROR         = 6
    DRAINING      = 7

state = State.IDLE
state_start_ts = time.time()

# parametri temporali (secondi)
REFILL_TIMEOUT_SEC     = 120      # 5 min
IRRIGATION_SEC         = 180      # 3 min irrigazione
DRAIN_WAIT_SEC         = 300      # 5 min scolo prima del recircolo
RECIRCULATION_SEC      = 120      # 2 min recircolo normale
DOSING_SEC             = 10       # 10 s pompa pH/nutrienti
MIXING_SEC             = 300      # 5 min ricircolo dopo dosaggio
DOSING_COOLDOWN_SEC    = 15 * 60  # 15 min cooldown
ERROR_RECOVERY_SEC     = 30 * 60  # 30 min poi tenta auto-recovery

last_dosing_ph_ts = 0  # timestamp ultimo dosaggio pH
last_dosing_ec_ts = 0  # timestamp ultimo dosaggio EC

# Protezione anti-eccesso dosaggi
MAX_DOSINGS_PER_DAY = 20
dosing_count_today = 0

# Snapshot pH/EC pre-dosaggio (usati per analisi post-dosing)
dosing_ph_before = 0.0
dosing_ec_before = 0.0

def now_ts():
    return time.time()

def enter_state(new_state: State):
    global state, state_start_ts
    state = new_state
    state_start_ts = now_ts()
    ts_ms = int(state_start_ts * 1000)
    # Log evento FSM su InfluxDB
    db.write_sample("fsm_state", float(new_state.value), ts_ms)
    print(f"[FSM] → {state.name}")
    # Notifica la UI del cambio stato
    ui.send_message("state_changed", {"state": state.name})

def elapsed_in_state():
    return now_ts() - state_start_ts

# Logica soglie per capire se serve dosaggio
def need_dosing(ph_value, ec_ms) -> bool:
    """
    Controllo se il dosaggio è necessario.
    Essendo presente solo la pompa del pH- (ph_down), interveniamo
    solo se il pH è troppo alto. L'EC se troppo basso.
    """
    now_ts_val = now_ts()
    
    # Controlla EC
    if ec_ms < 1.0 and (now_ts_val - last_dosing_ec_ts > DOSING_COOLDOWN_SEC):
        return True
        
    # Controlla pH
    if ph_value > 6.5 and (now_ts_val - last_dosing_ph_ts > DOSING_COOLDOWN_SEC):
        return True
        
    return False

def start_dosing(ph_value, ec_ms):
    """
    Decide quale pompa usare. 
    L'EC ha la priorità sul pH. Dopo aver inserito l'EC, il sistema aspetterà
    il tempo di mixing per stabilizzare la soluzione prima di correggere il pH.
    """
    global last_dosing_ec_ts, last_dosing_ph_ts
    now_ts_val = now_ts()
    
    if ec_ms < 1.0 and (now_ts_val - last_dosing_ec_ts > DOSING_COOLDOWN_SEC):
        print("[DOSING] EC basso → nutrients_on (Priorità a EC)")
        bridge.call("nutrients_on")
        last_dosing_ec_ts = now_ts_val
    elif ph_value > 6.5 and (now_ts_val - last_dosing_ph_ts > DOSING_COOLDOWN_SEC):
        print("[DOSING] pH alto → pH_down_on")
        bridge.call("ph_down_on")
        last_dosing_ph_ts = now_ts_val
    else:
        print("[DOSING] nessun dosaggio necessario")

def stop_all_dosing():
    bridge.call("ph_down_off")
    bridge.call("nutrients_off")

# =============================================================
# OLED CHIAMATE (via Bridge → sketch.ino)
# =============================================================

def oled_clear():
    """Pulisce l'area messaggi dell'OLED."""
    try:
        bridge.call("oled_clear_msg")
    except Exception:
        pass

def oled_print_line1(text: str):
    """Scrive nella prima riga dell'area messaggi OLED."""
    try:
        bridge.call("oled_msg1", str(text))
    except Exception:
        pass

def oled_print_line2(text: str):
    """Scrive nella seconda riga dell'area messaggi OLED."""
    try:
        bridge.call("oled_msg2", str(text))
    except Exception:
        pass

def lcd_show_status(code: int):
    """Aggiorna la zona stato OLED con il codice FSM."""
    try:
        bridge.call("oled_set_state", int(code))
    except Exception:
        pass

def update_lcd_from_sensors(temp_c, ec_ms, ph_value, float_ok_bool):
    """Invia all'OLED i valori già calibrati da Python:
       ph_value = pH reale (DFRobot), ec_ms = mS/cm → converti in µS/cm per l'OLED."""
    try:
        bridge.call(
            "oled_push_sensors",
            [
                round(float(temp_c), 1),
                round(float(ph_value), 2),
                round(float(ec_ms * 1000.0), 0),
                float(1.0 if float_ok_bool else 0.0)
            ]
        )
    except Exception as e:
        print(f"[ERROR] OLED Update failed: {e}")

# =========================
# Loop principale
# =========================

def main_loop():
    global dosing_count_today, dosing_ph_before, dosing_ec_before, _last_cleanup_date

    # Cache per i sensori (usati dalla FSM tra una lettura e l'altra)
    temp_c = 25.0
    ph_value = 7.0
    ec_ms = 0.0
    ph_mv = 0.0
    ec_v = 0.0
    float_ok_bool = True

    # Timestamp prossima lettura sensori
    next_sensor_read_ts = 0
    # Heartbeat log (per debug remoto)
    last_heartbeat_ts = 0

    while True:
      try:
        now_ts_val = now_ts()

        # Heartbeat ogni 5 minuti
        if now_ts_val - last_heartbeat_ts >= 300:
            last_heartbeat_ts = now_ts_val
            print(f"[HEARTBEAT] State={state.name}, uptime_state={int(elapsed_in_state())}s, dosings={dosing_count_today}")
        
        # -------------------------------------------------
        # 0. Broadcast Orario alla UI (ogni ciclo ~1s)
        # -------------------------------------------------
        now_dt = get_current_time() # Ottimizzato in time_manager
        # Formato HH:MM:SS per l'orologio
        time_str = now_dt.strftime("%H:%M:%S")
        ui.send_message("server_time", {"time": time_str})

        # Pulizia irrigated_today a mezzanotte (evita memory leak)
        # IMPORTANTE: solo se la data avanza (evita reset da RTC con data sbagliata)
        today_str_check = now_dt.strftime("%Y-%m-%d")
        if today_str_check != _last_cleanup_date and today_str_check > _last_cleanup_date:
            _last_cleanup_date = today_str_check
            irrigated_today.clear()
            dosing_count_today = 0
            print(f"[MAINT] Pulizia irrigated_today e dosing_count per nuovo giorno: {today_str_check}")

        # -------------------------------------------------
        # 1. Lettura Sensori (solo se intervallo scaduto)
        # -------------------------------------------------
        if now_ts_val >= next_sensor_read_ts:
            # print("DEBUG: Reading sensors...") # Decommentare se serve
            try:
                # Richiesta sensori grezzi ad Arduino (RPC)
                data = bridge.call("get_sensor_data")
                # print("[DEBUG] data from get_sensor_data:", data) 

                if data and len(data) == 4:
                    raw_temp, raw_ec, raw_ph, raw_float = data
                    
                    # Aggiorno cache
                    t_c = float(raw_temp) if raw_temp is not None else 25.0
                    temp_c = t_c

                    ph_mv = float(raw_ph)
                    ec_v = float(raw_ec)
                    float_ok_val = float(raw_float)
                    float_ok_bool = (float_ok_val >= 0.5)

                    # Conversione
                    ph_value = ph_sensor.read_PH(ph_mv, temp_c)
                    ec_ms    = ec_from_voltage(ec_v, temp_c)

                    # Log console pulito (una riga)
                    print(
                        f"[SENSOR] T={temp_c:.1f}°C, "
                        f"pH={ph_value:.2f}, "
                        f"EC={ec_ms:.2f} mS, "
                        f"Lvl={'OK' if float_ok_bool else 'LOW'}"
                    )

                    # Scrittura DB e UI
                    ts_ms = int(now_ts_val * 1000)
                    
                    # DB
                    db.write_sample("temp_c",   float(temp_c),      ts_ms)
                    db.write_sample("ph_mv",    float(ph_mv),       ts_ms)
                    db.write_sample("ph_value", float(ph_value),    ts_ms)
                    db.write_sample("ec_v",     float(ec_v),        ts_ms)
                    db.write_sample("ec_ms",    float(ec_ms),       ts_ms)
                    db.write_sample("float_ok", int(float_ok_bool), ts_ms)

                    # UI updates
                    ui.send_message("temp_c",   {"value": float(temp_c),    "ts": ts_ms})
                    ui.send_message("ph_mv",    {"value": float(ph_mv),     "ts": ts_ms})
                    ui.send_message("ph_value", {"value": float(ph_value),  "ts": ts_ms})
                    ui.send_message("ec_v",     {"value": float(ec_v),      "ts": ts_ms})
                    ui.send_message("ec_ms",    {"value": float(ec_ms),     "ts": ts_ms})
                    ui.send_message("float_ok", {"value": int(float_ok_bool),"ts": ts_ms})

                    # Aggiornamento LCD immediato dopo lettura
                    update_lcd_from_sensors(temp_c, ec_ms, ph_value, float_ok_bool)            
            except Exception as e:
                print(f"[ERROR] Errore lettura sensori: {e}")

            # Programma prossima lettura
            next_sensor_read_ts = now_ts_val + interval

        # -------------------------------------------------
        # 4. MACCHINA A STATI (High Frequency Check)
        # -------------------------------------------------
        # La FSM usa i valori in cache (temp_c, ph_value, etc.)
        
        lvl_ok = float_ok_bool
        # now_dt è già aggiornato sopra

        if state == State.IDLE:
            # Mostra stato su LCD solo se cambia (opzionale, qui evito spam RPC)
            # lcd_show_status(0) 

            # a) Controllo livello → REFILLING
            if not lvl_ok:
                print("[FSM] IDLE: livello basso → REFILLING")
                bridge.call("refill_on")
                enter_state(State.REFILLING)
                lcd_show_status(5)  # REFILL

            else:
                # b) Irrigazione oraria con schedule fissa
                if now_dt.hour in WATERING_HOURS:
                    today_str = now_dt.strftime("%Y-%m-%d")
                    days_for_hour = irrigated_today.get(now_dt.hour, [])
                    if today_str not in days_for_hour:
                        print(f"[AUTO] Irrigazione programmata ore {now_dt.hour}:00!")
                        bridge.call("start_irrigation")
                        irrigated_today.setdefault(now_dt.hour, []).append(today_str)
                        enter_state(State.IRRIGATING)
                        lcd_show_status(1)  # IRRIG.

                # c) Dosaggio pH/EC con cooldown
                elif need_dosing(ph_value, ec_ms):
                    # Protezione anti-eccesso
                    if dosing_count_today >= MAX_DOSINGS_PER_DAY:
                        print(f"[SAFETY] Max dosaggi giornalieri ({MAX_DOSINGS_PER_DAY}) raggiunto → blocco dosaggio")
                    else:
                        print("[FSM] IDLE: serve DOSING")
                        # Snapshot pH/EC pre-dosaggio
                        dosing_ph_before = ph_value
                        dosing_ec_before = ec_ms
                        ts_snap = int(now_ts_val * 1000)
                        db.write_sample("dosing_ph_before", float(ph_value), ts_snap)
                        db.write_sample("dosing_ec_before", float(ec_ms), ts_snap)
                        start_dosing(ph_value, ec_ms)
                        enter_state(State.DOSING)
                        lcd_show_status(2)  # DOSING

                # d) Ricircolo orario (es. ogni ora al minuto 0)
                elif now_dt.minute == 0 and now_dt.second < 30: 
                    # Tolleranza 30s per beccare il minuto 0
                    print("[FSM] IDLE: ricircolo orario → RECIRCULATING")
                    bridge.call("start_recirculation")
                    enter_state(State.RECIRCULATING)
                    lcd_show_status(4)  # RICIRC.

        elif state == State.REFILLING:
            if lvl_ok:
                print("[FSM] REFILLING: livello OK → IDLE")
                bridge.call("refill_off")
                enter_state(State.IDLE)
                lcd_show_status(0)
            elif elapsed_in_state() > REFILL_TIMEOUT_SEC and REFILL_TIMEOUT_SEC > 0:
                print("[FSM] REFILLING: TIMEOUT → ERROR")
                bridge.call("refill_off")
                enter_state(State.ERROR)
                lcd_show_status(6)

        elif state == State.IRRIGATING:
            if elapsed_in_state() > IRRIGATION_SEC and IRRIGATION_SEC > 0:
                print("[FSM] IRRIGATING: fine irrigazione → drain (DRAINING)")
                bridge.call("stop_irrigation")
                enter_state(State.DRAINING)
                lcd_show_status(7)

        elif state == State.DRAINING:
            if elapsed_in_state() > DRAIN_WAIT_SEC and DRAIN_WAIT_SEC > 0:
                print("[FSM] DRAINING: fine scolo → RECIRCULATING")
                bridge.call("start_recirculation")
                enter_state(State.RECIRCULATING)
                lcd_show_status(4)

        elif state == State.DOSING:
            if elapsed_in_state() > DOSING_SEC and DOSING_SEC > 0:
                print("[FSM] DOSING: fine dosaggio → MIXING")
                stop_all_dosing()
                dosing_count_today += 1
                print(f"[DOSING] Dosaggi oggi: {dosing_count_today}/{MAX_DOSINGS_PER_DAY}")
                bridge.call("start_recirculation")
                enter_state(State.MIXING)
                lcd_show_status(3)

        elif state == State.MIXING:
            if elapsed_in_state() > MIXING_SEC and MIXING_SEC > 0:
                print("[FSM] MIXING: fine mixing → IDLE")
                # Snapshot pH/EC post-dosaggio
                ts_snap = int(now_ts_val * 1000)
                db.write_sample("dosing_ph_after", float(ph_value), ts_snap)
                db.write_sample("dosing_ec_after", float(ec_ms), ts_snap)
                bridge.call("stop_recirculation")
                enter_state(State.IDLE)
                lcd_show_status(0)

        elif state == State.RECIRCULATING:
            if elapsed_in_state() > RECIRCULATION_SEC and RECIRCULATION_SEC > 0:
                print("[FSM] RECIRCULATING: fine recircolo → IDLE")
                bridge.call("stop_recirculation")
                enter_state(State.IDLE)
                lcd_show_status(0)

        elif state == State.ERROR:
            if elapsed_in_state() > ERROR_RECOVERY_SEC:
                print(f"[FSM] ERROR: auto-recovery dopo {ERROR_RECOVERY_SEC}s → IDLE")
                # Spegni tutto per sicurezza prima di tornare in IDLE
                bridge.call("stop_irrigation")
                bridge.call("stop_recirculation")
                bridge.call("refill_off")
                stop_all_dosing()
                enter_state(State.IDLE)
                lcd_show_status(0)

        # 5. Sleep breve per reattività
        time.sleep(1.0)

      except Exception as e:
        print(f"[LOOP ERROR] {e}")
        # Non crashare, riprova al prossimo ciclo
        time.sleep(2.0)

# =========================
# Entry point App Lab
# =========================

def app_main():
    main_loop()

print("Starting App...")
App.run(app_main)