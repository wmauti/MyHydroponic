# time_manager.py

import datetime
import time
from zoneinfo import ZoneInfo
import requests

tz = ZoneInfo("Europe/Rome")

bridge = None  # inizializzato da init()


def init(shared_bridge):
    """Deve essere chiamato da main.py per condividere lo stesso Bridge."""
    global bridge
    bridge = shared_bridge

MAX_RTC_DRIFT_SEC = 5 * 60
NET_SYNC_INTERVAL_SEC = 10 * 60
RTC_SYNC_INTERVAL_SEC = 60

_last_valid_dt: datetime.datetime | None = None
_last_valid_ts: float = 0.0           # time.time() quando _last_valid_dt è stato salvato
_last_net_sync_ts: float = 0.0
_last_rtc_sync_ts: float = 0.0
_rtc_reliable: bool = True  # False se l'RTC ha drift e scrittura fallita


def read_rtc_datetime() -> datetime.datetime | None:
    try:
        y, m, d, hh, mm, ss = bridge.call("rtc_get_datetime")
        y, m, d, hh, mm, ss = map(int, (y, m, d, hh, mm, ss))

        if not (2000 <= y <= 2100):
            _log_rtc_error_once(f"[RTC] Anno fuori range: {y}")
            return None

        dt_naive = datetime.datetime(y, m, d, hh, mm, ss)
        return dt_naive.replace(tzinfo=tz)

    except Exception as e:
        _log_rtc_error_once(f"[RTC] Errore lettura DS1302: {e}")
        return None


def write_rtc_datetime(dt: datetime.datetime) -> None:
    try:
        dt_local = dt.astimezone(tz)
        bridge.call(
            "rtc_set_datetime",
            int(dt_local.year),
            int(dt_local.month),
            int(dt_local.day),
            int(dt_local.hour),
            int(dt_local.minute),
            int(dt_local.second),
        )
        print(f"[RTC] Inviato aggiornamento DS1302 a {dt_local.isoformat()}")

        # Verifica immediata salvataggio (Opzione 2)
        time.sleep(1) # Attendi 1 secondo per dare il tempo al modulo di salvare
        rtc_check = read_rtc_datetime()
        if rtc_check:
            # Calcola la differenza tra il tempo salvato e quello che volevamo
            # Deve essere meno di 3-4 secondi (dovuto al delay)
            delta = abs((rtc_check - dt_local).total_seconds())
            if delta < 5:
                print(f"[RTC] Verifica salvataggio OK! Ora modulo: {rtc_check.isoformat()}")
            else:
                print(f"[RTC] ATTENZIONE: Salvataggio fallito o modulo bloccato. Differenza di {delta:.0f}s.")
        else:
            print("[RTC] ATTENZIONE: Impossibile rileggere l'RTC per la verifica.")

    except Exception as e:
        print(f"[RTC] Errore scrittura DS1302: {e}")


def get_internet_time() -> datetime.datetime | None:
    """
    Ottiene l'ora da timeapi.io per la zona Europe/Rome.
    Costruiamo direttamente un datetime timezone-aware in Europe/Rome.
    """
    try:
        url = "https://timeapi.io/api/Time/current/zone"
        params = {"timeZone": "Europe/Rome"}
        r = requests.get(url, params=params, timeout=5)
        r.raise_for_status()

        data = r.json()

        dt_local = datetime.datetime(
            year=data["year"],
            month=data["month"],
            day=data["day"],
            hour=data["hour"],
            minute=data["minute"],
            second=data["seconds"],
            microsecond=data["milliSeconds"] * 1000,
            tzinfo=tz,
        )

        return dt_local

    except Exception as e:
        _log_net_error_once(f"[NETTIME] Errore ora internet: {e}")
        return None


def get_current_time() -> datetime.datetime:
    global _last_valid_dt, _last_valid_ts, _last_net_sync_ts, _last_rtc_sync_ts, _rtc_reliable

    now_local = datetime.datetime.now(tz)
    now_ts = time.time()

    # 1) prova sync internet ogni NET_SYNC_INTERVAL_SEC
    if now_ts - _last_net_sync_ts > NET_SYNC_INTERVAL_SEC:
        net_dt = get_internet_time()
        if net_dt is not None:
            _last_net_sync_ts = now_ts
            _last_valid_dt = net_dt
            _last_valid_ts = now_ts

            # sync RTC se serve
            rtc_dt = read_rtc_datetime()
            if rtc_dt is not None:
                delta = abs((net_dt - rtc_dt).total_seconds())
                if delta > MAX_RTC_DRIFT_SEC:
                    print(f"[TIME] Drift RTC {delta:.0f}s → aggiorno DS1302")
                    write_rtc_datetime(net_dt)
                    # Dopo write, rileggiamo per capire se il salvataggio è andato
                    # (write_rtc_datetime già lo fa, ma qui segniamo l'affidabilità)
                    rtc_check = read_rtc_datetime()
                    if rtc_check and abs((net_dt - rtc_check).total_seconds()) < 10:
                        _rtc_reliable = True
                        print("[TIME] RTC aggiornato con successo, lo considero affidabile")
                    else:
                        _rtc_reliable = False
                        print("[TIME] RTC NON aggiornato → lo ignoro fino al prossimo sync internet")
                else:
                    _rtc_reliable = True  # RTC allineato, è affidabile
            else:
                # Log only once or rarely for broken RTC
                _log_rtc_error_once("[TIME] RTC non leggibile, imposto ora internet")
                _rtc_reliable = False
                write_rtc_datetime(net_dt)

            return net_dt
        else:
             _log_net_error_once("[NETTIME] Sync fallito")

    # 2) Sync RTC se serve (ogni RTC_SYNC_INTERVAL_SEC) — solo se RTC è affidabile
    if _rtc_reliable and (_last_valid_dt is None or (now_ts - _last_rtc_sync_ts > RTC_SYNC_INTERVAL_SEC)):
        rtc_dt = read_rtc_datetime()
        if rtc_dt is not None:
            _last_valid_dt = rtc_dt
            _last_valid_ts = now_ts
            _last_rtc_sync_ts = now_ts
            return rtc_dt

    # 3) fallback: ultima valida + tempo trascorso
    if _last_valid_dt is not None:
        elapsed = now_ts - _last_valid_ts
        return _last_valid_dt + datetime.timedelta(seconds=elapsed)

    # 4) fallback finale: system time
    _log_fallback_once("[TIME] Nessuna sorgente affidabile → uso system time")
    return now_local

# Simple rate-limiting for errors
_last_rtc_err_time = 0
_last_net_err_time = 0
_last_fallback_msg = ""
_last_fallback_time = 0

def _log_rtc_error_once(msg: str):
    global _last_rtc_err_time
    # Print max once every 10 minutes
    if time.time() - _last_rtc_err_time > 600:
        print(msg)
        _last_rtc_err_time = time.time()

def _log_net_error_once(msg: str):
    global _last_net_err_time
    if time.time() - _last_net_err_time > 600:
        print(msg)
        _last_net_err_time = time.time()

def _log_fallback_once(msg: str):
    global _last_fallback_msg, _last_fallback_time
    # Print if message changed significantly or time passed
    if msg != _last_fallback_msg or (time.time() - _last_fallback_time > 600):
        print(msg)
        _last_fallback_msg = msg
        _last_fallback_time = time.time()