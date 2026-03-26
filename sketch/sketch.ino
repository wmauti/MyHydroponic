#include <Arduino_RouterBridge.h>
#include <array>
#include <Wire.h>
#include "oled_display.h" // driver OLED SSD1306 128x64 via Adafruit
#include "ds1302.h"     // mini driver RTC DS1302 (3-wire)
#include "ntc_temp.h"   // NTC 10k: lookup, EMA, media mobile

bool lcdReady = false;

// =============================================================
// CONFIGURAZIONE HARDWARE
// =============================================================

namespace Config {
  namespace Pins {
    const uint8_t SENSOR_TEMP        = A2;
    const uint8_t SENSOR_PH          = A0;
    const uint8_t SENSOR_EC          = A1;
    const uint8_t SENSOR_FLOAT       = 13;

    const uint8_t PUMP_PH_DOWN       = 9;
    const uint8_t PUMP_NUTRIENTS     = 5;
    const uint8_t PUMP_RECIRCULATION = 7;
    const uint8_t PUMP_IRRIGATION    = 8;
    const uint8_t VALVE_REFILL       = 6;
  }

  namespace Params {
    const float    VOLTAGE_REFERENCE = 3.3f;
    const uint16_t ADC_MAX           = 16383;   // 14 bit
  }
}

// =============================================================
// OLED - INIT E CALLBACK BRIDGE
// =============================================================

void oledInit() {
  if (oled_begin()) {
    lcdReady = true;
    Monitor.println("OLED OK (0x3C)");
  } else {
    lcdReady = false;
    Monitor.println("[OLED] Init ERRORE: nessun dispositivo SSD1306 trovato.");
  }
}

static void oledEnsureReady(const char* ctx) {
  if (!lcdReady) {
    Monitor.print("[OLED] Non pronto, reinit (");
    Monitor.print(ctx);
    Monitor.println(")");
    oledInit();
  }
}

// Aggiorna zona STATO (callback Bridge: "oled_set_state")
void oledShowState(int code) {
  oledEnsureReady("state");
  if (lcdReady) oled_update_state(code);
}

// Riga 1 zona messaggi (callback Bridge: "oled_msg1")
void oledShowMsg1(String text) {
  oledEnsureReady("msg1");
  if (lcdReady) oled_show_msg1(text);
}

// Riga 2 zona messaggi (callback Bridge: "oled_msg2")
void oledShowMsg2(String text) {
  oledEnsureReady("msg2");
  if (lcdReady) oled_show_msg2(text);
}

// Pulisce zona messaggi (callback Bridge: "oled_clear_msg")
void oledClearMsg() {
  oledEnsureReady("clear");
  if (lcdReady) oled_clear_msg();
}

// Riceve da Python i valori sensori GIÀ convertiti e li invia all'OLED
// array[0]: temp_c | array[1]: ph | array[2]: ec_us | array[3]: 1.0=OK 0.0=LOW
void oledPushSensors(std::array<float, 4> data) {
  if (lcdReady) oled_update_sensors(data[0], data[1], data[2], data[3] >= 0.5f);
}

// =============================================================
// RTC - CALLBACK
// =============================================================

std::array<int32_t, 6> rtc_get_datetime() {
  DS1302_Time t = ds1302_read();
  return { (int32_t)t.year, (int32_t)t.month, (int32_t)t.day,
           (int32_t)t.hour, (int32_t)t.minute, (int32_t)t.second };
}

