#include <WiFi.h>
#include <PubSubClient.h>
#include "esp_camera.h"
#include <driver/i2s_pdm.h> // API de I2S para Core 3.x
#include <time.h>           // Librería para manejar el tiempo

// ==========================================
// CONFIGURACIÓN DE RED Y MQTT
// ==========================================
const char* ssid = "Steren COM-870+_F1F0";
const char* password = "steren2000";
const char* mqtt_server = "192.168.2.125"; 
const int mqtt_port = 1883;

// Configuración de Servidor de Tiempo (NTP)
const char* ntpServer = "pool.ntp.org";
const long  gmtOffset_sec = 0;       // 0 para timestamp UNIX estándar (UTC)
const int   daylightOffset_sec = 0;

WiFiClient espClient;
PubSubClient client(espClient);

// ==========================================
// DEFINICIÓN DE PINES (XIAO ESP32S3)
// ==========================================
#define BUTTON_PIN    2  // D1
#define RED_LED_PIN   3  // D2
#define GREEN_LED_PIN 4  // D3

// Pines del Micrófono PDM
#define I2S_WS_PIN    42 // Reloj
#define I2S_DATA_PIN  41 // Datos

i2s_chan_handle_t rx_chan; 

// ==========================================
// CONFIGURACIÓN DE LA CÁMARA (XIAO SENSE)
// ==========================================
#define PWDN_GPIO_NUM     -1
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM     10
#define SIOD_GPIO_NUM     40
#define SIOC_GPIO_NUM     39
#define Y9_GPIO_NUM       48
#define Y8_GPIO_NUM       11
#define Y7_GPIO_NUM       12
#define Y6_GPIO_NUM       14
#define Y5_GPIO_NUM       16
#define Y4_GPIO_NUM       18
#define Y3_GPIO_NUM       17
#define Y2_GPIO_NUM       15
#define VSYNC_GPIO_NUM    38
#define HREF_GPIO_NUM     47
#define PCLK_GPIO_NUM     13

// ==========================================
// VARIABLES DE ALMACENAMIENTO (PSRAM)
// ==========================================
uint8_t* photoBuffers[3] = {nullptr, nullptr, nullptr};
size_t photoLengths[3] = {0, 0, 0};

const int sampleRate = 16000; 
const int durationSecs = 5;
const size_t audioBufferSize = sampleRate * 2 * durationSecs; 
uint8_t* audioBuffer = nullptr;
size_t actualAudioLength = 0; 

// ==========================================
// CONTROL DE ESTADOS Y FREERTOS
// ==========================================
// --- NUEVO: Agregamos el estado COUNTING_CLICKS ---
enum SystemState { IDLE, COUNTING_CLICKS, CAPTURING, SENDING };
SystemState currentState = IDLE;

TaskHandle_t blinkTaskHandle = NULL;

// --- NUEVO: Variables para controlar múltiples pulsaciones ---
bool buttonState = HIGH;      // Estado actual filtrado
bool lastButtonState = HIGH;  // Estado anterior sin filtrar
unsigned long lastDebounceTime = 0;
unsigned long debounceDelay = 50;

int clickCount = 0;
unsigned long lastClickTime = 0;
const unsigned long CLICK_TIMEOUT = 2000; // 2 segundos (2000 ms) para presionar de nuevo
String currentEmergencyType = "Desconocida";
// -------------------------------------------------------------

// ==========================================
// FIRMAS DE FUNCIONES
// ==========================================
void setup_wifi();
void reconnectMQTT();
void initCamera();
void initMic();
void captureData();
void sendDataToMicroservice();
void cleanUpMemory();
void blinkTask(void *pvParameters);

// ==========================================
// SETUP
// ==========================================
void setup() {
  Serial.begin(115200);
  
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(RED_LED_PIN, OUTPUT);
  pinMode(GREEN_LED_PIN, OUTPUT);
  digitalWrite(RED_LED_PIN, LOW);
  digitalWrite(GREEN_LED_PIN, LOW);

  setup_wifi();

  client.setServer(mqtt_server, mqtt_port);
  client.setBufferSize(102400); 

  initCamera();
  initMic();

  Serial.println("Sistema Listo. Esperando alerta...");
}

