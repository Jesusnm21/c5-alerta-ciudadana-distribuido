import grpc
from concurrent import futures
import priority_pb2, priority_pb2_grpc
import os
import time
import json
from datetime import datetime
from sqlalchemy import create_engine, Column, Integer, String, Text, Float, DateTime
from sqlalchemy.orm import declarative_base, sessionmaker
from transformers import pipeline

# --- 1. IMPORTACIÓN DE LIBRERÍAS DE IA ---
print("[STARTUP] Cargando modelo de IA Optimizado (Spanish BERT)...")
nlp_classifier = pipeline(
    "zero-shot-classification", 
    model="Recognai/bert-base-spanish-wwm-cased-xnli",
    device=-1
)
print("[STARTUP] Modelo de IA cargado exitosamente y listo en CPU.")

# --- 2. CONFIGURACIÓN DE BASE DE DATOS (Auditoría) ---
DB_URL = os.getenv('DB_MASTER', 'postgresql://c5_user:c5_pass@postgres-master:5432/c5_db')
engine = create_engine(DB_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()

class PriorityAudit(Base):
    __tablename__ = "priority_audit"
    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(String(50), nullable=False)
    transcription = Column(Text, nullable=True)
    assigned_priority = Column(String(20), nullable=False)
    matched_rule = Column(String(500), nullable=False)
    confidence_score = Column(Float, nullable=False)
    execution_time_ms = Column(Float, nullable=False)
    response_unit = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

Base.metadata.create_all(bind=engine)

# --- 3. LECTURA DINÁMICA DE REGLAS (Con Caché TTL de 10s) ---
_reglas_cache = None
_last_cache_time = 0
CACHE_TTL_SECONDS = 10

def obtener_reglas_dinamicas():
    """Lee el archivo reglas.json en tiempo real con caché de 10 segundos para máxima velocidad."""
    global _reglas_cache, _last_cache_time
    current_time = time.time()
    
    # Retornar caché si aún es válido
    if _reglas_cache and (current_time - _last_cache_time < CACHE_TTL_SECONDS):
        return _reglas_cache

    REGLAS_PATH = os.getenv('REGLAS_PATH', '/app/shared/reglas.json')
    try:
        with open(REGLAS_PATH, 'r', encoding='utf-8') as f:
            _reglas_cache = json.load(f)
            _last_cache_time = current_time
            return _reglas_cache
    except Exception as e:
        print(f"[ERROR] No se pudo leer reglas.json de forma dinámica: {e}")
        # Retorna estructura base por seguridad
        return {"MAPEO_IA": {}, "ETIQUETAS_DE_DESCARTE": [], "GUARDRAILES": {}, "UNIDADES_RESPUESTA": {}}

class PriorityClassifierServicer(priority_pb2_grpc.PriorityClassifierServicer):
    def ClassifyAlert(self, request, context):
        start_time = time.time()
        
        REGLAS = obtener_reglas_dinamicas()
        MAPEO_IA = REGLAS.get("MAPEO_IA", {})
        CANDIDATOS_IA = list(MAPEO_IA.keys())
        GUARDRAILES = REGLAS.get("GUARDRAILES", {})
        ETIQUETAS_DE_DESCARTE = REGLAS.get("ETIQUETAS_DE_DESCARTE", [])
        
        texto_clean = request.transcription.strip().lower() if request.transcription else ""
        
        level = "MEDIO"
        justificacion = "Falta de audio o contenido ininteligible."
        confianza = 1.0
        unidad_asignada = "Patrulla Sectorial" # <-- Unidad por defecto

        # =========================================================================
        # MOTOR DE CLASIFICACIÓN (IA + CONTEXTO INTELIGENTE)
        # =========================================================================
        if texto_clean:
            print(f"[AI-ENGINE] Procesando texto: '{texto_clean}'")
            
            if not CANDIDATOS_IA:
                CANDIDATOS_IA = ["emergencia no clasificada"]
                MAPEO_IA = {"emergencia no clasificada": "MEDIO"}

            # 1. Ejecutar IA SIEMPRE para entender el contexto real
            resultado_ia = nlp_classifier(
                texto_clean, 
                candidate_labels=CANDIDATOS_IA, 
                hypothesis_template="Este reporte trata sobre {}.",
                multi_label=False
            )
            
            etiqueta_ganadora = resultado_ia["labels"][0]
            confianza = resultado_ia["scores"][0]
            nivel_ia = MAPEO_IA.get(etiqueta_ganadora, "MEDIO")
            
            top_3_labels = resultado_ia["labels"][:3]
            top_3_scores = resultado_ia["scores"][:3]
            scores_detallados = [
                f"{label} ({MAPEO_IA.get(label, 'MEDIO')}): {round(score * 100, 1)}%" 
                for label, score in zip(top_3_labels, top_3_scores)
            ]
            
            palabras_criticas = GUARDRAILES.get("palabras_criticas", [])
            
            # 2. Lógica de Decisión Contextual y Prioridad
            if etiqueta_ganadora in ETIQUETAS_DE_DESCARTE and confianza > 0.50:
                level = "MEDIO"
                justificacion = f"Contexto de Broma/No Urgencia detectado por IA | {scores_detallados[0]}"
                unidad_asignada = "Ninguna - Solo Monitoreo"
                
            elif any(w in texto_clean for w in palabras_criticas):
                level = "CRITICO"
                justificacion = f"Guardrail Activado | Palabra crítica detectada. (IA sugirió: {etiqueta_ganadora})"
                
            else:
                level = nivel_ia
                justificacion = f"Clasificación IA | Top 3 -> " + " | ".join(scores_detallados)

            # 3. Lógica de Asignación de Unidades DINÁMICA
            # Solo aplicamos lógica dinámica si no fue descartada como broma previamente
            if unidad_asignada != "Ninguna - Solo Monitoreo":
                UNIDADES_RESPUESTA = REGLAS.get("UNIDADES_RESPUESTA", {})
                contexto_total = etiqueta_ganadora + " " + texto_clean
                coincidencia_dinamica = False

                for unidad, palabras_clave in UNIDADES_RESPUESTA.items():
                    if any(w in contexto_total for w in palabras_clave):
                        unidad_asignada = unidad
                        coincidencia_dinamica = True
                        break # Detiene la búsqueda al encontrar la primera coincidencia

                # Fallback seguro en caso de que ninguna regla dinámica se active
                if not coincidencia_dinamica:
                    if level == "CRITICO":
                        unidad_asignada = "Patrulla Sectorial y Fuerza Especial"

        execution_time_ms = (time.time() - start_time) * 1000
        print(f"[PRIORITY] {level} | {unidad_asignada} | {round(execution_time_ms, 2)}ms | {justificacion}")

        # --- 4. PERSISTENCIA DE AUDITORÍA ---
        session = SessionLocal()
        try:
            audit = PriorityAudit(
                device_id=request.device_id,
                transcription=texto_clean if texto_clean else "[Sin Audio]",
                assigned_priority=level,
                matched_rule=justificacion,
                confidence_score=float(confianza),
                execution_time_ms=float(execution_time_ms),
                response_unit=unidad_asignada
            )
            session.add(audit)
            session.commit()
        except Exception as e:
            session.rollback()
            print(f"[ERROR] Guardando auditoría: {e}")
        finally:
            session.close()

        # Usamos getattr por seguridad por si olvidaste compilar el .proto
        return priority_pb2.PriorityResponse(
            priority_level=level, 
            matched_rule=justificacion,
            response_unit=unidad_asignada
        )

def serve():
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=10))
    priority_pb2_grpc.add_PriorityClassifierServicer_to_server(PriorityClassifierServicer(), server)
    server.add_insecure_port('[::]:50051')
    print("Servidor gRPC Priority IA iniciado en puerto 50051...")
    server.start()
    server.wait_for_termination()

if __name__ == '__main__':
    serve()