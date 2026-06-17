from fastapi import FastAPI
import redis
import json
import grpc
import paho.mqtt.client as mqtt
import priority_pb2, priority_pb2_grpc
import geolocation_pb2, geolocation_pb2_grpc  # Importaciones gRPC para Geolocalización
import os
import wave
# 1. IMPORTAR LIBRERÍA STT Y DATETIME CON TIMEZONE
from faster_whisper import WhisperModel
from datetime import datetime, timezone # <-- CORRECCIÓN TIMEZONE

app = FastAPI()
redis_client = redis.Redis(host=os.getenv('REDIS_HOST', 'redis'), port=6379, db=0)

MEDIA_DIR = "/app/media"
os.makedirs(MEDIA_DIR, exist_ok=True)

mqtt_client = mqtt.Client()

# Generamos un ID único para identificar qué instancia de recepción está procesando la alerta
INSTANCE_ID = os.getenv('HOSTNAME', 'reception_generic')

# 2. CARGAR EL MODELO GLOBALMENTE (Cambiado a "base" para mejor precisión)
stt_model = WhisperModel("base", device="cpu", compute_type="int8")

def get_priority(device_id, emergency_type="", transcription=""):
    try:
        channel = grpc.insecure_channel(os.getenv('PRIORITY_HOST'))
        stub = priority_pb2_grpc.PriorityClassifierStub(channel)
        response = stub.ClassifyAlert(priority_pb2.AlertRequest(
            device_id=device_id, 
            emergency_type=emergency_type,
            transcription=transcription  # Enviamos el texto transcrito
        ))
        # Extraemos la prioridad y la unidad (con fallback por si el proto no está actualizado)
        unidad = getattr(response, 'response_unit', 'Patrulla Sectorial')
        return response.priority_level, unidad
    except Exception as e:
        print(f"Error gRPC Priority: {e}")
        return "ALTO", "Patrulla Sectorial (Fallo IA)"

def on_connect(client, userdata, flags, rc):
    print(f"Conectado a MQTT Mosquitto con código: {rc} (Instancia: {INSTANCE_ID})")
    client.subscribe("$share/grupo_c5/c5/alerts")
    client.subscribe("alertas/+/fotos/#")
    client.subscribe("alertas/+/audio")

