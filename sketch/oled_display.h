/*******************************************************************************
 * oled_display.h — OLED SSD1306 128×64 | Layout a slide rotanti
 *
 * Layout pixel (font 1 → 6×8 px, ~21 col × 8 righe):
 *
 *  y= 0 │ HYDRO  HH:MM:SS       │ Header fisso + ora da RTC DS1302
 *  y= 8 ├───────────────────────┤
 *  y= 9 │ ● STATO               │ Zona STATO (FSM)
 *  y=17 ├───────────────────────┤
 *  y=18 │  ← contenuto slide →  │ Area scorrevole (46 px):
 *       │  Slide 0: Temperatura  │   °C
 *       │  Slide 1: pH           │   unità pH 0-14
 *       │  Slide 2: EC           │   µS/cm
 *       │  Slide 3: Livello      │
 *
 * API pubblica:
 *   oled_begin()                     — init, disegna frame, true se OK
 *   oled_set_rtc_time(h, m, s)       — aggiorna ora visualizzata (da DS1302)
 *   oled_update_state(int)           — aggiorna zona stato FSM
 *   oled_update_sensors(f,f,f,bool)  — aggiorna valori sensori (slide)
 *   oled_show_msg1(String&)          — scrive riga 1 nell'area contenuto
 *   oled_show_msg2(String&)          — scrive riga 2 nell'area contenuto
 *   oled_clear_msg()                 — ripristina slide corrente
 *   oled_splash(char*,char*)         — schermata avvio
 *   oled_clear()                     — pulizia totale + ridisegna frame
 *   oled_tick()                      — chiama nel loop() per animare le slide
 *
 * Calibrazione sensori (modifica se necessario):
 *   PH_NEUTRAL_MV  — tensione a pH 7 in mV         (default 2500)
 *   PH_SLOPE_MV    — sensibilità mV/pH              (default 59.16)
 *   EC_CELL_K      — costante cella EC (µS·cm/V)    (default 1000)
 ******************************************************************************/
#pragma once

#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// ── Configurazione hardware ────────────────────────────────────────────────
#define OLED_W      128
#define OLED_H       64
#define OLED_RESET   -1
#define OLED_ADDR    0x3C     // AZDelivery default (alternativa: 0x3D)


// ── Parametri slide ────────────────────────────────────────────────────────
#define _NUM_SLIDES      4
#define _SLIDE_HOLD_MS   3000
#define _SLIDE_STEP_PX   8      // era 4: meno frame per transizione (6 vs 12)
#define _CONTENT_TOP     18
#define _CONTENT_H       46
#define _OLED_REFRESH_MS 500    // refresh statico ogni 500ms (2 FPS, era ~10 FPS)

static Adafruit_SSD1306 _oled(OLED_W, OLED_H, &Wire, OLED_RESET);

// ── Stato interno ──────────────────────────────────────────────────────────
static uint8_t  _currentSlide = 0;
static uint32_t _slideTimer   = 0;
static uint32_t _lastRefreshMs = 0;   // per limitare refresh statico

// Ora RTC (aggiornata via oled_set_rtc_time)
static uint8_t _rtcH = 0, _rtcM = 0, _rtcS = 0;

// Valori sensori convertiti
static float   _gTempC  = 0.0f;    // °C
static float   _gPH     = 7.0f;    // unità pH  (convertita da mV)
static float   _gECus   = 0.0f;    // µS/cm     (convertita da V)
static bool    _gLevel  = true;
static uint8_t _gStateCode = 0;

// ── Etichette stato FSM ────────────────────────────────────────────────────
static const char* const _STATE_LABELS[] = {
  "IDLE", "IRRIGAZIONE", "DOSAGGIO", "MISCELAZIONE",
  "RICIRCOLO", "RICARICA", "ERRORE", "SCARICO"
};

// ── Utility interne ────────────────────────────────────────────────────────

static void _oledFill(int16_t y, int16_t h) {
  _oled.fillRect(0, y, OLED_W, h, SSD1306_BLACK);
}

static void _oledText(int16_t y, const char* str) {
  _oled.setCursor(0, y);
  _oled.setTextColor(SSD1306_WHITE);
  _oled.setTextSize(1);
  char buf[22];
  strncpy(buf, str, 21);
  buf[21] = '\0';
  _oled.print(buf);
}