// ==========================================
// LOOP PRINCIPAL
// ==========================================
void loop() {
  if (!client.connected()) {
    reconnectMQTT();
  }
  client.loop();

  // --- CORREGIDO: Lógica de debounce para registrar cada click exacto ---
  int reading = digitalRead(BUTTON_PIN);
  if (reading != lastButtonState) {
    lastDebounceTime = millis();
  }

  if ((millis() - lastDebounceTime) > debounceDelay) {
    if (reading != buttonState) {
      buttonState = reading;
      
      // Si el botón acaba de ser PRESIONADO (flanco de bajada)
      if (buttonState == LOW) {
        if (currentState == IDLE) {
          // Primer Click
          currentState = COUNTING_CLICKS;
          clickCount = 1;
          lastClickTime = millis();
          Serial.println("Click 1 detectado. Esperando posibles clics extra...");
        } else if (currentState == COUNTING_CLICKS) {
          // Clics subsecuentes
          clickCount++;
          lastClickTime = millis(); // Reinicia la ventana de 2 segundos
          Serial.printf("Click %d detectado. Esperando...\n", clickCount);
        }
      }
    }
  }
  lastButtonState = reading;
  // ----------------------------------------------------------------------

  switch (currentState) {
    case IDLE:
      break;

    // --- NUEVO: Estado para procesar la espera de clics ---
    case COUNTING_CLICKS:
      // Si han pasado 2 segundos sin presionar el botón de nuevo
      if ((millis() - lastClickTime) > CLICK_TIMEOUT) {
        
        // Asignamos el tipo según la cantidad de clics
        switch (clickCount) {
          case 1: currentEmergencyType = "Urgencias Médicas"; break;
          case 2: currentEmergencyType = "Seguridad Pública"; break;
          case 3: currentEmergencyType = "Protección Civil"; break;
          default: currentEmergencyType = "Fallas de Servicios y Movilidad"; break; // 4 o más
        }
        
        Serial.printf("Tiempo expirado. Clics totales: %d. Tipo asignado: %s\n", clickCount, currentEmergencyType.c_str());
        Serial.println("ALERTA: Iniciando recolección de pruebas...");
        
        digitalWrite(GREEN_LED_PIN, LOW);
        currentState = CAPTURING;
        clickCount = 0; // Reseteamos para futuras alertas
      }
      break;
    // ------------------------------------------------------

    case CAPTURING:
      xTaskCreatePinnedToCore(blinkTask, "BlinkTask", 1024, NULL, 1, &blinkTaskHandle, 1);
      
      captureData(); 
      
      if (blinkTaskHandle != NULL) {
        vTaskDelete(blinkTaskHandle);
        blinkTaskHandle = NULL;
      }
      digitalWrite(RED_LED_PIN, LOW);
      
      currentState = SENDING;
      break;

    case SENDING:
      digitalWrite(RED_LED_PIN, HIGH); 
      
      sendDataToMicroservice();
      cleanUpMemory(); 
      
      digitalWrite(RED_LED_PIN, LOW);
      digitalWrite(GREEN_LED_PIN, HIGH); 
      
      Serial.println("Transmisión finalizada. Retornando a reposo.");
      currentState = IDLE;
      break;
  }
}

// ==========================================
// TAREA PARALELA (FREERTOS) PARA LED ROJO
// ==========================================
void blinkTask(void *pvParameters) {
  bool ledState = false;
  for (;;) {
    ledState = !ledState;
    digitalWrite(RED_LED_PIN, ledState);
    vTaskDelay(200 / portTICK_PERIOD_MS); 
  }
}

// ==========================================
// CAPTURA DE DATOS EN PSRAM
// ==========================================
void captureData() {
  Serial.println("Capturando 3 fotografías...");
  for(int i = 0; i < 3; i++) {
    camera_fb_t * fb = esp_camera_fb_get();
    if (!fb) {
      Serial.println("Fallo al tomar foto");
      continue;
    }
    photoBuffers[i] = (uint8_t*) ps_malloc(fb->len);
    if(photoBuffers[i] != nullptr) {
      memcpy(photoBuffers[i], fb->buf, fb->len);
      photoLengths[i] = fb->len;
    }
    esp_camera_fb_return(fb); 
    delay(200); 
  }

  Serial.println("Iniciando grabación de audio (5 segundos)...");
  audioBuffer = (uint8_t*) ps_malloc(audioBufferSize);
  actualAudioLength = 0; 
  
  if(audioBuffer == nullptr) {
    Serial.println("Error: Sin memoria PSRAM para audio");
    return;
  }

  size_t bytesRead = 0;
  size_t totalRead = 0;
  unsigned long startRecordTime = millis();
  
  uint8_t tempBuffer[1024]; 
  
  while (totalRead < audioBufferSize && (millis() - startRecordTime) < 5500) {
    
    esp_err_t result = i2s_channel_read(rx_chan, tempBuffer, 1024, &bytesRead, 100 / portTICK_PERIOD_MS);
    
    if (result == ESP_OK && bytesRead > 0) {
      int16_t* samples = (int16_t*)tempBuffer;
      int numSamples = bytesRead / 2; 
      
      for (int j = 0; j < numSamples; j += 2) {
        if (totalRead < audioBufferSize) {
          memcpy(audioBuffer + totalRead, &samples[j], 2);
          totalRead += 2;
        } else {
          break;
        }
      }
    }
    client.loop();
    vTaskDelay(1 / portTICK_PERIOD_MS);
  }
 
  actualAudioLength = totalRead; 
  Serial.printf("Audio grabado. Logrado: %d de %d bytes\n", actualAudioLength, audioBufferSize);
}

