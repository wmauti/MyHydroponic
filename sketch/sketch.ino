#include <Arduino_RouterBridge.h>
#include <avr/pgmspace.h>
#include <array>
#include <Wire.h>
#include <hd44780.h>                         // core hd44780
#include <hd44780ioClass/hd44780_I2Cexp.h>   // driver I2C
#include <ClearDS1302.h>

// =============================================================
// LCD I2C - hd44780
// =============================================================
// Usa il costruttore "I2Cexp", che auto-rileva l'expander I2C (PCF8574, MCP23008, ecc.)
hd44780_I2Cexp lcd;
// Dimensioni del display (adatta se NON è 16x2)
const int LCD_COLS = 16;
const int LCD_ROWS = 2;

// =============================================================
// RTC - OROLOGIO
// =============================================================

int RTCrstPin = 2;
int RTCclkPin = 4;
int RTCdatPin = 3;

// Pin: DAT, RST, CLK (come da costruttore ClearDS1302)
ClearDS1302 RTC1(RTCdatPin, RTCrstPin, RTCclkPin);

// =============================================================
// CONFIGURAZIONE HARDWARE E PIN
// =============================================================

namespace Config {
  namespace Pins {
    // NTC SU A3
    const uint8_t SENSOR_TEMP      = A3;   // NTC 10k
    const uint8_t SENSOR_PH        = A1;
    const uint8_t SENSOR_EC        = A2;
    const uint8_t SENSOR_FLOAT     = 13;

    const uint8_t PUMP_PH_DOWN       = 6;
    const uint8_t PUMP_NUTRIENTS     = 7;
    const uint8_t PUMP_RECIRCULATION = 9;
    const uint8_t PUMP_IRRIGATION    = 10;
    const uint8_t VALVE_REFILL       = 11;
  }

  namespace Params {
    const float    VOLTAGE_REFERENCE   = 3.3;
    const uint16_t ADC_MAX             = 16383;    // 14 bit (0..16383)
    const uint32_t R_SERIES            = 10000;    // 10k ohm
    const float    FILTER_ALPHA        = 0.1f;     // filtro esponenziale
    const int      NUM_SAMPLES         = 20;       // media mobile
    const unsigned long TEMP_READ_INTERVAL = 500;  // lettura ogni 500ms
  }
}

// =============================================================
// TABELLE NTC (LOOKUP)
// =============================================================

const int NPOINTS = 11;

// Resistenze NTC (ohm), decrescenti con T crescente
const PROGMEM uint16_t rTable_P[] = {
  53647, // -9.44°C
  39921, // -3.89°C
  25395, //  5.00°C
  15714, // 15.00°C
  10000, // 25.00°C
   6530, // 35.00°C
   4367, // 45.00°C
   2985, // 55.00°C
   2082, // 65.00°C
   1480, // 75.00°C
   1070  // 85.00°C
};

// Temperature in decimi di °C (x10)
const PROGMEM int16_t tempTable_P[] = {
   -94, // -9.44°C
   -39, // -3.89°C
    50, //  5.00°C
   150, // 15.00°C
   250, // 25.00°C
   350, // 35.00°C
   450, // 45.00°C
   550, // 55.00°C
   650, // 65.00°C
   750, // 75.00°C
   850  // 85.00°C
};

// =============================================================
// VARIABILI GLOBALI PER FILTRO E MEDIA MOBILE
// =============================================================

int16_t  tempBuffer[Config::Params::NUM_SAMPLES];
int      bufferIndex   = 0;
int32_t  bufferSum     = 0;
bool     bufferFull    = false;

float    Tfiltered     = 25.0f;   // temperatura filtrata (°C)
float    Tinstant      = 25.0f;   // temperatura istantanea (°C)
uint16_t lastRntc      = 10000;   // ultima resistenza letta
int      lastADC       = 8192;    // ultimo valore ADC

unsigned long lastTempRead = 0;

// =============================================================
// FUNZIONI NTC - TEMPERATURA
// =============================================================

// Calcolo resistenza NTC dal valore ADC
uint16_t readNTCResistance(int ntc_adc) {
  if (ntc_adc <= 0 || ntc_adc >= Config::Params::ADC_MAX) {
    return 65535;  // fuori scala
  }
  // Rntc = R_SERIES * adc / (adcMax - adc)
  uint32_t num = Config::Params::R_SERIES * (uint32_t)ntc_adc;
  uint32_t den = (uint32_t)Config::Params::ADC_MAX - (uint32_t)ntc_adc;
  uint32_t R = num / den;
  if (R > 65535UL) R = 65535UL;
  return (uint16_t)R;
}