def on_message(client, userdata, msg):
    topic = msg.topic
    
    if topic == "c5/alerts":
        try:
            alert = json.loads(msg.payload.decode())
            device_id = alert['device_id']
            print(f"[{INSTANCE_ID}] Alerta JSON recibida para dispositivo: {device_id}")
            
            # Establecemos que ESTA instancia es dueña de procesar los datos de este dispositivo por los próximos 20 segundos
            redis_client.set(f"lock:device:{device_id}", INSTANCE_ID, ex=20)
            
            # --- Convertir timestamp del ESP32 a formato legible de fecha y hora ---
            try:
                # <-- CORRECCIÓN TIMEZONE: Forzar UTC explícitamente para evitar problemas con el reloj del contenedor
                dt = datetime.fromtimestamp(int(alert.get('timestamp', datetime.now(timezone.utc).timestamp())), tz=timezone.utc)
                dt_str = dt.strftime("%Y%m%d_%H%M%S")
            except Exception:
                # <-- CORRECCIÓN TIMEZONE: Fallback también en UTC
                dt_str = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
            
            # Definimos la carpeta única para ESTA alerta específica
            session_dir = f"{MEDIA_DIR}/{device_id}_{dt_str}"
            os.makedirs(session_dir, exist_ok=True)
            
            # Guardamos la ruta en Redis para mapear los fragmentos binarios que vendrán en camino
            redis_client.set(f"folder:device:{device_id}", session_dir, ex=20)
            
            # Inyectamos la ruta de la carpeta para que el microservicio 'history' o cualquier otro pueda leerla de la cola
            alert['media_folder'] = session_dir
            # -------------------------------------------------------------------------------
            
            # gRPC a Microservicio Priority (Primera evaluación sin audio)
            priority, response_unit = get_priority(device_id, emergency_type=alert['emergency_type'])
            alert['priority'] = priority
            alert['response_unit'] = response_unit # <-- AGREGAMOS LA UNIDAD
            
            # --- gRPC a Microservicio de Geolocalización ---
            try:
                # Nos conectamos al host definido en docker-compose (por defecto geolocation:50052)
                geo_channel = grpc.insecure_channel(os.getenv('GEOLOCATION_HOST', 'geolocation:50052'))
                geo_stub = geolocation_pb2_grpc.GeolocationServiceStub(geo_channel)
                
                # Enviamos las coordenadas a través del contrato estricto
                geo_response = geo_stub.ProcessLocation(geolocation_pb2.GeoRequest(
                    lat=alert.get('lat', 0.0),
                    lon=alert.get('lon', 0.0)
                ))
                
                # Extraemos la respuesta estructurada
                alert['zona_geografica'] = geo_response.zona_geografica
                alert['cuadrante'] = geo_response.cuadrante
                alert['maps_url'] = geo_response.maps_url  # Extraemos el link de Google Maps
                
            except Exception as e:
                # Si falla, truncamos el error a 140 caracteres para no colapsar la inserción en base de datos
                error_msg = f"Error gRPC Geo: {str(e)}"
                alert['zona_geografica'] = error_msg[:140]
                alert['cuadrante'] = "S/C"
                alert['maps_url'] = ""  # Fallback vacío en caso de error
            # -------------------------------------------------------------------------------
            
            # Empujamos a colas separadas para evitar que los microservicios compitan por el mismo mensaje
            payload_str = json.dumps(alert)
            redis_client.lpush('history_queue', payload_str)
            redis_client.lpush('notification_queue', payload_str)
            
            print(f"[{INSTANCE_ID}] Alerta procesada y enviada a Redis exitosamente con ruta: {session_dir}")
            
        except Exception as e:
            print(f"Error procesando JSON: {e}")
            
    elif "/fotos/" in topic:
        try:
            parts = topic.split("/")
            device_id = parts[1]
            
            owner = redis_client.get(f"lock:device:{device_id}")
            if owner and owner.decode() == INSTANCE_ID:
                folder_bytes = redis_client.get(f"folder:device:{device_id}")
                if folder_bytes:
                    target_dir = folder_bytes.decode()
                    foto_num = parts[3]
                    filename = f"{target_dir}/{device_id}_foto_{foto_num}.jpg"
                    with open(filename, "wb") as f:
                        f.write(msg.payload)
                    print(f"[{INSTANCE_ID}] Foto {foto_num} guardada con éxito en: {filename}")
        except Exception as e:
            print(f"Error guardando foto: {e}")
            
    elif "/audio" in topic:
        try:
            device_id = topic.split("/")[1]
            
            owner = redis_client.get(f"lock:device:{device_id}")
            if owner and owner.decode() == INSTANCE_ID:
                folder_bytes = redis_client.get(f"folder:device:{device_id}")
                if folder_bytes:
                    target_dir = folder_bytes.decode()
                    pcm_filename = f"{target_dir}/{device_id}_audio.pcm"
                    wav_filename = f"{target_dir}/{device_id}_audio.wav"
                    
                    if msg.payload == b"FIN":
                        print(f"[{INSTANCE_ID}] Recibida bandera FIN, ensamblando archivo WAV...")
                        if os.path.exists(pcm_filename):
                            with open(pcm_filename, "rb") as pcm_file:
                                pcm_data = pcm_file.read()
                                
                            with wave.open(wav_filename, "wb") as wav_file:
                                wav_file.setnchannels(1)           # Mono
                                wav_file.setsampwidth(2)           # 16-bit
                                wav_file.setframerate(16000)       # 16000 Hz
                                wav_file.writeframes(pcm_data)
                            print(f"[{INSTANCE_ID}] Audio finalizado y guardado exitosamente en: {wav_filename}")
                            
                            # 3. TRANSCRIBIR AUDIO INMEDIATAMENTE
                            try:
                                # 1. PRUEBA: Quitamos vad_filter y el initial_prompt por ahora.
                                # 2. PRUEBA: Si sigue sin funcionar, cambia "base" por "tiny" de nuevo en la línea 23.
                                segments, _ = stt_model.transcribe(
                                    wav_filename, 
                                    language="es", 
                                    beam_size=2  # Mantenemos esto porque sí ayuda a la precisión sin romper nada
                                )
                                texto_transcrito = " ".join([segment.text for segment in segments])
                                
                                
                                # Agregamos este print para ver si Whisper detectó ALGO, aunque sea vacío
                                print(f"[{INSTANCE_ID}] Texto crudo detectado: '{texto_transcrito}'")
                                
                                # GUARDAR EN TXT DENTRO DE LA CARPETA DINÁMICA
                                txt_filename = f"{target_dir}/{device_id}_transcripcion.txt"
                                with open(txt_filename, "w", encoding="utf-8") as txt_file:
                                    txt_file.write(texto_transcrito)
                                
                                # --- REEVALUAR PRIORIDAD Y UNIDAD BASADO EN AUDIO ---
                                nueva_prioridad, nueva_unidad = get_priority(device_id, transcription=texto_transcrito)
                                print(f"[{INSTANCE_ID}] Prioridad reevaluada: {nueva_prioridad} | Unidad: {nueva_unidad}")
                                
                                # Empujar actualización asíncrona a History y Notification
                                update_payload = {
                                    "action": "UPDATE_PRIORITY",
                                    "device_id": device_id,
                                    "priority": nueva_prioridad,
                                    "response_unit": nueva_unidad # <-- ENVIAMOS LA UNIDAD ACTUALIZADA
                                }
                                
                                redis_client.lpush('history_queue', json.dumps(update_payload))
                                redis_client.lpush('notification_queue', json.dumps(update_payload))
                                
                            except Exception as stt_err:
                                print(f"Error en transcripción: {stt_err}")
                                
                            try:
                                os.remove(pcm_filename)
                                print(f"[{INSTANCE_ID}] Archivo PCM temporal eliminado correctamente.")
                            except Exception as pcm_err:
                                print(f"Advertencia al borrar PCM: {pcm_err}")
                                
                        # Limpieza de llaves contextuales de la transmisión actual
                        redis_client.delete(f"lock:device:{device_id}")
                        redis_client.delete(f"folder:device:{device_id}")
                    else:
                        with open(pcm_filename, "ab") as f:
                            f.write(msg.payload)
        except Exception as e:
            print(f"Error guardando/convertiendo audio: {e}")

@app.on_event("startup")
def startup_mqtt_client():
    mqtt_client.on_connect = on_connect
    mqtt_client.on_message = on_message
    broker = os.getenv('MQTT_BROKER', 'mosquitto')
    try:
        mqtt_client.connect(broker, 1883, 60)
        mqtt_client.loop_start() 
        print("Hilo MQTT iniciado exitosamente.")
    except Exception as e:
        print(f"Error conectando a Mosquitto: {e}")