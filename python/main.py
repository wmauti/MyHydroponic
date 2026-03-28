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

# Time-series DB
db = TimeSeriesStore()

# Web UI
ui = WebUI()

# Espone endpoint REST per la UI (grafici storici)
def on_get_samples(resource: str, start: str, aggr_window: str):
    samples = db.read_samples(
        measure=resource,
        start_from=start,
        aggr_window=aggr_window,
        aggr_func="mean",
        limit=100,
    )
    return [{"ts": s[1], "value": s[2]} for s in samples]

ui.expose_api("GET", "/get_samples/{resource}/{start}/{aggr_window}", on_get_samples)

# API per comandi manuali
def on_command(cmd: str):
    print(f"[API] Ricevuto comando: {cmd}")
    if cmd == "start_irrigation":
        enter_state(State.IRRIGATING)
        bridge.call("start_irrigation")
        set_pump("irrigation", True)
        lcd_show_status(1)
    elif cmd == "stop_all":
        bridge.call("stop_irrigation")
        bridge.call("stop_recirculation")
        bridge.call("refill_off")
        stop_all_dosing()
        for p in pump_status:
            set_pump(p, False)
        enter_state(State.IDLE)
        lcd_show_status(0)
    elif cmd == "start_recirculation":
        enter_state(State.RECIRCULATING)
        bridge.call("start_recirculation")
        set_pump("recirculation", True)
        lcd_show_status(4)
    elif cmd == "refill_on":
        enter_state(State.REFILLING)
        bridge.call("refill_on")
        set_pump("refill", True)
        lcd_show_status(5)
    
    return {"status": "ok", "cmd": cmd}

ui.expose_api("GET", "/api/command/{cmd}", on_command)

# API per stato sistema (pompe, prossima irrigazione, config)
def on_system_status():
    now_dt = get_current_time()
    hour_now = now_dt.hour
    today_str = now_dt.strftime("%Y-%m-%d")

    # Calcola prossima irrigazione
    next_irrig = None
    for h in sorted(WATERING_HOURS):
        if h > hour_now:
            days_for_hour = irrigated_today.get(h, [])
            if today_str not in days_for_hour:
                next_irrig = f"{h:02d}:00"
                break
    if next_irrig is None:
        next_irrig = f"{sorted(WATERING_HOURS)[0]:02d}:00 (domani)"

    return {
        "state": state.name,
        "state_elapsed_sec": round(elapsed_in_state()),
        "pumps": pump_status,
        "next_irrigation": next_irrig,
        "watering_hours": WATERING_HOURS,
        "thresholds": {
            "ph_min": PH_MIN, "ph_max": PH_MAX,
            "ec_min": EC_MIN, "ec_max": EC_MAX,
        },
        "uptime_sec": round(time.time() - _app_start_ts),
        "sensor_interval": interval,
    }

ui.expose_api("GET", "/api/system_status", on_system_status)

