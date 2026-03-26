/*******************************************************************************
 * lcd_i2c.h - Mini driver LCD HD44780 via PCF8574 I2C
 * Evita conflitti TwoWire typedef con Zephyr SDK
 * Indirizzo default: 0x27, Display 16x2
 ******************************************************************************/
#pragma once

#include <Wire.h>

static uint8_t LCD_I2C_ADDR = 0x27;  // indirizzo PCF8574 (auto-detect)
const int LCD_COLS = 16;

// Bit del PCF8574 (mapping tipico modulo I2C LCD)
#define LCD_BIT_RS  0x01  // P0 = Register Select
#define LCD_BIT_RW  0x02  // P1 = Read/Write (sempre 0=write)
#define LCD_BIT_EN  0x04  // P2 = Enable
#define LCD_BIT_BL  0x08  // P3 = Backlight

static uint8_t _lcd_backlight = LCD_BIT_BL;  // backlight acceso di default

// Scrive un byte al PCF8574
static void lcd_i2c_write(uint8_t data) {
  Wire.beginTransmission(LCD_I2C_ADDR);
  Wire.write(data | _lcd_backlight);
  Wire.endTransmission();
}

// Invia un nibble (4 bit) con pulse Enable
static void lcd_sendNibble(uint8_t nibble, uint8_t rs) {
  uint8_t data = (nibble & 0xF0) | rs;  // high nibble + RS
  lcd_i2c_write(data | LCD_BIT_EN);     // EN=1
  delayMicroseconds(1);
  lcd_i2c_write(data);                   // EN=0
  delayMicroseconds(50);
}

// Invia un byte completo (2 nibble, 4-bit mode)
static void lcd_sendByte(uint8_t val, uint8_t rs) {
  lcd_sendNibble(val & 0xF0, rs);        // high nibble
  lcd_sendNibble((val << 4) & 0xF0, rs); // low nibble
}

// Invia comando LCD
static void lcd_command(uint8_t cmd) {
  lcd_sendByte(cmd, 0);  // RS=0
  if (cmd <= 0x03) delay(2);  // clear e home sono lenti
}

// Stampa un carattere
static void lcd_writeChar(char c) {
  lcd_sendByte((uint8_t)c, LCD_BIT_RS);  // RS=1
}

// Stampa una stringa C
static void lcd_printStr(const char* str) {
  while (*str) lcd_writeChar(*str++);
}

// Stampa una String Arduino
static void lcd_printString(const String& str) {
  lcd_printStr(str.c_str());
}

// Posiziona cursore
static void lcd_setCursor(uint8_t col, uint8_t row) {
  uint8_t row_offsets[] = {0x00, 0x40};
  if (row > 1) row = 1;
  lcd_command(0x80 | (col + row_offsets[row]));
}

// Clear display
static void lcd_clearDisplay() {
  lcd_command(0x01);
  delay(2);
}

// Backlight on/off
static void lcd_backlightOn()  { _lcd_backlight = LCD_BIT_BL; lcd_i2c_write(0); }
static void lcd_backlightOff() { _lcd_backlight = 0;          lcd_i2c_write(0); }

// Scansione I2C per trovare dispositivi (diagnostica)
static uint8_t lcd_scanI2C() {
  // Prova prima gli indirizzi comuni dei moduli LCD
  uint8_t commonAddr[] = {0x27, 0x3F, 0x20, 0x38};
  for (uint8_t i = 0; i < sizeof(commonAddr); i++) {
    Wire.beginTransmission(commonAddr[i]);
    if (Wire.endTransmission() == 0) return commonAddr[i];
  }
  // Scan completo range PCF8574 (0x20-0x27) e PCF8574A (0x38-0x3F)
  for (uint8_t addr = 0x20; addr <= 0x3F; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) return addr;
  }
  return 0;  // nessun dispositivo trovato
}

// Inizializzazione HD44780 in 4-bit mode via PCF8574
static bool lcd_beginDisplay() {
  Wire.begin();
  delay(100);  // attesa inizializzazione I2C bus (importante su Zephyr)

  // Auto-detect indirizzo LCD
  uint8_t found = lcd_scanI2C();
  if (found == 0) return false;  // nessun dispositivo trovato

  // Aggiorna indirizzo se diverso da default
  LCD_I2C_ADDR = found;

  delay(50);  // attesa power-on LCD
  // Sequenza inizializzazione 4-bit (da datasheet HD44780)
  lcd_sendNibble(0x30, 0); delay(5);   // Function set 8-bit (1)
  lcd_sendNibble(0x30, 0); delay(5);   // Function set 8-bit (2)
  lcd_sendNibble(0x30, 0); delay(1);   // Function set 8-bit (3)
  lcd_sendNibble(0x20, 0); delay(1);   // Switch to 4-bit mode

  lcd_command(0x28);  // Function set: 4-bit, 2 righe, 5x8 font
  lcd_command(0x0C);  // Display ON, cursor OFF, blink OFF
  lcd_command(0x06);  // Entry mode: increment, no shift
  lcd_command(0x01);  // Clear display
  delay(2);
  return true;
}
