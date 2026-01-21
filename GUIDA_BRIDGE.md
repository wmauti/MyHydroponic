# Arduino UNO Q Bridge RPC - Knowledge Base & Programming Guide

## Table of Contents
1. [Concetti Fondamentali](#concetti-fondamentali)
2. [Architettura](#architettura)
3. [Setup Iniziale](#setup-iniziale)
4. [API Reference](#api-reference)
5. [Pattern di Programmazione](#pattern-di-programmazione)
6. [Debugging & Troubleshooting](#debugging--troubleshooting)
7. [Best Practices](#best-practices)
8. [Errori Comuni](#errori-comuni)
9. [Checklist](#checklist)

---

## Concetti Fondamentali

### Cos'è il Bridge?

Il **Bridge** è una libreria RPC (Remote Procedure Call) che permette a **Python (MPU)** e **Arduino C++ (MCU)** di comunicare tramite l'**Arduino Router** - un servizio di background che gestisce la comunicazione tra i due processori.

### Differenza rispetto a Serial

| Aspetto | Serial USB | Bridge RPC |
|---------|-----------|-----------|
| **Che cosa invia** | Raw bytes | Chiamate a funzioni |
| **Come lavora** | Manual parsing | Automatico |
| **Multipunto** | ❌ No | ✅ Sì (multipli client Linux → MCU) |
| **Uso migliore** | Streaming dati | Comandi e controllo |
| **Latency** | Basso | Moderato |
| **Complessità** | Media | Bassa (dal lato utente) |

### Architettura a Due Processori

```
┌─────────────────────────────────────────┐
│        ARDUINO UNO Q                    │
├─────────────────────────────────────────┤
│ ┌────────────────┐   ┌────────────────┐ │
│ │  MPU (QRB)     │   │  MCU (STM32)   │ │
│ │ Debian Linux   │   │  Zephyr RTOS   │ │
│ │ Quad-core @2GHz│   │  Cortex-M33    │ │
│ │ 2GB RAM        │   │  160 MHz       │ │
│ │ 16GB storage   │   │  2MB Flash     │ │
│ └────────┬────────┘   └────────┬────────┘ │
│          │                     │          │
│          └──→ Arduino Router ←──┘          │
│              (MessagePack RPC)            │
│              Socket: /var/run/             │
│              arduino-router.sock           │
└─────────────────────────────────────────┘
```

---

## Architettura

### Arduino Router - Il "Traffic Controller"

L'Arduino Router è un **servizio background Linux** che:

✓ Gestisce comunicazione MessagePack RPC tra MPU e MCU
✓ Mantiene registro (service discovery) di funzioni esposte
✓ Permette comunicazione multipunto (multiple Linux process → single MCU)
✓ Comunica con MCU via `Serial1` (MCU side)
✓ Comunica con Linux apps via `/var/run/arduino-router.sock` (MPU side)

### Risorse Riservate (⚠️ ATTENZIONE!)

```
❌ NON USARE QUESTE RISORSE ❌

Linux side:  /dev/ttyHS1      ← Usato ESCLUSIVAMENTE da arduino-router
Arduino side: Serial1         ← Usato ESCLUSIVAMENTE da arduino-router

Se provi ad accedervi:
├─ Bridge fallisce
├─ Comunicazione si blocca
└─ Comportamenti imprevisti
```

### Altre Porte Seriali DISPONIBILI

Se hai bisogno di comunicazione seriale tradizionale, puoi usare:

```cpp
// Arduino Sketch - Porta seriale DISPONIBILE
Serial.begin(115200);      // ✓ OK - Debug via USB
Serial2.begin(9600);       // ✓ OK - Se disponibile su MCU
```

```python
# Python - Comunicazione DISPONIBILE
import serial
ser = serial.Serial('/dev/ttyUSB0', 9600)  # ✓ OK - USB serial
```

---

## Setup Iniziale

### 1. Arduino IDE Setup

```
1. Apri Arduino IDE 2.0+
2. Tools → Board Manager
3. Cerca "Arduino UNO Q"
4. Installa il package ufficiale
5. Tools → Board → Arduino UNO Q
6. Tools → Port → Seleziona porta COM
7. Pronto!
```

### 2. Python Setup

```bash
# Installa libreria pyserial (per comunicazione seriale)
pip install pyserial

# Se usi Bridge RPC, controlla che arduino-router sia in esecuzione
# (Di solito è preinstallato su Arduino UNO Q)
```

### 3. Verifica Connessione

**Arduino Sketch - Test Bridge**:
```cpp
void setup() {
  Serial.begin(115200);
  
  if (!Bridge.begin()) {
    Serial.println("ERROR: Bridge failed!");
    while(1);  // Blocca se errore
  }
  Serial.println("✓ Bridge initialized");
}

void loop() {
  delay(100);
}
```

**Python - Test Bridge**:
```python
from arduino_router import ArduinoRouter

try:
    router = ArduinoRouter()
    print("✓ Connected to Arduino Router")
except Exception as e:
    print(f"✗ Error: {e}")
```

---

## API Reference

### Arduino Sketch - Bridge.begin()

```cpp
#include <Arduino_RouterBridge.h>

// Inizializza Bridge
// DEVE essere nel setup()
// Ritorna true se successo, false se fallisce
if (!Bridge.begin()) {
  // Errore durante inizializzazione
  Serial.println("Bridge failed!");
}
```

### Arduino Sketch - Bridge.provide()

Esponi una funzione al MPU (Python può chiamarla).

```cpp
// Sintassi generale
void Bridge.provide(const char* name, function_pointer);

// Esempi:

// 1. Funzione void (nessun parametro)
void setLED(bool state) {
  digitalWrite(13, state ? HIGH : LOW);
}
Bridge.provide("setLED", setLED);

// 2. Funzione con return value
int getSensorValue() {
  return analogRead(A0);
}
Bridge.provide("getSensor", getSensorValue);

// 3. Funzione con parametri multipli
void setRGB(int r, int g, int b) {
  analogWrite(5, r);
  analogWrite(6, g);
  analogWrite(9, b);
}
Bridge.provide("setRGB", setRGB);

// 4. Funzione con stringa
void logMessage(const char* msg) {
  Serial.println(msg);
}
Bridge.provide("log", logMessage);
```

**Tipi supportati**:
- `void` (nessun return)
- `bool`, `int`, `float`, `double`
- `const char*` (stringa)
- `unsigned int`, `long`

### Arduino Sketch - Bridge.call()

Chiama una funzione esposta dal MPU (Python).

```cpp
// Sintassi
void Bridge.call(const char* name, ...parameters);

// Esempi:

// 1. Senza parametri
Bridge.call("print_hello");

// 2. Con un parametro
Bridge.call("set_brightness", 128);

// 3. Con multipli parametri
Bridge.call("send_data", 42, 3.14, "test");

// 4. In un loop
for(int i = 0; i < 10; i++) {
  Bridge.call("increment_counter", i);
  delay(500);
}
```

### Python - ArduinoRouter

```python
from arduino_router import ArduinoRouter

# Inizializza connessione
router = ArduinoRouter()

# Chiama funzione Arduino
router.call("setLED", True)
router.call("getSensor")
router.call("setRGB", 255, 0, 128)

# Esponi funzione per Arduino
def my_python_function(param):
    print(f"Arduino mi ha mandato: {param}")

router.provide("my_function", my_python_function)

# Chiudi connessione
router.close()
```

---

## Pattern di Programmazione

### Pattern 1: Simple LED Control

**Arduino**:
```cpp
#include <Arduino_RouterBridge.h>

const int LED_PIN = 13;

void setLED(bool state) {
  digitalWrite(LED_PIN, state ? HIGH : LOW);
  Serial.println(state ? "LED ON" : "LED OFF");
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  
  Bridge.begin();
  Bridge.provide("setLED", setLED);
  
  Serial.println("Ready");
}

void loop() {
  delay(100);
}
```

**Python**:
```python
from arduino_router import ArduinoRouter
import time

router = ArduinoRouter()

# Accendi
router.call("setLED", True)
time.sleep(2)

# Spegni
router.call("setLED", False)
```

### Pattern 2: Bidirectional Communication

**Arduino**:
```cpp
#include <Arduino_RouterBridge.h>

int sensor_value = 0;

int readSensor() {
  sensor_value = analogRead(A0);
  return sensor_value;
}

void onPythonData(int value) {
  Serial.print("Python sent: ");
  Serial.println(value);
}

void setup() {
  Serial.begin(115200);
  Bridge.begin();
  
  Bridge.provide("readSensor", readSensor);
  Bridge.provide("receivePythonData", onPythonData);
}

void loop() {
  delay(100);
}
```

**Python**:
```python
from arduino_router import ArduinoRouter
import time

router = ArduinoRouter()

# Leggi sensore da Arduino
value = router.call("readSensor")
print(f"Sensor: {value}")

# Invia dato ad Arduino
router.call("receivePythonData", 123)
```

### Pattern 3: Callback Handler

Arduino richiama funzioni Python periodicamente:

**Arduino**:
```cpp
#include <Arduino_RouterBridge.h>

void setup() {
  Serial.begin(115200);
  Bridge.begin();
}

void loop() {
  // Ogni 2 secondi, chiama Python
  Bridge.call("on_heartbeat", millis());
  delay(2000);
}
```

**Python**:
```python
from arduino_router import ArduinoRouter
import time

router = ArduinoRouter()

def on_heartbeat(timestamp):
    print(f"Heartbeat from Arduino: {timestamp}ms")

router.provide("on_heartbeat", on_heartbeat)

# Mantieni Python in esecuzione
try:
    while True:
        time.sleep(1)
except KeyboardInterrupt:
    print("Exit")
```

### Pattern 4: State Management

**Arduino**:
```cpp
#include <Arduino_RouterBridge.h>

struct DeviceState {
  bool isActive;
  int brightness;
  float temperature;
};

DeviceState state = {true, 128, 23.5};

void setState(bool active, int brightness) {
  state.isActive = active;
  state.brightness = brightness;
  Serial.print("State updated: ");
  Serial.println(state.brightness);
}

int getState() {
  return state.brightness;
}

void setup() {
  Serial.begin(115200);
  Bridge.begin();
  
  Bridge.provide("setState", setState);
  Bridge.provide("getState", getState);
}

void loop() {
  delay(100);
}
```

**Python**:
```python
from arduino_router import ArduinoRouter

router = ArduinoRouter()

# Leggi stato
state = router.call("getState")
print(f"Current state: {state}")

# Modifica stato
router.call("setState", True, 200)
```

### Pattern 5: Error Handling

**Arduino**:
```cpp
#include <Arduino_RouterBridge.h>

bool safeSensorRead(int sensor_pin) {
  if (sensor_pin < 0 || sensor_pin > 5) {
    return false;  // Pin non valido
  }
  
  int value = analogRead(sensor_pin);
  return value >= 0;
}

void setup() {
  Serial.begin(115200);
  Bridge.begin();
  Bridge.provide("safeSensorRead", safeSensorRead);
}

void loop() {
  delay(100);
}
```

**Python**:
```python
from arduino_router import ArduinoRouter

router = ArduinoRouter()

try:
    result = router.call("safeSensorRead", 0)
    if result:
        print("✓ Sensor read successful")
    else:
        print("✗ Sensor read failed")
except TimeoutError:
    print("✗ Arduino not responding")
except Exception as e:
    print(f"✗ Error: {e}")
```

---

## Debugging & Troubleshooting

### Arduino Sketch Debugging

```cpp
#include <Arduino_RouterBridge.h>

void setup() {
  Serial.begin(115200);
  
  // Debug: Bridge initialization
  Serial.print("Bridge starting... ");
  if (Bridge.begin()) {
    Serial.println("✓ OK");
  } else {
    Serial.println("✗ FAILED");
    while(1);  // Blocca
  }
  
  // Debug: Function registration
  Serial.print("Registering functions... ");
  Bridge.provide("test_func", test_func);
  Serial.println("✓ OK");
}

void test_func() {
  Serial.println("[DEBUG] test_func called");
}

void loop() {
  // Debug: Periodic heartbeat
  static unsigned long last = 0;
  if (millis() - last > 5000) {
    Serial.println("[HEARTBEAT] MCU is alive");
    last = millis();
  }
  
  delay(100);
}
```

### Python Debugging

```python
from arduino_router import ArduinoRouter
import time
import traceback

def debug_bridge():
    try:
        print("[DEBUG] Connecting to Arduino Router...")
        router = ArduinoRouter()
        print("[✓] Connected")
        
        # Test simple call
        print("[DEBUG] Calling test_func...")
        router.call("test_func")
        print("[✓] Call successful")
        
    except TimeoutError as e:
        print(f"[✗] Timeout: {e}")
        print("    Arduino may not be responding")
        traceback.print_exc()
    
    except ConnectionError as e:
        print(f"[✗] Connection Error: {e}")
        print("    Is arduino-router running?")
        traceback.print_exc()
    
    except Exception as e:
        print(f"[✗] Unexpected Error: {e}")
        traceback.print_exc()

if __name__ == "__main__":
    debug_bridge()
```

### Checklist di Debug

- [ ] Arduino IDE mostra upload "success"?
- [ ] Bridge.begin() ritorna true?
- [ ] Serial Monitor mostra messaggi debug da Arduino?
- [ ] Socket `/var/run/arduino-router.sock` esiste?
- [ ] Arduino Router service è in esecuzione?
- [ ] Funzioni esposte hanno nomi corretti?
- [ ] Parametri passati hanno tipi corretti?
- [ ] Timeout è sufficientemente lungo?

### Errori Comuni e Soluzioni

| Errore | Causa | Soluzione |
|--------|-------|----------|
| `Bridge.begin() ritorna false` | Router non disponibile | Riavvia Arduino/scheda |
| `Function not found` | Funzione non esposta | Verifica `Bridge.provide()` |
| `TimeoutError` | Arduino non risponde | Controlla sketch, aggiungi debug |
| `ConnectionError` | Router non raggiungibile | Verifica permessi, socket esiste? |
| `Type mismatch` | Parametri tipo sbagliato | Verifica tipi in Arduino e Python |

---

## Best Practices

### ✓ FALLO

```cpp
// ✓ Buono: Bridge nel setup()
void setup() {
  Bridge.begin();
  Bridge.provide("func", func);
}

// ✓ Buono: Nomi descrittivi
Bridge.provide("setLEDBrightness", setLEDBrightness);

// ✓ Buono: Gestisci errori
if (!Bridge.begin()) {
  Serial.println("Error!");
}

// ✓ Buono: Debug messages
void myFunc() {
  Serial.print("myFunc called, param=");
  Serial.println(param);
}
```

### ❌ NON FARLO

```cpp
// ❌ Sbagliato: Bridge.begin() nel loop
void loop() {
  Bridge.begin();  // SBAGLIATO!
}

// ❌ Sbagliato: Accedere a Serial1
Serial1.begin(9600);  // BLOCCATO da Router!

// ❌ Sbagliato: Accedere a /dev/ttyHS1
fopen("/dev/ttyHS1", "r");  // BLOCCATO!

// ❌ Sbagliato: Nomi poco chiari
Bridge.provide("f1", func1);  // Cosa fa f1?

// ❌ Sbagliato: Nessun error handling
Bridge.begin();  // Non controlla se fallisce
```

---

## Errori Comuni

### 1. "Bridge initialization failed"

```
Causa: arduino-router non è in esecuzione
Soluzione: 
- Riavvia la scheda
- Verifica che Debian Linux sia caricato
- Controlla messaggi di boot
```

### 2. "Function 'myFunc' not found"

```
Causa: Funzione non registrata con Bridge.provide()
Soluzione:
- Aggiungi Bridge.provide("myFunc", myFunc) nel setup()
- Verifica che il nome sia esatto
- Controlla che Arduino IDE abbia fatto upload
```

### 3. "Socket /var/run/arduino-router.sock not found"

```
Causa: Arduino Router non è in esecuzione
Soluzione (Linux/Python):
- systemctl status arduino-router
- systemctl restart arduino-router
- Controlla permessi file socket
```

### 4. "Type mismatch in parameter"

```
Causa: Parametro tipo sbagliato
Arduino espetta: int
Python manda: "string"

Soluzione:
- Verifica tipi in Arduino
- Verifica tipi in Python
- Usa same type on both sides
```

### 5. "TimeoutError: No response from device"

```
Causa: MCU non risponde in tempo
Soluzione:
- Aumenta timeout
- Verifica loop() non sia bloccato
- Aggiungi debug prints in Arduino
- Verifica delay() non sia troppo lungo
```

---

## Checklist

### Prima di Iniziare
- [ ] Arduino IDE 2.0+ installato
- [ ] Board package Arduino UNO Q installato
- [ ] Scheda connessa via USB-C
- [ ] Driver ST Microelectronics installati
- [ ] Port COM/seriale riconosciuto

### Sketch Arduino
- [ ] `#include <Arduino_RouterBridge.h>`
- [ ] `Bridge.begin()` nel setup()
- [ ] Almeno una `Bridge.provide()`
- [ ] Serial per debug inizializzato
- [ ] Loop() non ha delay troppo lunghi
- [ ] Nomi funzioni coerenti tra Arduino e Python

### Python
- [ ] `from arduino_router import ArduinoRouter`
- [ ] Gestione eccezioni con try/except
- [ ] Nomi funzioni esatti come Arduino
- [ ] Parametri tipo corretto
- [ ] Timeout appropriato

### Debugging
- [ ] Serial Monitor aperto durante test
- [ ] Debug prints in Arduino sketch
- [ ] Print statements in Python
- [ ] Verifica Bridge.begin() ritorna true
- [ ] Verifica ogni funzione singolarmente

---

## Workflow Tipico

### 1. Scrivi Arduino Sketch
```cpp
#include <Arduino_RouterBridge.h>

void myFunction(int value) {
  Serial.println(value);
}

void setup() {
  Serial.begin(115200);
  Bridge.begin();
  Bridge.provide("myFunction", myFunction);
}

void loop() {
  delay(100);
}
```

### 2. Upload su Arduino
- Arduino IDE → Sketch → Upload
- Attendi "Upload complete"

### 3. Apri Serial Monitor
- Arduino IDE → Tools → Serial Monitor
- Verifica debug messages

### 4. Scrivi Python Script
```python
from arduino_router import ArduinoRouter

router = ArduinoRouter()
router.call("myFunction", 42)
```

### 5. Esegui Python
```bash
python my_script.py
```

### 6. Verifica Serial Monitor
- Dovresti vedere il valore 42 stampato

### 7. Debug se Necessario
- Aggiungi più debug prints
- Aumenta timeout
- Controlla tipi parametri

---

## Risorse Ufficiali

- **Arduino UNO Q Docs**: https://docs.arduino.cc/hardware/uno-q
- **Arduino_RouterBridge GitHub**: https://github.com/arduino-libraries/Arduino_RouterBridge
- **Arduino Router GitHub**: https://github.com/arduino/arduino-router
- **Arduino IDE Download**: https://www.arduino.cc/en/software
- **Arduino Forum**: https://forum.arduino.cc/

---

## Cheat Sheet Veloce

### Arduino
```cpp
#include <Arduino_RouterBridge.h>

Bridge.begin();                          // Inizializza
Bridge.provide("name", function);        // Esponi
Bridge.call("name", param1, param2);     // Chiama
```

### Python
```python
from arduino_router import ArduinoRouter

router = ArduinoRouter()
router.call("name", param1, param2)      // Chiama Arduino
router.provide("name", function)         // Esponi a Arduino
```

### Tipi Supportati
```
Arduino: bool, int, float, double, const char*
Python:  bool, int, float, str
```

### Debug
```cpp
Serial.begin(115200);
Serial.println("Debug message");
```

```python
print("Debug message")
import traceback
traceback.print_exc()
```

