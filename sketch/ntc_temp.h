#pragma once
#include <Arduino.h>
#include <avr/pgmspace.h>

// =============================================================
// NTC 10k – Lettura temperatura con lookup PROGMEM,
// filtro esponenziale (EMA) e media mobile.
//
// Parametri configurabili (override con #define prima dell'include):
//   NTC_FILTER_ALPHA      0.1f   EMA smoothing factor
//   NTC_NUM_SAMPLES       20     finestra media mobile
//   NTC_READ_INTERVAL_MS  500    ms tra due letture nel loop
//   NTC_R_SERIES          10000  resistenza di serie (ohm)
//   NTC_ADC_MAX           16383  fondo scala ADC (14 bit)
// =============================================================

#ifndef NTC_FILTER_ALPHA
#  define NTC_FILTER_ALPHA     0.1f
#endif
#ifndef NTC_NUM_SAMPLES
#  define NTC_NUM_SAMPLES      20
#endif
#ifndef NTC_READ_INTERVAL_MS
#  define NTC_READ_INTERVAL_MS 500UL
#endif
#ifndef NTC_R_SERIES
#  define NTC_R_SERIES         10000UL
#endif
#ifndef NTC_ADC_MAX
#  define NTC_ADC_MAX          16383
#endif

// ---- Tabelle lookup (PROGMEM) ----------------------------------
// Resistenze NTC (ohm) e temperature (decimi di °C), tabella decrescente.

static const uint8_t NTC_NPOINTS = 11;

static const PROGMEM uint16_t ntc_rTable[] = {
  53647, 39921, 25395, 15714, 10000, 6530, 4367, 2985, 2082, 1480, 1070
};

static const PROGMEM int16_t ntc_tempTable[] = {
  -94, -39, 50, 150, 250, 350, 450, 550, 650, 750, 850
};

// ---- Stato interno ---------------------------------------------

static int16_t _ntc_buf[NTC_NUM_SAMPLES];
static int     _ntc_bufIdx  = 0;
static int32_t _ntc_bufSum  = 0;
static bool    _ntc_bufFull = false;

float    ntc_Tfiltered  = 25.0f;   // temperatura filtrata (°C) – leggibile dall'esterno
float    ntc_Tinstant   = 25.0f;   // temperatura istantanea (°C)
uint16_t ntc_lastRntc   = 10000;
int      ntc_lastADC    = 8192;

static unsigned long _ntc_lastRead = 0;

// ---- Funzioni interne ------------------------------------------

static uint16_t _ntc_resistance(int adc) {
  if (adc <= 0 || adc >= NTC_ADC_MAX) return 65535;
  uint32_t R = NTC_R_SERIES * (uint32_t)adc / ((uint32_t)NTC_ADC_MAX - (uint32_t)adc);
  return (R > 65535UL) ? (uint16_t)65535 : (uint16_t)R;
}

static int16_t _ntc_lookup(uint16_t R) {
  uint16_t r0    = pgm_read_word(&ntc_rTable[0]);
  uint16_t rLast = pgm_read_word(&ntc_rTable[NTC_NPOINTS - 1]);

  auto _interp = [](uint16_t r1, uint16_t r2, int16_t t1, int16_t t2, uint16_t R) -> int16_t {
    return t1 + (int32_t)(r1 - R) * (t2 - t1) / (int32_t)(r1 - r2);
  };

  if (R >= r0)
    return _interp(r0,                              pgm_read_word(&ntc_rTable[1]),
                   pgm_read_word(&ntc_tempTable[0]), pgm_read_word(&ntc_tempTable[1]), R);

  if (R <= rLast)
    return _interp(pgm_read_word(&ntc_rTable[NTC_NPOINTS - 2]),  rLast,
                   pgm_read_word(&ntc_tempTable[NTC_NPOINTS - 2]),
                   pgm_read_word(&ntc_tempTable[NTC_NPOINTS - 1]), R);

  for (int i = 0; i < NTC_NPOINTS - 1; i++) {
    uint16_t r1 = pgm_read_word(&ntc_rTable[i]);
    uint16_t r2 = pgm_read_word(&ntc_rTable[i + 1]);
    if (R <= r1 && R >= r2)
      return _interp(r1, r2,
                     pgm_read_word(&ntc_tempTable[i]),
                     pgm_read_word(&ntc_tempTable[i + 1]), R);
  }
  return 250;  // fallback 25.0 °C
}

static void _ntc_bufferUpdate(int16_t val) {
  _ntc_bufSum -= _ntc_buf[_ntc_bufIdx];
  _ntc_buf[_ntc_bufIdx] = val;
  _ntc_bufSum += val;
  _ntc_bufIdx = (_ntc_bufIdx + 1) % NTC_NUM_SAMPLES;
  if (_ntc_bufIdx == 0) _ntc_bufFull = true;
}

// ---- API pubblica ----------------------------------------------

/** Restituisce la temperatura media mobile (°C). */
float ntc_getAverage() {
  int count = _ntc_bufFull ? NTC_NUM_SAMPLES : _ntc_bufIdx;
  if (count == 0) return ntc_Tfiltered;
  return (float)_ntc_bufSum / (count * 10.0f);
}

/** Esegue una lettura ADC e aggiorna filtro + buffer. */
void ntc_update(uint8_t pin) {
  ntc_lastADC   = analogRead(pin);
  ntc_lastRntc  = _ntc_resistance(ntc_lastADC);
  int16_t T_scaled = _ntc_lookup(ntc_lastRntc);
  ntc_Tinstant  = T_scaled / 10.0f;
  ntc_Tfiltered = (1.0f - NTC_FILTER_ALPHA) * ntc_Tfiltered
                + NTC_FILTER_ALPHA * ntc_Tinstant;
  _ntc_bufferUpdate(T_scaled);
}

/** Inizializza il buffer a una temperatura nota (default 25 °C). */
void ntc_init(int16_t initTemp_x10 = 250) {
  _ntc_bufSum = (int32_t)NTC_NUM_SAMPLES * initTemp_x10;
  for (int i = 0; i < NTC_NUM_SAMPLES; i++) _ntc_buf[i] = initTemp_x10;
  _ntc_bufFull  = false;
  _ntc_bufIdx   = 0;
  ntc_Tfiltered = initTemp_x10 / 10.0f;
  ntc_Tinstant  = ntc_Tfiltered;
  _ntc_lastRead = millis();
}

/**
 * Da chiamare nel loop(): aggiorna la temperatura ogni NTC_READ_INTERVAL_MS ms.
 * Restituisce true se è stata eseguita una lettura.
 */
bool ntc_loopUpdate(uint8_t pin) {
  unsigned long now = millis();
  if (now - _ntc_lastRead >= NTC_READ_INTERVAL_MS) {
    ntc_update(pin);
    _ntc_lastRead = now;
    return true;
  }
  return false;
}
