# Microservicio de Recepción de Alertas (`services/reception`)

El **Microservicio de Recepción de Alertas** funciona como el punto de ingesta principal de eventos críticos dentro del ecosistema del C5. Su propósito primordial es actuar como una compuerta de enlace de alta disponibilidad para dispositivos IoT distribuídos en campo (ej. módulos basados en ESP32), gestionando tanto la telemetría inicial de emergencia como los flujos de archivos multimedia asociados (imágenes y audio PCM).

## Índice

1. [Descripción General](#1-descripción-general)
2. [Interfaces de Entrada (Inputs)](#2-interfaces-de-entrada-inputs)
3. [Interfaces de Salida (Outputs)](#3-interfaces-de-salida-outputs)
4. [Proceso Interno (Flujo Detallado)](#4-proceso-interno-flujo-detallado)
5. [Contratos y Comunicaciones gRPC](#5-contratos-y-comunicaciones-grpc)
6. [Infraestructura y Dependencias](#6-infraestructura-y-dependencias)
7. [Configuración del Entorno](#7-configuración-del-entorno)



## 1. Descripción General

La responsabilidad única de este microservicio dentro del C5 es la **recepción coordinada, procesamiento primario, enriquecimiento contextual y despacho estructurado** de las alertas entrantes.

A diferencia de un servicio REST tradicional de corta duración, este componente mantiene una naturaleza híbrida: levanta un ciclo asíncrono para escuchar transmisiones binarias continuas desde un Broker MQTT, utiliza mecanismos de bloqueo distribuido para garantizar la concurrencia, procesa audio en tiempo real mediante Inteligencia Artificial (Speech-to-Text con *Faster-Whisper*) y unifica los datos con otros microservicios del ecosistema antes de encolar las alertas operativas definitivas.


## 2. Interfaces de Entrada (Inputs)

El microservicio se suscribe activamente a tres canales de entrada mediante el protocolo MQTT:

### A. Metadatos de Alerta (JSON)

* **Tópico:** `$share/grupo_c5/c5/alerts` (Suscripción compartida para balanceo de carga)
* **Formato:** JSON String
* **Estructura Esperada:**

```json
{
  "device_id": "ESP32-CORE-01X",
  "emergency_type": "Asalto / Intrusión",
  "timestamp": 1718364000,
  "lat": 19.432608,
  "lon": -99.133209
}
```

### B. Segmentos de Fotografía (Binario)

* **Tópico:** `alertas/+/fotos/#` (El primer comodín es el `device_id`; el subsecuente indica el identificador del fragmento)
* **Formato:** Payload binario bruto (bytes) correspondiente a fragmentos secuenciales de una imagen comprimida en formato JPG.

### C. Secuencia de Audio (Binario / Señal de Control)

* **Tópico:** `alertas/+/audio` (El comodín es el `device_id`)
* **Formato:** Carga útil dual compuesta por transmisión continua (fragmentos binarios de audio digital en formato plano PCM) y un mensaje de control (el texto plano `FIN` en formato binario `b"FIN"`, utilizado para cerrar la transmisión y ordenar el ensamble del archivo).

## 3. Interfaces de Salida (Outputs)

El microservicio produce salidas persistentes en el sistema de archivos y emite eventos asíncronos en memoria administrados por Redis:

### A. Estructura Física de Medios (File System)

Los archivos se almacenan en volúmenes compartidos bajo la ruta `/app/media/`, utilizando un esquema de directorios dinámicos estructurados por dispositivo y marca de tiempo (`{device_id}_{YYYYMMDD_HHMMSS}/`):

* `...foto{foto_num}.jpg`: Capturas visuales reconstruidas de la escena.
* `..._audio.wav`: Audio consolidado en formato de onda legible (WAV: Mono, 16-bit, 16000Hz).
* `..._transcripcion.txt`: Archivo de texto plano con la transcripción literal del audio obtenida mediante Whisper.

### B. Eventos hacia Colas de Mensajería (Redis LPUSH)

El microservicio empuja cargas JSON simultáneamente a dos colas: `history_queue` (para persistencia en base de datos histórica) y `notification_queue` (para despacho y alertamiento a consolas de operadores en tiempo real).

#### Payload de Alerta Enriquecida Inicial

Inyecta datos geográficos, prioridades de despacho e información de carpetas del sistema.

```json id="jx8b8g"
{
  "device_id": "ESP32-CORE-01X",
  "emergency_type": "Asalto / Intrusión",
  "timestamp": 1718364000,
  "lat": 19.432608,
  "lon": -99.133209,
  "media_folder": "/app/media/ESP32-CORE-01X_20260614_055900",
  "priority": "ALTO",
  "response_unit": "Patrulla Sectorial",
  "zona_geografica": "Zona Centro",
  "cuadrante": "C-04-S3",
  "maps_url": "https://maps.google.com/?q=19.432608,-99.133209"
}
```

#### Payload de Actualización Asíncrona (`UPDATE_PRIORITY`)

Se emite inmediatamente después de procesar y transcribir el audio, permitiendo escalar prioridades de respuesta en caliente.

```json id="kq03nm"
{
  "action": "UPDATE_PRIORITY",
  "device_id": "ESP32-CORE-01X",
  "priority": "CRÍTICO",
  "response_unit": "Fuerzas Especiales / Ambulancia Médica"
}
```

## 4. Proceso Interno (Flujo Detallado)

Desde que un dispositivo activa su alarma, el flujo interno sigue una secuencia estricta dividida en fases asíncronas concurrentes:

```text id="7y4ozs"
[Dispositivo IoT] --(MQTT)--> [Reception Service]
                                     |
          +--------------------------+--------------------------+
          | (Fase 1: JSON)           | (Fase 2: Multimedia)     | (Fase 3: Audio FIN)
          v                          v                          v
  Crear Carpeta Sesión        Validar Dueño Lock         Ensamblar WAV
  Consultar gRPC Geo          Escribir JPGs en Disco     Ejecutar Whisper STT
  Consultar gRPC Priority                                Reevaluar Prioridad gRPC
  LPUSH Inicial a Redis                                  LPUSH Update a Redis
```

### Fase 1: Recepción e Ingesta de Datos Iniciales

* **Recepción:** El hilo de escucha recibe una alerta en el tópico `c5/alerts`.
* **Coordinación de Instancias:** Para evitar colisiones en entornos multi-contenedor, la instancia actual adquiere exclusividad sobre los datos del dispositivo configurando un bloqueo distribuido en Redis (`lock:device:{device_id}`) con expiración automática de 20 segundos.
* **Normalización del Tiempo:** El `timestamp` del hardware se traduce forzadamente a la zona horaria UTC (`timezone.utc`) para blindar el sistema contra descalibraciones del contenedor.
* **Reserva de Ubicación:** Se crea un directorio físicamente seguro dentro del contenedor. La ruta se guarda en Redis (`folder:device:{device_id}`) durante 20 segundos para guiar el flujo de los binarios entrantes.
* **Orquestación gRPC (Enriquecimiento):** Se solicitan en paralelo los datos de clasificación de emergencia al microservicio Priority y la traducción de coordenadas físicas a límites políticos (Zona, Cuadrante) al microservicio Geolocation.
* **Despacho Base:** Los datos unificados se depositan concurrentemente en `history_queue` y `notification_queue`.

### Fase 2: Reconstrucción Multimedia In-Stream

* **Intercepción:** Se reciben los paquetes de imágenes (`/fotos/`) y secuencias de audio (`/audio`).
* **Validación de Bloqueo:** Se evalúa que la instancia actual posea los derechos del bloqueo activo en Redis. Si coincide con el `INSTANCE_ID`, procesa los bytes; de lo contrario, los ignora.
* **Procesamiento Visual:** Las imágenes se guardan directamente como archivos independientes `.jpg`.
* **Procesamiento Auditivo:** Los fragmentos de audio se concatenan en modo de adición binaria (`"ab"`) en un archivo crudo temporal `.pcm`.

### Fase 3: Transcripción Inteligente y Reevaluación en Caliente

* **Cierre de Flujo:** Al recibir el payload binario `FIN` en el canal de audio, se detiene la captura.
* **Codificación:** El archivo temporal `.pcm` se procesa y empaqueta en un contenedor `.wav` (Mono, 16 bits, 16000 Hz), formato óptimo para reconocimiento de voz.
* **Inferencia Whisper:** El motor neuronal `faster-whisper` realiza la decodificación del audio a lenguaje natural.
* **Reevaluación de Prioridad:** El texto resultante se envía en una segunda consulta remota gRPC al microservicio de prioridades. Si la IA detecta agravantes invisibles en el reporte inicial (ej. personas heridas o detonaciones), la prioridad y la unidad operativa escalan de inmediato.
* **Actualización:** Se despacha el mensaje con la acción `UPDATE_PRIORITY` a las colas de Redis.
* **Limpieza:** Se destruye de forma segura el archivo de audio crudo `.pcm` y se eliminan las llaves de contexto en Redis, liberando el bloqueo del dispositivo.

## 5. Contratos y Comunicaciones gRPC

El microservicio compila de manera automatizada durante su construcción los siguientes esquemas de comunicación estricta:

### A. Servicio de Clasificación de Prioridades (`priority.proto`)

* **Método Remoto:** `ClassifyAlert`
* **Mensaje de Solicitud (`AlertRequest`):** Envía `device_id`, `emergency_type` y la variable `transcription` (vacía en Fase 1, poblada en Fase 3).
* **Mensaje de Respuesta (`PriorityResponse`):** Devuelve el `priority_level` (ej. `BAJO`, `MEDIO`, `ALTO`, `CRÍTICO`), `matched_rule` (justificación legal/operativa) y la asignación automatizada de la `response_unit`.

### B. Servicio de Geodesia y Ubicación (`geolocation.proto`)

* **Método Remoto:** `ProcessLocation`
* **Mensaje de Solicitud (`GeoRequest`):** Envía coordenadas flotantes estrictas `lat` y `lon`.
* **Mensaje de Respuesta (`GeoResponse`):** Retorna `zona_geografica`, `cuadrante` (identificador interno de patrulla) y la cadena con la dirección generada en `maps_url`.


## 6. Infraestructura y Dependencias

El contenedor opera bajo un ecosistema distribuido y depende críticamente de los siguientes componentes:

* **Python 3.10-slim + GCC:** Entorno ligero de ejecución equipado con herramientas esenciales de compilación para enlazar extensiones binarias de gRPC y Whisper.
* **Broker Mosquitto:** Servidor de mensajería encargado de distribuir y enrutar el tráfico de red de los dispositivos en campo.
* **Redis (v5.0+):** Utilizado simultáneamente como base de datos clave-valor de latencia ultrabaja para estados de locking y como broker de colas FIFO (`LPUSH/RPOPLPUSH`).
* **Dependencias Core (`requirements.txt`):**

  * `fastapi` y `uvicorn`: Proveen el ciclo de vida base de la aplicación.
  * `paho-mqtt`: Cliente de comunicación asíncrona para Mosquitto.
  * `grpcio` y `grpcio-tools`: Motor de transporte de RPCs de alto rendimiento.
  * `faster-whisper`: Motor de machine learning para el procesamiento del lenguaje.

## 7. Configuración del Entorno

Las siguientes variables de entorno deben estar inyectadas en el contenedor para asegurar su correcta interconexión con el clúster (generalmente configuradas en un archivo `docker-compose.yaml`):

| Variable de Entorno | Propósito                                            | Valor de Ejemplo / Fallback           |
| ------------------- | ---------------------------------------------------- | ------------------------------------- |
| `REDIS_HOST`        | Nombre del host o IP de la instancia de Redis.       | `redis`                               |
| `MQTT_BROKER`       | Host del Broker Mosquitto encargado de las alertas.  | `mosquitto`                           |
| `PRIORITY_HOST`     | Dirección de red del microservicio gRPC Priority.    | `priority:50051`                      |
| `GEOLOCATION_HOST`  | Dirección de red del microservicio gRPC Geolocation. | `geolocation:50052`                   |
| `HOSTNAME`          | Identificador único del contenedor instanciado.      | *(Asignado dinámicamente por Docker)* |