// ==========================================
// TRANSMISIÓN MQTT (CHUNKING)
// ==========================================
void sendDataToMicroservice() {
  Serial.println("Publicando en tópicos MQTT...");
  
  time_t now;
  time(&now);
  
  String device_id = "XIAO_SENSE_01";
  
  // --- CORREGIDO: Injectamos la variable currentEmergencyType en el JSON ---
  String payload = "{\"device_id\":\"" + device_id + "\", \"lat\":19.963964, \"lon\":-99.531973, \"emergency_type\":\"" + currentEmergencyType + "\", \"timestamp\":" + String(now) + "}";
  // -------------------------------------------------------------------------
  
  client.publish("c5/alerts", payload.c_str());
  
  for(int i = 0; i < 3; i++) {
    if(photoBuffers[i] != nullptr) {
      String topic = "alertas/" + device_id + "/fotos/" + String(i + 1);
      if(client.publish(topic.c_str(), photoBuffers[i], photoLengths[i])) {
        Serial.printf("Foto %d enviada (%d bytes)\n", i+1, photoLengths[i]);
      } else {
        Serial.printf("Fallo al enviar foto %d\n", i+1);
      }
    }
  }

  if(audioBuffer != nullptr && actualAudioLength > 0) {
    String topicAudio = "alertas/" + device_id + "/audio";
    
    int chunkSize = 4096; 
    int bytesSent = 0;
    bool success = true;

    Serial.println("Enviando audio en fragmentos...");
    
    while (bytesSent < actualAudioLength) {
      int remaining = actualAudioLength - bytesSent;
      int currentChunkSize = (remaining < chunkSize) ? remaining : chunkSize;

      if (!client.publish(topicAudio.c_str(), audioBuffer + bytesSent, currentChunkSize)) {
        Serial.printf("Fallo al enviar el fragmento en el byte %d\n", bytesSent);
        success = false;
        break; 
      }
      
      bytesSent += currentChunkSize;
      client.loop(); 
      delay(10); 
    }

    if (success) {
      client.publish(topicAudio.c_str(), "FIN", 3);
      Serial.printf("Audio enviado exitosamente en fragmentos (%d bytes)\n", bytesSent);
    }
  }
}

// ==========================================
// LIBERACIÓN DE MEMORIA DINÁMICA
// ==========================================
void cleanUpMemory() {
  for(int i = 0; i < 3; i++) {
    if(photoBuffers[i] != nullptr) {
      free(photoBuffers[i]);
      photoBuffers[i] = nullptr;
      photoLengths[i] = 0;
    }
  }
  if(audioBuffer != nullptr) {
    free(audioBuffer);
    audioBuffer = nullptr;
  }
}

// ==========================================
// INICIALIZACIÓN DE HARDWARE Y REDES
// ==========================================
void setup_wifi() {
  delay(10);
  Serial.println("\nConectando a red WiFi...");
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi conectado. IP: ");
  Serial.println(WiFi.localIP());

  configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);
  Serial.println("Sincronizando hora con NTP...");
}

void reconnectMQTT() {
  while (!client.connected()) {
    Serial.print("Conectando al Broker MQTT...");
    if (client.connect("DispositivoAlerta_01")) {
      Serial.println("¡Conectado!");
    } else {
      Serial.print("Fallo, rc=");
      Serial.print(client.state());
      Serial.println(" reintentando en 5s");
      delay(5000);
    }
  }
}

void initCamera() {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM; config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM; config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM; config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM; config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM; config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM; config.pin_href = HREF_GPIO_NUM;
  config.pin_sscb_sda = SIOD_GPIO_NUM; config.pin_sscb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM; config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.frame_size = FRAMESIZE_VGA;
  config.pixel_format = PIXFORMAT_JPEG;
  config.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
  config.fb_location = CAMERA_FB_IN_PSRAM;
  config.jpeg_quality = 12;
  config.fb_count = 1;

  if (esp_camera_init(&config) != ESP_OK) {
    Serial.println("Fallo al inicializar la cámara.");
  }
}

void initMic() {
  i2s_chan_config_t chan_cfg = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_AUTO, I2S_ROLE_MASTER);
  chan_cfg.dma_desc_num = 8;
  chan_cfg.dma_frame_num = 1024;

  if (i2s_new_channel(&chan_cfg, NULL, &rx_chan) != ESP_OK) {
    Serial.println("Fallo al crear canal I2S");
    return;
  }

  i2s_pdm_rx_config_t pdm_rx_cfg = {
      .clk_cfg = I2S_PDM_RX_CLK_DEFAULT_CONFIG(sampleRate),
      .slot_cfg = I2S_PDM_RX_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_STEREO),
      .gpio_cfg = {
          .clk = (gpio_num_t)I2S_WS_PIN,
          .din = (gpio_num_t)I2S_DATA_PIN,
          .invert_flags = {
              .clk_inv = false,
          },
      },
  };
  
  pdm_rx_cfg.slot_cfg.slot_mask = I2S_PDM_SLOT_LEFT;

  if (i2s_channel_init_pdm_rx_mode(rx_chan, &pdm_rx_cfg) != ESP_OK) {
    Serial.println("Fallo al inicializar modo PDM");
    return;
  }
  
  if (i2s_channel_enable(rx_chan) != ESP_OK) {
    Serial.println("Fallo al habilitar canal I2S");
  } else {
    Serial.println("Micrófono I2S PDM inicializado correctamente (Core 3.x)");
  }
}