// ── Stampa ora RTC memorizzata (HH:MM:SS) ─────────────────────────────────
static void _printRtcTime() {
  char buf[9];
  snprintf(buf, sizeof(buf), "%02u:%02u:%02u", _rtcH, _rtcM, _rtcS);
  _oled.print(buf);
}

// ── Ripristina header + separatori + zona stato (y 0÷17) ──────────────────
static void _repairFixedZones() {
  _oled.fillRect(0, 0, OLED_W, _CONTENT_TOP, SSD1306_BLACK);
  _oled.setTextColor(SSD1306_WHITE);
  _oled.setTextSize(1);

  _oled.setCursor(0, 0);
  _oled.print(F("HYDRO  "));
  _printRtcTime();

  //_oled.drawFastHLine(0, 8, OLED_W, SSD1306_WHITE);

  const char* lbl = (_gStateCode <= 7) ? _STATE_LABELS[_gStateCode] : "???";
  char sbuf[18];
  snprintf(sbuf, sizeof(sbuf), "\x07 %s", lbl);
  _oled.setCursor(0, 9);
  _oled.print(sbuf);

  //_oled.drawFastHLine(0, 17, OLED_W, SSD1306_WHITE);
}

// ── Aggiorna solo l'ora nell'header ───────────────────────────────────────
static void _updateHeader() {
  _oled.fillRect(42, 0, OLED_W - 42, 8, SSD1306_BLACK);
  _oled.setTextColor(SSD1306_WHITE);
  _oled.setTextSize(1);
  _oled.setCursor(42, 0);
  _printRtcTime();
}

// ── Aggiorna solo la zona stato (y 9-16) ──────────────────────────────────
static void _updateStateZone() {
  _oled.fillRect(0, 9, OLED_W, 8, SSD1306_BLACK);
  const char* lbl = (_gStateCode <= 7) ? _STATE_LABELS[_gStateCode] : "???";
  char sbuf[18];
  snprintf(sbuf, sizeof(sbuf), "\x07 %s", lbl);
  _oled.setTextColor(SSD1306_WHITE);
  _oled.setTextSize(1);
  _oled.setCursor(0, 9);
  _oled.print(sbuf);
}

// ── Renderizza una slide con yBase come origine ────────────────────────────
static void _drawSlide(uint8_t slide, int16_t yBase) {
  char buf[16];
  _oled.setTextColor(SSD1306_WHITE);

  switch (slide) {
    case 0: {  // ── TEMPERATURA ──────────────────────────────────────────
      _oled.setTextSize(1);
      _oled.setCursor(2, yBase + 2);
      _oled.print(F("\xb0 TEMPERATURA"));
      _oled.setTextSize(2);
      snprintf(buf, sizeof(buf), "%.1f", _gTempC);
      _oled.setCursor(6, yBase + 14);
      _oled.print(buf);
      _oled.setTextSize(1);
      _oled.setCursor(2, yBase + 38);
      _oled.print(F("gradi Celsius"));
      break;
    }
    case 1: {  // ── pH ───────────────────────────────────────────────────
      _oled.setTextSize(1);
      _oled.setCursor(2, yBase + 2);
      _oled.print(F("\x04 pH SOLUZIONE"));
      _oled.setTextSize(2);
      snprintf(buf, sizeof(buf), "%.2f", _gPH);
      _oled.setCursor(6, yBase + 14);
      _oled.print(buf);
      _oled.setTextSize(1);
      _oled.setCursor(2, yBase + 38);
      _oled.print(F("scala  0.00 - 14.00"));
      break;
    }
    case 2: {  // ── EC ───────────────────────────────────────────────────
      _oled.setTextSize(1);
      _oled.setCursor(2, yBase + 2);
      _oled.print(F("\x05 CONDUTTIVITA'"));
      _oled.setTextSize(2);
      snprintf(buf, sizeof(buf), "%.0f", _gECus);
      _oled.setCursor(6, yBase + 14);
      _oled.print(buf);
      _oled.setTextSize(1);
      _oled.setCursor(2, yBase + 38);
      _oled.print(F("uS/cm"));
      break;
    }
    case 3: {  // ── LIVELLO ──────────────────────────────────────────────
      _oled.setTextSize(1);
      _oled.setCursor(2, yBase + 2);
      _oled.print(F("\x06 LIVELLO ACQUA"));
      _oled.setTextSize(2);
      _oled.setCursor(20, yBase + 14);
      _oled.print(_gLevel ? F("OK") : F("LOW"));
      _oled.setTextSize(1);
      _oled.setCursor(2, yBase + 38);
      _oled.print(_gLevel ? F("Serbatoio pieno") : F("Livello basso!"));
      break;
    }
  }
}

