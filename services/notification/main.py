# services/notification/main.py
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import redis.asyncio as aioredis
import asyncio
import json
import os
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

redis_client = aioredis.Redis(host=os.getenv('REDIS_HOST', 'redis'), port=6379, db=0)
connected_operators = []

# ==========================================
# CONFIGURACIÓN CORS 
# ==========================================
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.websocket("/ws/operators")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    connected_operators.append(websocket)
    print(f"🟢 [WS] Operador conectado. Total en línea: {len(connected_operators)}")
    try:
        while True:
            await websocket.receive_text() # Mantener vivo
    except WebSocketDisconnect:
        connected_operators.remove(websocket)
        print(f"🔴 [WS] Operador desconectado. Total en línea: {len(connected_operators)}")
    except Exception as e:
        if websocket in connected_operators:
            connected_operators.remove(websocket)
        print(f"⚠️ [WS] Error de conexión: {e}")

async def consume_redis_queue():
    print("🚀 [WORKER] Consumidor de Redis iniciado. Esperando alertas...")
    while True:
        try:
            # 🛡️ ESTRATEGIA DE TOLERANCIA A FALLOS 1:
            # Si no hay operadores conectados, NO sacamos la alerta de la cola.
            if not connected_operators:
                await asyncio.sleep(2) # Pausa activa, esperamos a que alguien se conecte
                continue

            # timeout=2 evita que el hilo se bloquee infinitamente si un operador se desconecta
            item = await redis_client.brpop('notification_queue', timeout=2)
            
            if item:
                alert_data = item[1].decode('utf-8')
                alert = json.loads(alert_data)
                
                device_id = alert.get('device_id', 'Desconocido')
                print(f"✅ [ENTREGA] Alerta extraída de Redis (Dispositivo: {device_id}). Enviando a {len(connected_operators)} operador(es)...")
                
                delivery_success = False
                
                # Enviar a todos los operadores conectados usando una copia de la lista
                for client in connected_operators.copy():
                    try:
                        await client.send_json(alert)
                        delivery_success = True
                    except Exception as client_err:
                        print(f"❌ [ERROR] No se pudo entregar alerta a un operador: {client_err}")
                        
                # 🛡️ ESTRATEGIA DE TOLERANCIA A FALLOS 2:
                # Si ningún operador recibió la alerta con éxito, la devolvemos a la cola
                if not delivery_success:
                    print("⚠️ [REINTENTO] Fallo total de entrega. Devolviendo alerta a Redis...")
                    await redis_client.lpush('notification_queue', alert_data)
                    await asyncio.sleep(1) # Backoff antes del siguiente intento
                    
        except Exception as e:
            print(f"🚨 [ERROR CRÍTICO] Fallo consumiendo cola de Redis: {e}")
            await asyncio.sleep(2) # Backoff de seguridad si Redis no responde

@app.on_event("startup")
async def startup_event():
    # Lanzar el consumidor en segundo plano al arrancar el contenedor
    asyncio.create_task(consume_redis_queue())