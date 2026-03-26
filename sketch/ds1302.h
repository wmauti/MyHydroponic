#pragma once
#include <Arduino.h>

// =============================================================
// DS1302 - Mini driver inline (3-wire protocol)
// Evita conflitti bcd2bin/bin2bcd con il Zephyr SDK.
//
// Pin di default (override con #define prima dell'include):
//   DS1302_CE_PIN  = 4   (RST)
//   DS1302_IO_PIN  = 3   (DAT)
//   DS1302_SCK_PIN = 2   (CLK)
// =============================================================

#ifndef DS1302_CE_PIN
#  define DS1302_CE_PIN  4
#endif
#ifndef DS1302_IO_PIN
#  define DS1302_IO_PIN  3
#endif
#ifndef DS1302_SCK_PIN
#  define DS1302_SCK_PIN 2
#endif

// Registri DS1302
#define DS1302_SEC_REG   0x80
#define DS1302_MIN_REG   0x82
#define DS1302_HR_REG    0x84
#define DS1302_DATE_REG  0x86
#define DS1302_MON_REG   0x88
#define DS1302_YEAR_REG  0x8C
#define DS1302_WP_REG    0x8E
#define DS1302_CH_BIT    0x80  // Clock Halt (bit 7 del registro secondi)

struct DS1302_Time {
  uint16_t year;    // 2000–2099
  uint8_t  month;   // 1–12
  uint8_t  day;     // 1–31
  uint8_t  hour;    // 0–23
  uint8_t  minute;  // 0–59
  uint8_t  second;  // 0–59
};

// ---- Conversioni BCD (nomi univoci per evitare collisioni) ----

static inline uint8_t ds_bcd2dec(uint8_t v) { return (v >> 4) * 10 + (v & 0x0F); }
static inline uint8_t ds_dec2bcd(uint8_t v) { return ((v / 10) << 4) | (v % 10); }

// ---- Bus 3-wire (LSB first) ------------------------------------

static void _ds_writeByte(uint8_t val) {
  for (uint8_t i = 0; i < 8; i++) {
    digitalWrite(DS1302_IO_PIN, (val & 1) ? HIGH : LOW);
    delayMicroseconds(1);
    digitalWrite(DS1302_SCK_PIN, HIGH);
    delayMicroseconds(1);
    digitalWrite(DS1302_SCK_PIN, LOW);
    val >>= 1;
  }
}

static uint8_t _ds_readByte() {
  uint8_t val = 0;
  pinMode(DS1302_IO_PIN, INPUT);
  for (uint8_t i = 0; i < 8; i++) {
    if (digitalRead(DS1302_IO_PIN)) val |= (1 << i);
    digitalWrite(DS1302_SCK_PIN, HIGH);
    delayMicroseconds(1);
    digitalWrite(DS1302_SCK_PIN, LOW);
    delayMicroseconds(1);
  }
  pinMode(DS1302_IO_PIN, OUTPUT);
  return val;
}

// ---- Accesso ai registri ---------------------------------------

static void ds1302_writeReg(uint8_t reg, uint8_t val) {
  digitalWrite(DS1302_CE_PIN, HIGH);
  _ds_writeByte(reg);
  _ds_writeByte(val);
  digitalWrite(DS1302_CE_PIN, LOW);
}

static uint8_t ds1302_readReg(uint8_t reg) {
  digitalWrite(DS1302_CE_PIN, HIGH);
  _ds_writeByte(reg | 0x01);   // bit 0 = 1 → read
  uint8_t val = _ds_readByte();
  digitalWrite(DS1302_CE_PIN, LOW);
  return val;
}

// ---- API pubblica ----------------------------------------------

static void ds1302_init() {
  pinMode(DS1302_CE_PIN,  OUTPUT);
  pinMode(DS1302_SCK_PIN, OUTPUT);
  pinMode(DS1302_IO_PIN,  OUTPUT);
  digitalWrite(DS1302_CE_PIN,  LOW);
  digitalWrite(DS1302_SCK_PIN, LOW);
  ds1302_writeReg(DS1302_WP_REG, 0x00);  // disabilita write-protect
}

static bool ds1302_isHalted() {
  return (ds1302_readReg(DS1302_SEC_REG) & DS1302_CH_BIT) != 0;
}

static void ds1302_start() {
  uint8_t sec = ds1302_readReg(DS1302_SEC_REG);
  if (sec & DS1302_CH_BIT)
    ds1302_writeReg(DS1302_SEC_REG, sec & ~DS1302_CH_BIT);
}

static DS1302_Time ds1302_read() {
  DS1302_Time t;
  t.second = ds_bcd2dec(ds1302_readReg(DS1302_SEC_REG) & 0x7F);
  t.minute = ds_bcd2dec(ds1302_readReg(DS1302_MIN_REG));
  t.hour   = ds_bcd2dec(ds1302_readReg(DS1302_HR_REG) & 0x3F);
  t.day    = ds_bcd2dec(ds1302_readReg(DS1302_DATE_REG));
  t.month  = ds_bcd2dec(ds1302_readReg(DS1302_MON_REG));
  t.year   = 2000 + ds_bcd2dec(ds1302_readReg(DS1302_YEAR_REG));
  return t;
}

static void ds1302_write(const DS1302_Time& t) {
  ds1302_writeReg(DS1302_WP_REG,   0x00);
  ds1302_writeReg(DS1302_SEC_REG,  ds_dec2bcd(t.second));
  ds1302_writeReg(DS1302_MIN_REG,  ds_dec2bcd(t.minute));
  ds1302_writeReg(DS1302_HR_REG,   ds_dec2bcd(t.hour));
  ds1302_writeReg(DS1302_DATE_REG, ds_dec2bcd(t.day));
  ds1302_writeReg(DS1302_MON_REG,  ds_dec2bcd(t.month));
  ds1302_writeReg(DS1302_YEAR_REG, ds_dec2bcd((uint8_t)(t.year % 100)));
}