// Lookup temperatura (x10 °C) con interpolazione lineare
int16_t lookupTemp(uint16_t R) {
  uint16_t r0    = pgm_read_word(&rTable_P[0]);
  uint16_t rLast = pgm_read_word(&rTable_P[NPOINTS - 1]);

  // Estremo "freddo": R >= r0
  if (R >= r0) {
    uint16_t r1 = r0;
    uint16_t r2 = pgm_read_word(&rTable_P[1]);
    int16_t  t1 = pgm_read_word(&tempTable_P[0]);
    int16_t  t2 = pgm_read_word(&tempTable_P[1]);
    int32_t delta = ((int32_t)(r1 - R) * (t2 - t1)) / (int32_t)(r1 - r2);
    return t1 + delta;
  }

  // Estremo "caldo": R <= rLast
  if (R <= rLast) {
    uint16_t r1 = pgm_read_word(&rTable_P[NPOINTS - 2]);
    uint16_t r2 = rLast;
    int16_t  t1 = pgm_read_word(&tempTable_P[NPOINTS - 2]);
    int16_t  t2 = pgm_read_word(&tempTable_P[NPOINTS - 1]);
    int32_t delta = ((int32_t)(r1 - R) * (t2 - t1)) / (int32_t)(r1 - r2);
    return t1 + delta;
  }

  // Ricerca lineare dell'intervallo
  for (int i = 0; i < NPOINTS - 1; i++) {
    uint16_t r1 = pgm_read_word(&rTable_P[i]);
    uint16_t r2 = pgm_read_word(&rTable_P[i + 1]);
    if (R <= r1 && R >= r2) {  // tabella decrescente
      int16_t t1 = pgm_read_word(&tempTable_P[i]);
      int16_t t2 = pgm_read_word(&tempTable_P[i + 1]);
      int32_t deltaR = (int32_t)r1 - (int32_t)r2;
      int32_t deltaT = (int32_t)t2 - (int32_t)t1;
      int32_t frac   = ((int32_t)(r1 - R) * deltaT) / deltaR;
      return t1 + frac;
    }
  }

  // Fallback
  return 250; // 25.0°C
}

// Aggiorna buffer media mobile
void updateTempBuffer(int16_t newTemp) {
  bufferSum -= tempBuffer[bufferIndex];
  tempBuffer[bufferIndex] = newTemp;
  bufferSum += newTemp;
  bufferIndex = (bufferIndex + 1) % Config::Params::NUM_SAMPLES;
  if (bufferIndex == 0) bufferFull = true;
}

// Calcola media mobile
float getTempAverage() {
  int count = bufferFull ? Config::Params::NUM_SAMPLES : bufferIndex;
  if (count == 0) return Tfiltered;
  return (float)bufferSum / (count * 10.0f);
}

// =============================================================
// LETTURA TEMPERATURA CONTINUA (chiamata nel loop)
// =============================================================

void updateTemperature() {
  lastADC = analogRead(Config::Pins::SENSOR_TEMP);
  lastRntc = readNTCResistance(lastADC);
  int16_t T_scaled = lookupTemp(lastRntc);
  Tinstant = T_scaled / 10.0f;

  // Aggiorna filtro esponenziale
  Tfiltered = (1.0f - Config::Params::FILTER_ALPHA) * Tfiltered
            + Config::Params::FILTER_ALPHA * Tinstant;

  // Aggiorna media mobile
  updateTempBuffer(T_scaled);
}

// =============================================================
// CALLBACK LCD RICHIAMATE DA PYTHON
// =============================================================

// Pulisce completamente il display
void lcdClear() {
  lcd.clear();
  Monitor.println("LCD: clear da Python");
}

// Stampa una stringa sulla prima riga (taglio a 16 caratteri)
void lcdPrintLine1(String text) {
  if (text.length() > LCD_COLS) {
    text = text.substring(0, LCD_COLS);
  }
  lcd.setCursor(0, 0);
  // Pulisce riga 0
  for (int i = 0; i < LCD_COLS; i++) lcd.print(' ');
  lcd.setCursor(0, 0);
  lcd.print(text);
  Monitor.print("LCD L1: ");
  Monitor.println(text);
}