// ── I2C recovery: sblocca bus se SDA è tenuto basso ──────────────────────
// STM32U585 HAL ha timeout interno, ma se il bus è in stallo elettrico
// servono 9 clock pulses manuali per sbloccare lo slave.
static void _recoverI2C() {
  Wire.end();
  // 9 clock pulses per forzare il rilascio di SDA
  pinMode(PIN_WIRE_SCL, OUTPUT);
  pinMode(PIN_WIRE_SDA, INPUT);
  for (int i = 0; i < 9; i++) {
    digitalWrite(PIN_WIRE_SCL, HIGH);
    delayMicroseconds(5);
    digitalWrite(PIN_WIRE_SCL, LOW);
    delayMicroseconds(5);
  }
  // Genera condizione STOP
  pinMode(PIN_WIRE_SDA, OUTPUT);
  digitalWrite(PIN_WIRE_SDA, LOW);
  delayMicroseconds(5);
  digitalWrite(PIN_WIRE_SCL, HIGH);
  delayMicroseconds(5);
  digitalWrite(PIN_WIRE_SDA, HIGH);
  delayMicroseconds(5);
  // Riavvia I2C
  Wire.begin();
}

// ── Safe display: invia buffer solo se I2C risponde ──────────────────────
static bool _safeDisplay() {
  Wire.beginTransmission(OLED_ADDR);
  uint8_t err = Wire.endTransmission();
  if (err != 0) {
    // I2C bus bloccato o OLED non risponde
    Monitor.print(F("[OLED] I2C err="));
    Monitor.println(err);
    return false;
  }
  _oled.display();
  return true;
}

// ── Transizione verticale animata ─────────────────────────────────────────
static void _doSlideTransition(uint8_t nextSlide) {
  for (int16_t off = _SLIDE_STEP_PX; off <= _CONTENT_H; off += _SLIDE_STEP_PX) {
    _oled.fillRect(0, _CONTENT_TOP, OLED_W, _CONTENT_H, SSD1306_BLACK);
    _drawSlide(_currentSlide, _CONTENT_TOP - off);
    _drawSlide(nextSlide,    _CONTENT_TOP + _CONTENT_H - off);
    _repairFixedZones();
    if (!_safeDisplay()) return;  // abort transizione se I2C in errore
    delay(12);
  }
  _currentSlide = nextSlide;
}

// ── API pubblica ───────────────────────────────────────────────────────────

/**
 * Inizializza il display e disegna il frame fisso.
 * Ritorna true se il display risponde sull'I2C bus.
 */
static bool oled_begin() {
  Wire.begin();
  // Nota: STM32U585 HAL ha timeout I2C interno (~100 ticks).
  // Wire.setWireTimeout() non è disponibile sul core STM32.
  if (!_oled.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) return false;
  _oled.clearDisplay();
  _repairFixedZones();
  _oled.display();
  _slideTimer = millis();
  _lastRefreshMs = millis();
  return true;
}

/**
 * Aggiorna l'ora visualizzata nell'header.
 * Chiamare dal loop() ogni secondo, dopo ds1302_read().
 */
static void oled_set_rtc_time(uint8_t h, uint8_t m, uint8_t s) {
  _rtcH = h;  _rtcM = m;  _rtcS = s;
}

/**
 * Aggiorna il codice stato FSM visualizzato nell'header.
 * La zona stato viene ridisegnata al prossimo ciclo di oled_tick().
 * Codici: 0=IDLE 1=IRRIGAZIONE 2=DOSAGGIO 3=MISCELAZIONE
 *         4=RICIRCOLO 5=RICARICA 6=ERRORE 7=SCARICO
 */
