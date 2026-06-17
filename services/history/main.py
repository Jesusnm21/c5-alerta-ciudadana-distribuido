import os
import json
import threading
import time 
from datetime import datetime, timezone, timedelta # <-- CORRECCIÓN TIMEZONE
from fastapi import FastAPI, Query, HTTPException
import redis

from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import create_engine, Column, Integer, BigInteger, Float, String, DateTime
from sqlalchemy.orm import declarative_base, sessionmaker

app = FastAPI(
    title="C5 Alerta Ciudadana - Microservicio de Historial",
    description="Encargado de la persistencia asíncrona (Maestro) y consultas distribuidas (Réplica)"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs("/app/media", exist_ok=True)
app.mount("/media", StaticFiles(directory="/app/media"), name="media")

DB_MASTER_URL = os.getenv('DB_MASTER')
DB_REPLICA_URL = os.getenv('DB_REPLICA')
REDIS_HOST = os.getenv('REDIS_HOST', 'redis')

if not DB_MASTER_URL or not DB_REPLICA_URL:
    raise ValueError("Las variables de entorno DB_MASTER y DB_REPLICA deben estar configuradas.")

engine_master = create_engine(DB_MASTER_URL, pool_pre_ping=True, pool_size=10, max_overflow=20)
engine_replica = create_engine(DB_REPLICA_URL, pool_pre_ping=True, pool_size=10, max_overflow=20)

SessionMaster = sessionmaker(bind=engine_master)
SessionReplica = sessionmaker(bind=engine_replica)

redis_client = redis.Redis(host=REDIS_HOST, port=6379, db=0)

Base = declarative_base()

class AlertLog(Base):
    __tablename__ = "alert_logs"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(String(50), nullable=False, index=True)
    lat = Column(Float, nullable=False)
    lon = Column(Float, nullable=False)
    timestamp = Column(BigInteger, nullable=False, index=True) 
    emergency_type = Column(String(100), nullable=False)
    priority = Column(String(20), nullable=False, index=True)
    zona_geografica = Column(String(150), nullable=True, index=True)
    cuadrante = Column(String(50), nullable=True)
    maps_url = Column(String(255), nullable=True)  
    media_folder = Column(String(255), nullable=True)
    response_unit = Column(String(100), nullable=True) # <-- NUEVA COLUMNA
    created_at = Column(DateTime, default=datetime.utcnow) 

def redis_alerts_worker():
    print("[WORKER] Hilo de persistencia asíncrona iniciado correctamente.")
    while True:
        try:
            result = redis_client.brpop('history_queue', timeout=5)
            if result:
                _, data = result
                alert_data = json.loads(data.decode('utf-8'))
                
                if alert_data.get("action") == "UPDATE_PRIORITY":
                    session = SessionMaster()
                    try:
                        log = session.query(AlertLog).filter(
                            AlertLog.device_id == alert_data['device_id']
                        ).order_by(AlertLog.id.desc()).first()
                        
                        if log:
                            changed = False
                            
                            # Actualización de Prioridad
                            if 'priority' in alert_data and log.priority != alert_data['priority']:
                                log.priority = alert_data['priority']
                                changed = True
                                
                            # Actualización de Etiqueta/Categoría
                            if 'emergency_type' in alert_data and log.emergency_type != alert_data['emergency_type']:
                                log.emergency_type = alert_data['emergency_type']
                                changed = True
                                
                            # Actualización de Unidad de Respuesta
                            if 'response_unit' in alert_data and log.response_unit != alert_data['response_unit']:
                                log.response_unit = alert_data['response_unit']
                                changed = True

                            if changed:
                                session.commit()
                                print(f"[WORKER] UPDATE: Prioridad/Unidad de {log.device_id} actualizada.")
                    except Exception as e:
                        session.rollback()
                        print(f"[WORKER] Error actualizando prioridad: {e}")
                    finally:
                        session.close()
                    continue 

                device_id = alert_data.get('device_id')
                db_log = AlertLog(
                    device_id=device_id,
                    lat=float(alert_data.get('lat', 0.0)),
                    lon=float(alert_data.get('lon', 0.0)),
                    timestamp=int(alert_data.get('timestamp', 0)),
                    emergency_type=alert_data.get('emergency_type', 'Desconocida'),
                    priority=alert_data.get('priority', 'ALTO'),
                    zona_geografica=alert_data.get('zona_geografica', 'Zona no calculada'),
                    cuadrante=alert_data.get('cuadrante', 'S/C'),
                    maps_url=alert_data.get('maps_url', ''), 
                    media_folder=alert_data.get('media_folder'),
                    response_unit=alert_data.get('response_unit', 'Patrulla Sectorial') # <-- SE GUARDA EN BD
                )
                
                session = SessionMaster()
                try:
                    session.add(db_log)
                    session.commit()
                    print(f"[WORKER] Alerta guardada exitosamente en Maestro (Log ID: {db_log.id})")
                except Exception as db_err:
                    session.rollback()
                    print(f"[WORKER] Error al escribir en base de datos Maestro: {db_err}")
                finally:
                    session.close()
        except Exception as e:
            print(f"[WORKER] Error crítico en bucle del Worker: {e}")

@app.on_event("startup")
def startup_event():
    max_retries = 15
    for attempt in range(max_retries):
        try:
            Base.metadata.create_all(bind=engine_master)
            print("[STARTUP] Tablas validadas/creadas exitosamente en Postgres Maestro.")
            break 
        except Exception as e:
            print(f"[STARTUP] Intento {attempt + 1}/{max_retries} fallido: {e}")
            if attempt < max_retries - 1:
                time.sleep(5)
            else:
                print("[STARTUP] Error CRÍTICO: No se pudo conectar al nodo Maestro.")
        
    worker_thread = threading.Thread(target=redis_alerts_worker, daemon=True)
    worker_thread.start()

@app.get("/api/history")
def get_history(
    start_date: str = Query(None, description="Fecha de inicio en formato YYYY-MM-DD"),
    end_date: str = Query(None, description="Fecha de término en formato YYYY-MM-DD"),
    zona_geografica: str = Query(None, description="Filtro por zona geográfica (Búsqueda parcial)"),
    priority: str = Query(None, description="Filtrar por nivel de prioridad")
):
    session = SessionReplica()
    try:
        query = session.query(AlertLog)
        if priority:
            query = query.filter(AlertLog.priority == priority)
        if zona_geografica:
            query = query.filter(AlertLog.zona_geografica.ilike(f"%{zona_geografica}%"))
        if start_date:
            try:
                start_ts = int(datetime.strptime(start_date, "%Y-%m-%d").timestamp())
                query = query.filter(AlertLog.timestamp >= start_ts)
            except ValueError:
                raise HTTPException(status_code=400, detail="Formato de 'start_date' inválido. Use YYYY-MM-DD.")
        if end_date:
            try:
                end_ts = int(datetime.strptime(end_date, "%Y-%m-%d").timestamp()) + 86399
                query = query.filter(AlertLog.timestamp <= end_ts)
            except ValueError:
                raise HTTPException(status_code=400, detail="Formato de 'end_date' inválido. Use YYYY-MM-DD.")
        
        logs = query.order_by(AlertLog.timestamp.desc()).all()
        
        # <-- CORRECCIÓN TIMEZONE: Definimos el offset de México (CST / UTC-6)
        mexico_tz = timezone(timedelta(hours=-6))
        
        return {
            "status": "success",
            "database_source": "replica_node",
            "count": len(logs),
            "data": [
                {
                    "id": log.id,
                    "device_id": log.device_id,
                    "location": {"lat": log.lat, "lon": log.lon},
                    "timestamp": log.timestamp,
                    # <-- CORRECCIÓN TIMEZONE: Convertir explícitamente a UTC-6 para la respuesta JSON
                    "formatted_date": datetime.fromtimestamp(log.timestamp, tz=mexico_tz).strftime('%Y-%m-%d %H:%M:%S'),
                    "emergency_type": log.emergency_type,
                    "priority": log.priority,
                    "response_unit": log.response_unit, # <-- EXPONER EN LA API REST PARA REACT
                    "geography": {
                        "zona_geografica": log.zona_geografica,
                        "cuadrante": log.cuadrante,
                        "maps_url": log.maps_url 
                    },
                    "media_attachments": {
                        "media_folder": log.media_folder,
                        "photos": [f"{log.media_folder}/{log.device_id}_foto_{i}.jpg" for i in range(1, 4)],
                        "audio_wav": f"{log.media_folder}/{log.device_id}_audio.wav",
                        "transcription_txt": f"{log.media_folder}/{log.device_id}_transcripcion.txt"
                    },
                    "persisted_at": log.created_at.isoformat()
                } for log in logs
            ]
        }
    except HTTPException as http_ex:
        raise http_ex
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error consultando la réplica de datos: {str(e)}")
    finally:
        session.close()

# ==========================================
# ENDPOINTS PARA MODIFICACIÓN DE REGLAS C5
# ==========================================
REGLAS_PATH = os.getenv('REGLAS_PATH', '/app/shared/reglas.json')

@app.get("/api/rules")
def get_rules():
    try:
        with open(REGLAS_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Archivo reglas.json no encontrado.")
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Error leyendo el formato JSON.")

@app.post("/api/rules")
def update_rules(nuevas_reglas: dict):
    try:
        with open(REGLAS_PATH, 'w', encoding='utf-8') as f:
            json.dump(nuevas_reglas, f, indent=2, ensure_ascii=False)
        return {"status": "success", "message": "Reglas tácticas actualizadas correctamente"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al guardar las reglas: {str(e)}")