// Stampa una stringa sulla seconda riga (taglio a 16 caratteri)
void lcdPrintLine2(String text) {
  if (text.length() > LCD_COLS) {
    text = text.substring(0, LCD_COLS);
  }
  lcd.setCursor(0, 1);
  // Pulisce riga 1
  for (int i = 0; i < LCD_COLS; i++) lcd.print(' ');
  lcd.setCursor(0, 1);
  lcd.print(text);
  Monitor.print("LCD L2: ");
  Monitor.println(text);
}

// ESEMPIO: mostra uno "stato" sintetico in riga 0
// 0 = Idle, 1 = Irrigazione, 2 = Ricircolo, 3 = Refill, ecc.
void lcdShowStatus(int code) {
  lcd.setCursor(0, 0);
  for (int i = 0; i < LCD_COLS; i++) lcd.print(' ');
  lcd.setCursor(0, 0);
  lcd.print("Stato: ");

  switch (code) {
    case 0: lcd.print("IDLE");       break;
    case 1: lcd.print("IRRIG.");     break;
    case 2: lcd.print("DOSING");     break;
    case 3: lcd.print("MIXING");     break;
    case 4: lcd.print("RICIRC.");    break;
    case 5: lcd.print("REFILL");     break;
    case 6: lcd.print("ERROR");      break;
    case 7: lcd.print("DRAIN.");     break;
    default: lcd.print("SCONOSCIUTO"); break;
}

  Monitor.print("LCD stato: ");
  Monitor.println(code);
}

// =============================================================
// RTC: FUNZIONI DI SUPPORTO
// =============================================================

// Converte la stringa ora di ClearDS1302 (es. "23", "11AM", "11PM") in ora 0..23
int parseHourString(const String &h) {
  // Legge le prime cifre numeriche
  int hour = 0;
  for (int i = 0; i < h.length(); ++i) {
    if (h[i] >= '0' && h[i] <= '9') {
      hour = hour * 10 + (h[i] - '0');
      if (hour > 23) break;
    } else {
      // smette appena trova un carattere non numerico
      break;
    }
  }
  if (hour < 0 || hour > 23) hour = 0;
  return hour;
}

// Zeller's congruence per giorno della settimana
uint8_t calcDayOfWeek(int32_t y, int32_t m, int32_t d) {
  if (m < 3) {
    m += 12;
    y -= 1;
  }
  int32_t K = y % 100;
  int32_t J = y / 100;
  int32_t h = (d + (13 * (m + 1)) / 5 + K + K/4 + J/4 + 5*J) % 7;
  // h: 0=Saturday, 1=Sunday, 2=Monday, ... 6=Friday
  int32_t dow0 = ((h + 6) % 7);  // 0=Sunday, 1=Monday, ... 6=Saturday
  // qui mappiamo 1=Sunday .. 7=Saturday (o viceversa, non critico)
  uint8_t dow = (uint8_t)(dow0 + 1); // 1..7
  return dow;
}

// =============================================================
// RTC: CALLBACK PER PYTHON
// =============================================================

// Ritorna [year, month, day, hour, minute, second]
std::array<int32_t, 6> rtc_get_datetime() {
  byte sec_b   = RTC1.get.time.second();
  byte min_b   = RTC1.get.time.minutes();
  String h_str = RTC1.get.time.hour();
  byte date_b  = RTC1.get.time.date();   // giorno del mese
  byte month_b = RTC1.get.time.month();
  byte year_b  = RTC1.get.time.year();   // 0..99

  int32_t second = (int32_t)sec_b;
  int32_t minute = (int32_t)min_b;
  int32_t hour   = (int32_t)parseHourString(h_str);
  int32_t day    = (int32_t)date_b;
  int32_t month  = (int32_t)month_b;
  int32_t year   = 2000 + (int32_t)year_b;  // DS1302 memorizza solo 0–99

  std::array<int32_t, 6> out = {year, month, day, hour, minute, second};

  Monitor.print(F("[RTC] get: "));
  Monitor.print(out[0]); Monitor.print('-');
  Monitor.print(out[1]); Monitor.print('-');
  Monitor.print(out[2]); Monitor.print(' ');
  Monitor.print(out[3]); Monitor.print(':');
  Monitor.print(out[4]); Monitor.print(':');
  Monitor.println(out[5]);

  return out;
}