void rtc_set_datetime(int32_t year, int32_t month, int32_t day,
                      int32_t hour, int32_t minute, int32_t second)
{
  if (year   < 2000 || year   > 2099) { Monitor.print(F("[RTC] year fuori range: "));   Monitor.println(year);   return; }
  if (month  < 1    || month  > 12)   { Monitor.print(F("[RTC] month fuori range: "));  Monitor.println(month);  return; }
  if (day    < 1    || day    > 31)   { Monitor.print(F("[RTC] day fuori range: "));    Monitor.println(day);    return; }
  if (hour   < 0    || hour   > 23)   { Monitor.print(F("[RTC] hour fuori range: "));   Monitor.println(hour);   return; }
  if (minute < 0    || minute > 59)   { Monitor.print(F("[RTC] minute fuori range: ")); Monitor.println(minute); return; }
  if (second < 0    || second > 59)   { Monitor.print(F("[RTC] second fuori range: ")); Monitor.println(second); return; }

  Monitor.print(F("[RTC] set: "));
  Monitor.print(year);   Monitor.print('-');
  Monitor.print(month);  Monitor.print('-');
  Monitor.print(day);    Monitor.print(' ');
  Monitor.print(hour);   Monitor.print(':');
  Monitor.print(minute); Monitor.print(':');
  Monitor.println(second);

  DS1302_Time t = { (uint16_t)year, (uint8_t)month, (uint8_t)day,
                    (uint8_t)hour,  (uint8_t)minute, (uint8_t)second };
  ds1302_write(t);
}

// =============================================================
// POMPE / VALVOLA - CALLBACK
// =============================================================

void startIrrigation()  { digitalWrite(Config::Pins::PUMP_IRRIGATION,    LOW);  Monitor.println("Irrigation ON");  }
void stopIrrigation()   { digitalWrite(Config::Pins::PUMP_IRRIGATION,    HIGH); Monitor.println("Irrigation OFF"); }
void phDownOn()         { digitalWrite(Config::Pins::PUMP_PH_DOWN,       LOW);  Monitor.println("pH-down ON");     }
void phDownOff()        { digitalWrite(Config::Pins::PUMP_PH_DOWN,       HIGH); Monitor.println("pH-down OFF");    }
void nutrientsOn()      { digitalWrite(Config::Pins::PUMP_NUTRIENTS,     LOW);  Monitor.println("Nutrients ON");   }
void nutrientsOff()     { digitalWrite(Config::Pins::PUMP_NUTRIENTS,     HIGH); Monitor.println("Nutrients OFF");  }
void recirculationOn()  { digitalWrite(Config::Pins::PUMP_RECIRCULATION, LOW);  Monitor.println("Recirc ON");      }
void recirculationOff() { digitalWrite(Config::Pins::PUMP_RECIRCULATION, HIGH); Monitor.println("Recirc OFF");     }
void refillValveOn()    { digitalWrite(Config::Pins::VALVE_REFILL,       LOW);  Monitor.println("Refill ON");      }
void refillValveOff()   { digitalWrite(Config::Pins::VALVE_REFILL,       HIGH); Monitor.println("Refill OFF");     }

// =============================================================
// SENSORI - CALLBACK
// =============================================================

std::array<float, 4> get_sensor_data() {
  float temp_c      = ntc_getAverage();
  bool  rawFloat    = (digitalRead(Config::Pins::SENSOR_FLOAT) == HIGH);
  float rawECVoltage = analogRead(Config::Pins::SENSOR_EC)
                     * (Config::Params::VOLTAGE_REFERENCE / (float)Config::Params::ADC_MAX);
  float rawPHVoltage = analogRead(Config::Pins::SENSOR_PH)
                     * (Config::Params::VOLTAGE_REFERENCE / (float)Config::Params::ADC_MAX) * 1000.0f;

  Monitor.print("T:"); Monitor.print(temp_c);
  Monitor.print(" EC:"); Monitor.print(rawECVoltage, 3);
  Monitor.print(" pH_mV:"); Monitor.print(rawPHVoltage, 1);
  Monitor.print(" Float:"); Monitor.println(rawFloat ? "OK" : "LOW");

  return { temp_c, rawECVoltage, rawPHVoltage, rawFloat ? 1.0f : 0.0f };
}

// =============================================================
// SETUP
// =============================================================

