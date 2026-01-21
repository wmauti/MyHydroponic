# time_manager.py

import datetime
import time
from zoneinfo import ZoneInfo
from arduino.app_utils import Bridge  # stesso Bridge che usi in main.py
import requests

tz = ZoneInfo("Europe/Rome")

bridge = Bridge()   # ← come in main.py

MAX_RTC_DRIFT_SEC = 5 * 60
NET_SYNC_INTERVAL_SEC = 10 * 60

_last_valid_dt: datetime.datetime | None = None
_last_net_sync_ts: float = 0.0


def read_rtc_datetime() -> datetime.datetime | None:
    try:
        y, m, d, hh, mm, ss = bridge.call("rtc_get_datetime")
        y, m, d, hh, mm, ss = map(int, (y, m, d, hh, mm, ss))

        if not (2000 <= y <= 2100):
            print(f"[RTC] Anno fuori range: {y}")
            return None

        dt_naive = datetime.datetime(y, m, d, hh, mm, ss)
        return dt_naive.replace(tzinfo=tz)

    except Exception as e:
        print(f"[RTC] Errore lettura DS1302: {e}")
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
        print(f"[RTC] Aggiornato DS1302 a {dt_local.isoformat()}")

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
        r = requests.get(url, params=params, timeout=15)
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
        print(f"[NETTIME] Errore ora internet: {e}")
        return None


def get_current_time() -> datetime.datetime:
    global _last_valid_dt, _last_net_sync_ts

    now_local = datetime.datetime.now(tz)
    now_ts = time.time()

    # 1) prova sync internet ogni NET_SYNC_INTERVAL_SEC
    if now_ts - _last_net_sync_ts > NET_SYNC_INTERVAL_SEC:
        net_dt = get_internet_time()
        if net_dt is not None:
            _last_net_sync_ts = now_ts
            _last_valid_dt = net_dt

            # sync RTC se serve
            rtc_dt = read_rtc_datetime()
            if rtc_dt is not None:
                delta = abs((net_dt - rtc_dt).total_seconds())
                if delta > MAX_RTC_DRIFT_SEC:
                    print(f"[TIME] Drift RTC {delta:.0f}s → aggiorno DS1302")
                    write_rtc_datetime(net_dt)
            else:
                print("[TIME] RTC non leggibile, imposto ora internet")
                write_rtc_datetime(net_dt)

            return net_dt

    # 2) niente internet / non è momento → RTC
    rtc_dt = read_rtc_datetime()
    if rtc_dt is not None:
        _last_valid_dt = rtc_dt
        return rtc_dt

    # 3) fallback: ultima valida
    if _last_valid_dt is not None:
        print("[TIME] Internet KO e RTC KO → uso ultima ora valida")
        return _last_valid_dt

    # 4) fallback finale: system time
    print("[TIME] Nessuna sorgente affidabile → uso system time")
    return now_local