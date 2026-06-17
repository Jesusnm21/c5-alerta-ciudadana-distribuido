# Manual de Operación - Notification Service

## 1. Descripción General

El **Notification Service** es el microservicio responsable de distribuir alertas en tiempo real a los operadores conectados al sistema C5.

Su responsabilidad única es consumir alertas almacenadas en una cola Redis y enviarlas mediante WebSocket a todos los operadores que se encuentren conectados al sistema de monitoreo.

Este servicio no genera alertas, no las clasifica ni las almacena; únicamente actúa como mecanismo de distribución en tiempo real.

---

## 2. Entradas (Inputs)

### Cola Redis

El servicio consume mensajes desde la lista Redis:

```text
notification_queue
```

Cada elemento de la cola debe contener un JSON serializado con la información de la alerta.

### Ejemplo de mensaje recibido

```json
{
			"id": 4,
			"device_id": "XIAO_SENSE_01",
			"location": {
				"lat": 19.963964,
				"lon": -99.531973
			},
			"timestamp": 1781469817,
			"formatted_date": "2026-06-14 14:43:37",
			"emergency_type": "Urgencias Médicas",
			"priority": "CRITICO",
			"response_unit": "Patrulla Sectorial y Fuerza Especial",
			"geography": {
				"zona_geografica": "Central de Autobuses de Jilotepec",
				"cuadrante": "Sector Norte-Transporte",
				"maps_url": "https://www.google.com/maps?q=19.963964462280273,-99.53197479248047"
			},
			"media_attachments": {
				"media_folder": "/app/media/XIAO_SENSE_01_20260614_204337",
				"photos": [
					"/app/media/XIAO_SENSE_01_20260614_204337/XIAO_SENSE_01_foto_1.jpg",
					"/app/media/XIAO_SENSE_01_20260614_204337/XIAO_SENSE_01_foto_2.jpg",
					"/app/media/XIAO_SENSE_01_20260614_204337/XIAO_SENSE_01_foto_3.jpg"
				],
				"audio_wav": "/app/media/XIAO_SENSE_01_20260614_204337/XIAO_SENSE_01_audio.wav",
				"transcription_txt": "/app/media/XIAO_SENSE_01_20260614_204337/XIAO_SENSE_01_transcripcion.txt"
			},
			"persisted_at": "2026-06-14T20:43:37.909840"
		}
```

### Conexiones WebSocket

El servicio recibe conexiones de operadores mediante:

```text
/ws/operators
```

Estas conexiones representan los clientes que recibirán las alertas en tiempo real.

---

## 3. Salidas (Outputs)

### Alertas enviadas por WebSocket

Por cada alerta consumida desde Redis, el servicio envía el mismo mensaje JSON a todos los operadores conectados.

Ejemplo:

```json
{
			"id": 4,
			"device_id": "XIAO_SENSE_01",
			"location": {
				"lat": 19.963964,
				"lon": -99.531973
			},
			"timestamp": 1781469817,
			"formatted_date": "2026-06-14 14:43:37",
			"emergency_type": "Urgencias Médicas",
			"priority": "CRITICO",
			"response_unit": "Patrulla Sectorial y Fuerza Especial",
			"geography": {
				"zona_geografica": "Central de Autobuses de Jilotepec",
				"cuadrante": "Sector Norte-Transporte",
				"maps_url": "https://www.google.com/maps?q=19.963964462280273,-99.53197479248047"
			},
			"media_attachments": {
				"media_folder": "/app/media/XIAO_SENSE_01_20260614_204337",
				"photos": [
					"/app/media/XIAO_SENSE_01_20260614_204337/XIAO_SENSE_01_foto_1.jpg",
					"/app/media/XIAO_SENSE_01_20260614_204337/XIAO_SENSE_01_foto_2.jpg",
					"/app/media/XIAO_SENSE_01_20260614_204337/XIAO_SENSE_01_foto_3.jpg"
				],
				"audio_wav": "/app/media/XIAO_SENSE_01_20260614_204337/XIAO_SENSE_01_audio.wav",
				"transcription_txt": "/app/media/XIAO_SENSE_01_20260614_204337/XIAO_SENSE_01_transcripcion.txt"
			},
			"persisted_at": "2026-06-14T20:43:37.909840"
		}
```

### Eventos de operación

El servicio genera registros de auditoría (logs) relacionados con:

* Conexión de operadores.
* Desconexión de operadores.
* Entrega exitosa de alertas.
* Fallos de entrega.
* Reintentos de procesamiento.

---

## 4. Proceso Interno (Flujo)

### Paso 1. Inicio del servicio

Al arrancar el contenedor, FastAPI inicia un proceso en segundo plano encargado de consumir mensajes desde Redis.

### Paso 2. Espera de operadores

El servicio verifica continuamente si existen operadores conectados mediante WebSocket.

Si no hay operadores conectados, las alertas permanecen en Redis y no son consumidas.

### Paso 3. Consumo de alerta

Cuando existe al menos un operador conectado, el servicio extrae una alerta desde la cola Redis:

```text
notification_queue
```

### Paso 4. Deserialización

La alerta obtenida desde Redis es convertida desde texto JSON a un objeto Python para su procesamiento.

### Paso 5. Distribución

La alerta es enviada a todos los operadores actualmente conectados mediante WebSocket.

### Paso 6. Validación de entrega

El servicio verifica si al menos un operador recibió correctamente la alerta.

* Si la entrega fue exitosa, la alerta se considera procesada.
* Si ninguna entrega fue exitosa, la alerta es reinsertada en Redis para su posterior reintento.

### Paso 7. Continuación del procesamiento

El proceso vuelve al estado de espera para consumir la siguiente alerta disponible.

---

## 5. Dependencias

### Redis

Dependencia obligatoria.

Funciones:

* Almacenamiento temporal de alertas.
* Cola de distribución (`notification_queue`).
* Persistencia de mensajes pendientes de entrega.

Variable utilizada:

```env
REDIS_HOST=redis
```

### Clientes WebSocket

Dependencia obligatoria.

Corresponden a los sistemas de monitoreo u operadores que consumen las alertas generadas por el C5.

Endpoint utilizado:

```text
/ws/operators
```

### FastAPI

Framework utilizado para exponer el endpoint WebSocket y administrar el ciclo de vida del servicio.

### Uvicorn

Servidor ASGI encargado de ejecutar la aplicación FastAPI.