# API per aggiornamento configurazione da UI
def on_update_config(ph_min: str = "", ph_max: str = "", ec_min: str = "", ec_max: str = "", sensor_interval: str = ""):
    global PH_MIN, PH_MAX, EC_MIN, EC_MAX, interval
    try:
        if ph_min: PH_MIN = float(ph_min)
        if ph_max: PH_MAX = float(ph_max)
        if ec_min: EC_MIN = float(ec_min)
        if ec_max: EC_MAX = float(ec_max)
        if sensor_interval: interval = max(5, int(sensor_interval))
        print(f"[CONFIG] Aggiornato: pH [{PH_MIN}-{PH_MAX}], EC [{EC_MIN}-{EC_MAX}], interval={interval}s")
        return {"status": "ok"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

ui.expose_api("GET", "/api/config/update", on_update_config)

# Timezone
tz = ZoneInfo("Europe/Rome")

# Libreria pH
ensure_phdata_exists()
ph_sensor = DFRobot_PH()
ph_sensor.begin()   # legge phdata.txt

# Ore irrigazione automatica (schedule fissa, usate anche in IDLE)
WATERING_HOURS = [7, 8, 9, 10, 11, 12, 13, 15, 16, 17, 18, 19, 21]
irrigated_today = {}  # {hour: [list_of_dates_str]}

# Intervallo lettura sensori (secondi)
interval = 30  # 30 secondi

# Soglie dosaggio (modificabili da UI)
PH_MIN = 5.5
PH_MAX = 6.5
EC_MIN = 1.0
EC_MAX = 2.0

# Stato pompe in tempo reale
pump_status = {
    "irrigation": False,
    "ph_down": False,
    "nutrients": False,
    "recirculation": False,
    "refill": False,
}

# Timestamp avvio app
_app_start_ts = time.time()

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
    EC_VOLTAGE_1500 = 2.5   # V a 1500 µS/cm (1.5 mS/cm) (misura reale)

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
REFILL_TIMEOUT_SEC     = 0   # 120      # 5 min
IRRIGATION_SEC         = 0   # 180      # 3 min irrigazione
DRAIN_WAIT_SEC         = 0   # 300      # 5 min scolo prima del recircolo
RECIRCULATION_SEC      = 0   # 120      # 2 min recircolo normale
DOSING_SEC             = 0   # 10       # 10 s pompa pH/nutrienti
MIXING_SEC             = 0   # 300      # 5 min ricircolo dopo dosaggio
DOSING_COOLDOWN_SEC    = 0   # 15 * 60  # 15 min cooldown

last_dosing_ts = 0  # timestamp ultimo dosaggio

def now_ts():
    return time.time()

def set_pump(name, on):
    pump_status[name] = on
    ui.send_message("pump_status", pump_status)

def enter_state(new_state: State):
    global state, state_start_ts
    state = new_state
    state_start_ts = now_ts()
    print(f"[FSM] → {state.name}")
    ui.send_message("state_changed", {"state": state.name})

def elapsed_in_state():
    return now_ts() - state_start_ts

# Logica soglie per capire se serve dosaggio
def need_dosing(ph_value, ec_ms) -> bool:
    if ph_value < PH_MIN or ph_value > PH_MAX:
        return True
    if ec_ms < EC_MIN or ec_ms > EC_MAX:
        return True
    return False

def start_dosing(ph_value, ec_ms):
    """
    Decide quale pompa usare. Qui un esempio base:
    - se pH troppo alto: pH_down_on
    - se EC troppo basso: nutrients_on
    """
    if ph_value > PH_MAX:
        print("[DOSING] pH alto → pH_down_on")
        bridge.call("ph_down_on")
        set_pump("ph_down", True)
    elif ec_ms < EC_MIN:
        print("[DOSING] EC basso → nutrients_on")
        bridge.call("nutrients_on")
        set_pump("nutrients", True)
    else:
        print("[DOSING] nessun dosaggio necessario")

def stop_all_dosing():
    bridge.call("ph_down_off")
    bridge.call("nutrients_off")

# =============================================================
# LCD CHIAMATE
# =============================================================

def lcd_clear():
    bridge.call("lcd_clear")

def lcd_print_line1(text: str):
    bridge.call("lcd_print_line1", text[:16])

def lcd_print_line2(text: str):
    bridge.call("lcd_print_line2", text[:16])

def lcd_show_status(code: int):
    lcd_clear()
    bridge.call("lcd_show_status", int(code))

def update_lcd_from_sensors():
    # usa direttamente get_sensor_data (ritorna gli stessi valori usati sotto)
    temp_c, ec_v, ph_mv, float_ok = bridge.call("get_sensor_data")

    # Riga 1: T e livello acqua
    line1 = f"T:{temp_c:4.1f}C H2O:{'OK ' if float_ok >= 0.5 else 'LOW'}"

    # Riga 2: EC e pH (ridotto a 16 char)
    line2 = f"EC:{ec_v:4.2f}V pH:{ph_mv/1000:4.2f}"

    lcd_print_line1(line1)
    lcd_print_line2(line2)

# =========================
# Loop principale
# =========================

def main_loop():
    global last_dosing_ts

    while True:
        print("DEBUG PRIMA DI CHIAMARE get_current_time")
        now_dt = get_current_time()
        print("DEBUG ORA RICEVUTA DAL TIME_MANAGER:", now_dt)

        # 1. Richiesta sensori grezzi ad Arduino (RPC)
        data = bridge.call("get_sensor_data")
        print("[DEBUG] data from get_sensor_data:", data)

        # Atteso: [temp_c, ec_v, ph_mv, float_ok]
        temp_c, ec_v, ph_mv, float_ok = data

        temp_c   = float(temp_c)
        ec_v     = float(ec_v)
        ph_mv    = float(ph_mv)
        float_ok = float(float_ok)

        float_ok_bool = (float_ok >= 0.5)

        # 1.a Temperatura (già calcolata in °C da Arduino)
        temperature_c = temp_c if temp_c is not None else 25.0

        # 1.b pH ed EC con la nuova temperatura
        ph_value = ph_sensor.read_PH(ph_mv, temperature_c)
        ec_ms    = ec_from_voltage(ec_v, temperature_c)

        ts = int(datetime.datetime.now(tz).timestamp() * 1000)

        # 2. Scrittura su DB
        db.write_sample("temp_c",   float(temperature_c), ts)
        db.write_sample("ph_mv",    float(ph_mv),         ts)
        db.write_sample("ph_value", float(ph_value),      ts)
        db.write_sample("ec_v",     float(ec_v),          ts)
        db.write_sample("ec_ms",    float(ec_ms),         ts)
        db.write_sample("float_ok", int(float_ok_bool),   ts)

        # 3. Realtime WebUI
        ui.send_message("temp_c",   {"value": float(temperature_c), "ts": ts})
        ui.send_message("ph_mv",    {"value": float(ph_mv),         "ts": ts})
        ui.send_message("ph_value", {"value": float(ph_value),      "ts": ts})
        ui.send_message("ec_v",     {"value": float(ec_v),          "ts": ts})
        ui.send_message("ec_ms",    {"value": float(ec_ms),         "ts": ts})
        ui.send_message("float_ok", {"value": int(float_ok_bool),   "ts": ts})
        ui.send_message("pump_status", pump_status)
        ui.send_message("server_time", {"time": now_dt.strftime("%H:%M:%S")})

        print(
            f"[SENSOR] T={temperature_c:.2f}°C, "
            f"pH={ph_value:.2f} ({ph_mv:.1f} mV), "
            f"EC={ec_ms:.3f} mS/cm ({ec_v:.3f} V), "
            f"Float_OK={float_ok_bool}"
        )

        # 3.b Aggiornamento LCD da Python
        update_lcd_from_sensors()

        # 4. MACCHINA A STATI
        lvl_ok = float_ok_bool
        now_dt = get_current_time()

        if state == State.IDLE:
            # opzionale: mostra esplicitamente lo stato IDLE
            lcd_show_status(0)

            # a) Controllo livello → REFILLING
            if not lvl_ok:
                print("[FSM] IDLE: livello basso → REFILLING")
                bridge.call("refill_on")
                set_pump("refill", True)
                enter_state(State.REFILLING)
                lcd_show_status(5)

            else:
                # b) Irrigazione oraria con schedule fissa
                if now_dt.hour in WATERING_HOURS:
                    today_str = now_dt.strftime("%Y-%m-%d")
                    days_for_hour = irrigated_today.get(now_dt.hour, [])
                    if today_str not in days_for_hour:
                        print(f"[AUTO] Irrigazione programmata ore {now_dt.hour}:00!")
                        bridge.call("start_irrigation")
                        set_pump("irrigation", True)
                        irrigated_today.setdefault(now_dt.hour, []).append(today_str)
                        enter_state(State.IRRIGATING)
                        lcd_show_status(1)

                # c) Dosaggio pH/EC con cooldown
                elif need_dosing(ph_value, ec_ms) and (now_ts() - last_dosing_ts > DOSING_COOLDOWN_SEC):
                    print("[FSM] IDLE: serve DOSING")
                    start_dosing(ph_value, ec_ms)
                    enter_state(State.DOSING)
                    lcd_show_status(2)

                # d) Ricircolo orario
                elif now_dt.minute == 0 and now_dt.second < 30:
                    print("[FSM] IDLE: ricircolo orario → RECIRCULATING")
                    bridge.call("start_recirculation")
                    set_pump("recirculation", True)
                    enter_state(State.RECIRCULATING)
                    lcd_show_status(4)

        elif state == State.REFILLING:
            if lvl_ok:
                print("[FSM] REFILLING: livello OK → IDLE")
                bridge.call("refill_off")
                set_pump("refill", False)
                enter_state(State.IDLE)
                lcd_show_status(0)
            elif elapsed_in_state() > REFILL_TIMEOUT_SEC:
                print("[FSM] REFILLING: TIMEOUT → ERROR")
                bridge.call("refill_off")
                set_pump("refill", False)
                enter_state(State.ERROR)
                lcd_show_status(6)

        elif state == State.IRRIGATING:
            if elapsed_in_state() > IRRIGATION_SEC:
                print("[FSM] IRRIGATING: fine → DRAINING")
                bridge.call("stop_irrigation")
                set_pump("irrigation", False)
                enter_state(State.DRAINING)
                lcd_show_status(7)

        elif state == State.DRAINING:
            if elapsed_in_state() > DRAIN_WAIT_SEC:
                print("[FSM] DRAINING: fine → RECIRCULATING")
                bridge.call("start_recirculation")
                set_pump("recirculation", True)
                enter_state(State.RECIRCULATING)
                lcd_show_status(4)

        elif state == State.DOSING:
            if elapsed_in_state() > DOSING_SEC:
                print("[FSM] DOSING: fine → MIXING")
                stop_all_dosing()
                set_pump("ph_down", False)
                set_pump("nutrients", False)
                last_dosing_ts = now_ts()
                bridge.call("start_recirculation")
                set_pump("recirculation", True)
                enter_state(State.MIXING)
                lcd_show_status(3)

        elif state == State.MIXING:
            if elapsed_in_state() > MIXING_SEC:
                print("[FSM] MIXING: fine → IDLE")
                bridge.call("stop_recirculation")
                set_pump("recirculation", False)
                enter_state(State.IDLE)
                lcd_show_status(0)

        elif state == State.RECIRCULATING:
            if elapsed_in_state() > RECIRCULATION_SEC:
                print("[FSM] RECIRCULATING: fine → IDLE")
                bridge.call("stop_recirculation")
                set_pump("recirculation", False)
                enter_state(State.IDLE)
                lcd_show_status(0)

        elif state == State.ERROR:
            print("[FSM] ERROR: sistema bloccato, richiede intervento")
            lcd_show_status(6)  # ERROR
            # reset manuale via UI/API:
            # enter_state(State.IDLE)

        # 5. intervallo letture sensori
        time.sleep(interval)

# =========================
# Entry point App Lab
# =========================

def app_main():
    main_loop()

print("Starting App...")
App.run(app_main)