// Chiamata da Python: year, month, day, hour, minute, second
void rtc_set_datetime(int32_t year, int32_t month, int32_t day,
                      int32_t hour, int32_t minute, int32_t second)
{
  uint8_t dow = calcDayOfWeek(year, month, day);
  int year2 = (int)(year % 100);  // DS1302 usa 0..99

  Monitor.print(F("[RTC] set: "));
  Monitor.print(year); Monitor.print('-');
  Monitor.print(month); Monitor.print('-');
  Monitor.print(day); Monitor.print(' ');
  Monitor.print(hour); Monitor.print(':');
  Monitor.print(minute); Monitor.print(':');
  Monitor.print(second);
  Monitor.print(F(" (dow="));
  Monitor.print(dow);
  Monitor.print(F(", year2="));
  Monitor.print(year2);
  Monitor.println(')');

  // ClockRegister = true → abilita il clock
  bool clockReg = true;

  RTC1.set.time.SetAll(
    (int)second,
    (int)minute,
    (int)hour,
    (int)dow,       // giorno della settimana
    (int)day,       // giorno del mese
    (int)month,
    (int)year2,
    clockReg
  );
}

// =============================================================
// CALLBACK POMPE / VALVOLA (controllate da Python)
// =============================================================

void startIrrigation() {
  digitalWrite(Config::Pins::PUMP_IRRIGATION, LOW);
  Monitor.println("Pompa irrigazione ACCESA da Python");
}

void stopIrrigation() {
  digitalWrite(Config::Pins::PUMP_IRRIGATION, HIGH);
  Monitor.println("Pompa irrigazione SPENTA da Python");
}

void phDownOn() {
  digitalWrite(Config::Pins::PUMP_PH_DOWN, LOW);
  Monitor.println("Pompa pH down ACCESA da Python");
}

void phDownOff() {
  digitalWrite(Config::Pins::PUMP_PH_DOWN, HIGH);
  Monitor.println("Pompa pH down SPENTA da Python");
}

void nutrientsOn() {
  digitalWrite(Config::Pins::PUMP_NUTRIENTS, LOW);
  Monitor.println("Pompa nutrients ACCESA da Python");
}

void nutrientsOff() {
  digitalWrite(Config::Pins::PUMP_NUTRIENTS, HIGH);
  Monitor.println("Pompa nutrients SPENTA da Python");
}

void recirculationOn() {
  digitalWrite(Config::Pins::PUMP_RECIRCULATION, LOW);
  Monitor.println("Pompa ricircolo ACCESA da Python");
}

void recirculationOff() {
  digitalWrite(Config::Pins::PUMP_RECIRCULATION, HIGH);
  Monitor.println("Pompa ricircolo SPENTA da Python");
}

void refillValveOn() {
  digitalWrite(Config::Pins::VALVE_REFILL, LOW);
  Monitor.println("Valvola refill APERTA da Python");
}

void refillValveOff() {
  digitalWrite(Config::Pins::VALVE_REFILL, HIGH);
  Monitor.println("Valvola refill CHIUSA da Python");
}

// =============================================================
// CALLBACK LETTURA SENSORI ON-DEMAND (CHIAMATA DA PYTHON)
// =============================================================

// RITORNA: [temp_filtered, ec_v, ph_mv, float_ok]
std::array<float, 4> get_sensor_data() {

  float temp_c = getTempAverage(); 

  // Float switch
  bool rawFloat = (digitalRead(Config::Pins::SENSOR_FLOAT) == HIGH);

  // EC voltage
  float rawECVoltage = analogRead(Config::Pins::SENSOR_EC) *
                       (Config::Params::VOLTAGE_REFERENCE / (float)Config::Params::ADC_MAX);

  // pH voltage in mV
  float rawPHVoltage = analogRead(Config::Pins::SENSOR_PH) *
                       (Config::Params::VOLTAGE_REFERENCE / (float)Config::Params::ADC_MAX) * 1000.0f;

  // Log dettagliato
  Monitor.print("NTC T:");   Monitor.print(temp_c);
  Monitor.print(" EC_V:");   Monitor.print(rawECVoltage, 3);
  Monitor.print(" pH_mV:");  Monitor.print(rawPHVoltage, 1);
  Monitor.print(" Float:");  Monitor.println(rawFloat ? "OK" : "LOW");

  std::array<float, 4> out = {
    temp_c,                    // temperatura filtrata per Python
    rawECVoltage,
    rawPHVoltage,
    rawFloat ? 1.0f : 0.0f
  };

  return out;
}