void setup() {
  Bridge.begin();
  Monitor.begin(9600);

  ds1302_init();
  if (ds1302_isHalted()) {
    Monitor.println("[RTC] Clock Halt rilevato, avvio clock.");
    ds1302_start();
  } else {
    Monitor.println("[RTC] OK");
  }

  analogReadResolution(14);

  pinMode(Config::Pins::SENSOR_FLOAT,       INPUT_PULLUP);
  pinMode(Config::Pins::PUMP_PH_DOWN,       OUTPUT);
  pinMode(Config::Pins::PUMP_NUTRIENTS,     OUTPUT);
  pinMode(Config::Pins::PUMP_RECIRCULATION, OUTPUT);
  pinMode(Config::Pins::PUMP_IRRIGATION,    OUTPUT);
  pinMode(Config::Pins::VALVE_REFILL,       OUTPUT);

  // Tutto spento all'avvio (logica attiva-bassa)
  digitalWrite(Config::Pins::PUMP_PH_DOWN,       HIGH);
  digitalWrite(Config::Pins::PUMP_NUTRIENTS,     HIGH);
  digitalWrite(Config::Pins::PUMP_RECIRCULATION, HIGH);
  digitalWrite(Config::Pins::PUMP_IRRIGATION,    HIGH);
  digitalWrite(Config::Pins::VALVE_REFILL,       HIGH);

  // Inizializza NTC a 25 °C e prima lettura immediata
  ntc_init(250);
  ntc_update(Config::Pins::SENSOR_TEMP);

  // Registra callback verso Python
  Bridge.provide("get_sensor_data",     get_sensor_data);
  Bridge.provide("ph_down_on",          phDownOn);
  Bridge.provide("ph_down_off",         phDownOff);
  Bridge.provide("nutrients_on",        nutrientsOn);
  Bridge.provide("nutrients_off",       nutrientsOff);
  Bridge.provide("start_recirculation", recirculationOn);
  Bridge.provide("stop_recirculation",  recirculationOff);
  Bridge.provide("refill_on",           refillValveOn);
  Bridge.provide("refill_off",          refillValveOff);
  Bridge.provide("start_irrigation",    startIrrigation);
  Bridge.provide("stop_irrigation",     stopIrrigation);
  Bridge.provide("oled_set_state",      oledShowState);
  Bridge.provide("oled_msg1",           oledShowMsg1);
  Bridge.provide("oled_msg2",           oledShowMsg2);
  Bridge.provide("oled_clear_msg",      oledClearMsg);
  Bridge.provide("oled_push_sensors",   oledPushSensors);  // pH e EC già convertiti da Python
  Bridge.provide("rtc_get_datetime",    rtc_get_datetime);
  Bridge.provide("rtc_set_datetime",    rtc_set_datetime);

  oledInit();
  if (lcdReady) {
    oled_splash("Hydro System", "Avvio...");
    delay(1500);
    oled_clear();  // ridisegna il frame con le slide
  }

  Monitor.println("[Sistema] Pronto.");
}

// =============================================================
// LOOP
// =============================================================

void loop() {
  ntc_loopUpdate(Config::Pins::SENSOR_TEMP);

  // Sincronizza ora RTC sul display ogni secondo
  static uint32_t _rtcSyncMs = 0;
  if (millis() - _rtcSyncMs >= 1000) {
    DS1302_Time t = ds1302_read();
    if (lcdReady) oled_set_rtc_time(t.hour, t.minute, t.second);
    _rtcSyncMs = millis();
  }

  // Health check OLED proattivo ogni 5 minuti
  // Verifica che I2C risponda anche se lcdReady è true (rileva bus lockup)
  static uint32_t _oledCheckMs = 0;
  if (millis() - _oledCheckMs >= 300000UL) {  // ogni 5 min
    _oledCheckMs = millis();
    if (lcdReady) {
      // Verifica proattiva: il bus I2C è ancora vivo?
      if (!oled_healthCheck()) {
        lcdReady = false;
        Monitor.println("[OLED] Health check fallito, display perso.");
      }
    } else {
      // Display già perso: tenta re-init con recovery I2C
      Monitor.println("[OLED] Tentativo re-init periodico...");
      oledInit();
    }
  }

  // Gestisce rotazione e animazione slide OLED
  if (lcdReady) oled_tick();

  // Piccola pausa per non sovraccaricare la CPU (non blocca come delay(100))
  delay(5);
}