static void oled_update_state(int code) {
  // Aggiorna solo la variabile: nessun accesso al display qui.
  // Questo evita corruzioni del buffer durante le animazioni slide.
  _gStateCode = (code >= 0 && code <= 7) ? (uint8_t)code : 7;
}

/**
 * Aggiorna i valori sensori usati nelle slide.
 *   temp_c   — temperatura in °C
 *   ph      — valore pH già convertito (0.00–14.00)
 *   ec_us   — conduttività già convertita in µS/cm
 *   float_ok — true = livello OK
 */
static void oled_update_sensors(float temp_c, float ph, float ec_us, bool float_ok) {
  _gTempC = temp_c;
  _gPH    = ph;
  _gECus  = ec_us;
  _gLevel = float_ok;
}

/**
 * Scrive un messaggio testuale nell'area contenuto (riga 1).
 */
static void oled_show_msg1(const String& text) {
  _oledFill(_CONTENT_TOP, 8);
  _oledText(_CONTENT_TOP, text.c_str());
  _safeDisplay();
}

/**
 * Scrive un messaggio testuale nell'area contenuto (riga 2).
 */
static void oled_show_msg2(const String& text) {
  _oledFill(_CONTENT_TOP + 8, 8);
  _oledText(_CONTENT_TOP + 8, text.c_str());
  _safeDisplay();
}

/**
 * Ripristina la slide corrente dopo un messaggio.
 */
static void oled_clear_msg() {
  _oledFill(_CONTENT_TOP, _CONTENT_H);
  _drawSlide(_currentSlide, _CONTENT_TOP);
  _safeDisplay();
}

/**
 * Schermata di splash all'avvio.
 */
static void oled_splash(const char* line1, const char* line2) {
  _oled.clearDisplay();
  _oled.setTextColor(SSD1306_WHITE);
  _oled.setTextSize(1);
  _oledText(24, line1);
  _oledText(32, line2);
  _safeDisplay();
}

/**
 * Pulizia totale + ridisegna il frame strutturato.
 */
static void oled_clear() {
  _oled.clearDisplay();
  _repairFixedZones();
  _safeDisplay();
}

/**
 * Verifica che l'OLED sia raggiungibile sull'I2C bus.
 * Se non risponde, tenta recovery I2C e re-init.
 * Ritorna true se il display è pronto.
 */
static bool oled_healthCheck() {
  Wire.beginTransmission(OLED_ADDR);
  if (Wire.endTransmission() == 0) return true;

  Monitor.println(F("[OLED] Health check FAIL → recovery I2C"));
  _recoverI2C();

  // Tenta re-init display
  if (_oled.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) {
    _oled.clearDisplay();
    _repairFixedZones();
    _oled.display();
    _slideTimer = millis();
    Monitor.println(F("[OLED] Re-init OK"));
    return true;
  }
  Monitor.println(F("[OLED] Re-init FALLITO"));
  return false;
}

/**
 * Gestisce la rotazione automatica delle slide con transizione animata.
 * DEVE essere chiamata nel loop() principale ad ogni iterazione.
 * Usa millis() per il timing — NON blocca con delay().
 */
static void oled_tick() {
  uint32_t now = millis();

  // Transizione slide
  if (now - _slideTimer >= _SLIDE_HOLD_MS) {
    uint8_t next = (_currentSlide + 1) % _NUM_SLIDES;
    _doSlideTransition(next);
    _slideTimer = millis();
    _updateHeader();
    _updateStateZone();
    _safeDisplay();
    _lastRefreshMs = millis();
    return;
  }

  // Refresh statico: max ogni _OLED_REFRESH_MS (500ms = 2 FPS)
  if (now - _lastRefreshMs >= _OLED_REFRESH_MS) {
    _oledFill(_CONTENT_TOP, _CONTENT_H);
    _drawSlide(_currentSlide, _CONTENT_TOP);
    _updateHeader();
    _updateStateZone();
    _safeDisplay();
    _lastRefreshMs = millis();
  }
}