// =============================================================
// SETUP
// =============================================================

void setup() {
  Bridge.begin();
  Monitor.begin(9600);

  // Risoluzione ADC 14 bit per UNO R4 / UNO Q
  analogReadResolution(14);

  pinMode(Config::Pins::SENSOR_FLOAT, INPUT_PULLUP);

  // Pin attuatori
  pinMode(Config::Pins::PUMP_PH_DOWN,       OUTPUT);
  pinMode(Config::Pins::PUMP_NUTRIENTS,     OUTPUT);
  pinMode(Config::Pins::PUMP_RECIRCULATION, OUTPUT);
  pinMode(Config::Pins::PUMP_IRRIGATION,    OUTPUT);
  pinMode(Config::Pins::VALVE_REFILL,       OUTPUT);

  // Tutto spento/chiuso all'avvio (logica attiva bassa)
  digitalWrite(Config::Pins::PUMP_PH_DOWN,       HIGH);
  digitalWrite(Config::Pins::PUMP_NUTRIENTS,     HIGH);
  digitalWrite(Config::Pins::PUMP_RECIRCULATION, HIGH);
  digitalWrite(Config::Pins::PUMP_IRRIGATION,    HIGH);
  digitalWrite(Config::Pins::VALVE_REFILL,       HIGH);

  // Inizializzazione buffer temperatura a 25°C
  int16_t initT = 250; // 25.0°C x10
  bufferSum = (int32_t)Config::Params::NUM_SAMPLES * initT;
  for (int i = 0; i < Config::Params::NUM_SAMPLES; i++) {
    tempBuffer[i] = initT;
  }
  bufferFull  = false;
  bufferIndex = 0;
  Tfiltered   = 25.0f;
  Tinstant    = 25.0f;
  lastTempRead = millis();

  // Prima lettura immediata per inizializzare i valori reali
  updateTemperature();

  // Registra servizi verso Python
  Bridge.provide("get_sensor_data",          get_sensor_data);
  Bridge.provide("ph_down_on",               phDownOn);
  Bridge.provide("ph_down_off",              phDownOff);
  Bridge.provide("nutrients_on",             nutrientsOn);
  Bridge.provide("nutrients_off",            nutrientsOff);
  Bridge.provide("start_recirculation",      recirculationOn);
  Bridge.provide("stop_recirculation",       recirculationOff);
  Bridge.provide("refill_on",                refillValveOn);
  Bridge.provide("refill_off",               refillValveOff);
  Bridge.provide("start_irrigation",         startIrrigation);
  Bridge.provide("stop_irrigation",          stopIrrigation);

  // Funzioni LCD per Python
  Bridge.provide("lcd_clear",                lcdClear);
  Bridge.provide("lcd_print_line1",          lcdPrintLine1);
  Bridge.provide("lcd_print_line2",          lcdPrintLine2);
  Bridge.provide("lcd_show_status",          lcdShowStatus);

  // Funzioni RTC per Python
  Bridge.provide("rtc_get_datetime",         rtc_get_datetime);
  Bridge.provide("rtc_set_datetime",         rtc_set_datetime);

  Monitor.println("===========================================");
  Monitor.println("Sistema Idroponico Inizializzato");
  Monitor.println("NTC su A3 - Lettura continua ogni 500ms");
  Monitor.println("Filtro exp alpha=0.1, Media mobile 20 campioni");
  Monitor.println("===========================================");

  // Inizializzazione LCD hd44780 via I2C
  int lcdStatus = lcd.begin(LCD_COLS, LCD_ROWS);
  if (lcdStatus) {
    // Se c'è stato un errore, stampiamo via seriale
    Monitor.print("LCD init error: ");
    Monitor.println(lcdStatus);
  } else {
    lcd.backlight();
    lcd.clear();
    lcd.print("Hydro System");
    lcd.setCursor(0, 1);
    lcd.print("Avvio...");
    delay(1000);
    lcd.clear();
  }
}

// =============================================================
// LOOP - LETTURA CONTINUA TEMPERATURA
// =============================================================

void loop() {
  unsigned long now = millis();

  // Lettura temperatura ogni 500ms per mantenere filtro aggiornato
  if (now - lastTempRead >= Config::Params::TEMP_READ_INTERVAL) {
    updateTemperature();
    lastTempRead = now;
  }

  // Piccolo delay per non sovraccaricare la CPU
  delay(10);
}