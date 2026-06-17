# Microservicio de Clasificación de Prioridades (`services/priority`)

El **Microservicio de Clasificación de Prioridades (Priority IA)** funciona como el cerebro analítico dentro del ecosistema del C5. Su propósito principal es actuar como un motor de inferencia semántica y reglas de negocio, evaluando en tiempo real el contexto de las emergencias reportadas mediante técnicas de Inteligencia Artificial y Procesamiento de Lenguaje Natural (NLP) para asignar automáticamente la urgencia operativa y los recursos de respuesta adecuados.

## Índice

1. Descripción General
2. Interfaces de Entrada (Inputs)
3. Interfaces de Salida (Outputs)
4. Proceso Interno (Flujo Detallado)
5. Contratos y Comunicaciones gRPC
6. Infraestructura y Dependencias
7. Configuración del Entorno

---

## 1. Descripción General

El **Microservicio de Clasificación de Prioridades (Priority IA)** opera como el motor analítico central del ecosistema C5. Su propósito principal es evaluar en tiempo real el contexto de las emergencias reportadas, actuando como un motor de inferencia semántica y evaluación de reglas de negocio. Utiliza Procesamiento de Lenguaje Natural (NLP) para automatizar la asignación de urgencia operativa y despachar los recursos adecuados.

Más allá de una arquitectura CRUD tradicional, este componente aloja en memoria un modelo de lenguaje pre-entrenado (Spanish BERT) optimizado para ejecución en CPU. Su arquitectura híbrida combina la precisión del Machine Learning (clasificación Zero-Shot) con reglas de validación estáticas (guardarraíles) de lectura dinámica. Este diseño asegura el escalamiento inmediato de alertas críticas, la mitigación de falsos positivos o bromas, y la trazabilidad de cada decisión mediante auditoría en base de datos.

## 2. Interfaces de Entrada (Inputs)

El microservicio está diseñado para operaciones de alto rendimiento. En lugar de exponer puertos HTTP/REST convencionales, consume configuraciones inyectadas y escucha peticiones a través de un canal optimizado:

### A. Canal de Peticiones (gRPC)

* **Puerto de exposición:** `50051`
* **Formato de comunicación:** Mensajes Protobuf (`AlertRequest`)
* **Carga útil (Payload):** Recibe el identificador del dispositivo (`device_id`), la tipificación preliminar (`emergency_type`) y el texto normalizado de la transcripción de audio (`transcription`), siendo este último el insumo crítico para la inferencia.

### B. Reglas de Negocio Dinámicas (File System)

* **Origen:** Archivo JSON montado mediante un volumen compartido.
* **Mecanismo de lectura:** Carga dinámica con caché en memoria volátil (TTL de 10 segundos). Esto garantiza una latencia mínima al evitar el bloqueo I/O en disco por cada petición.
* **Contenido:** Diccionarios de mapeo para la IA, listas negras de descarte (bromas), palabras clave críticas (guardarraíles de escalamiento) y matrices de asignación de unidades de respuesta por contexto.

## 3. Interfaces de Salida (Outputs)

El servicio genera resoluciones inmediatas para el sistema invocador y mantiene un registro forense inmutable de sus operaciones:

### A. Resolución Operativa (gRPC)

Retorna un mensaje `PriorityResponse` estructurado con:

* `priority_level`: Nivel de urgencia calculado (ej. `BAJO`, `MEDIO`, `ALTO`, `CRÍTICO`).
* `matched_rule`: Justificación lógica o matemática de la inferencia (ej. porcentaje de confianza de la IA o regla de guardarraíl activada).
* `response_unit`: Identificador de las unidades tácticas o médicas recomendadas para el despacho.

### B. Persistencia y Auditoría (Base de Datos)

Por cada inferencia, inserta un registro atómico en la tabla `priority_audit`.

* **Datos almacenados:** Texto procesado, prioridad asignada, regla coincidente, índice de confianza del modelo (flotante), tiempo de ejecución del motor (ms) y timestamp de creación en UTC.


## 4. Proceso Interno (Flujo Detallado)

El ciclo de vida de cada petición sigue un pipeline algorítmico estricto dividido en tres fases principales:

### Fase 1: Ingesta y Caché Inteligente

1. El servidor gRPC recibe y normaliza la cadena de texto de la alerta.
2. Se valida la vigencia de la memoria caché. Si el TTL (10s) ha expirado, el sistema recarga de forma transparente el archivo físico `reglas.json`. Esto permite a los operadores actualizar las reglas de escalamiento en caliente sin necesidad de reiniciar el contenedor Docker.

### Fase 2: Motor Híbrido de Decisión

El servicio procesa el texto y los "candidatos" extraídos de las reglas a través del modelo `Recognai/bert-base-spanish-wwm-cased-xnli`.

1. **Guardarraíles Absolutos:** Se escanea el texto en busca de `palabras_criticas` (ej. `"arma"`, `"herido"`). Si hay coincidencias, se omite (hace bypass) a la IA y se fuerza un escalamiento inmediato a nivel `CRÍTICO`.
2. **Filtro de Descarte:** Si la etiqueta inferida con mayor confianza (>50%) pertenece a las `ETIQUETAS_DE_DESCARTE` (bromas o reportes inválidos), se detiene el escalamiento operativo, asignando un nivel `MEDIO` bajo la directiva de "Solo Monitoreo".
3. **Evaluación Estándar:** Si no se activan excepciones o descartes, el sistema adopta la etiqueta de la IA con mayor puntuación y le asigna su nivel de prioridad pre-mapeado.

### Fase 3: Asignación y Cierre

1. El motor cruza la etiqueta resultante con la matriz de unidades de respuesta dinámica.
2. Si el evento es clasificado como `CRÍTICO` y no existe una coincidencia específica, se asigna una respuesta táctica por defecto.
3. Se ejecuta una transacción breve hacia la base de datos para registrar la auditoría.
4. Se emite el paquete de respuesta (`PriorityResponse`) de vuelta al servicio origen.

## 5. Contratos y Comunicaciones gRPC

El esquema estricto de comunicación se define en `priority.proto`:

* **Método Remoto:** `ClassifyAlert`
* **Mensaje de Solicitud (`AlertRequest`):** Estructura los parámetros de entrada (`device_id`, `emergency_type`, `transcription`).
* **Mensaje de Respuesta (`PriorityResponse`):** Estructura los resultados de la evaluación (`priority_level`, `matched_rule`, `response_unit`).

## 6. Infraestructura y Dependencias

El microservicio opera en un contenedor optimizado para Machine Learning sobre CPU, garantizando portabilidad y un peso manejable:

* **Entorno Base:** `Python 3.10-slim`.
* **Motor Transaccional:** Servidor relacional primario (donde reside el esquema de auditoría).
* **Procesamiento NLP:** `HuggingFace Transformers` + `PyTorch` (compilación estricta para CPU mediante `--extra-index-url https://download.pytorch.org/whl/cpu`).
* **Capa de Datos:** `SQLAlchemy` + `Psycopg2` (ORM y driver binario para la gestión eficiente y concurrente de conexiones a la base de datos).

## 7. Configuración del Entorno

Variables de entorno requeridas para el despliegue del microservicio en el clúster (ej. Docker Compose):

| Variable de Entorno | Propósito                                                                                  | Valor de Ejemplo / Fallback                               |
| ------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| `DB_MASTER`         | Cadena de conexión estandarizada (DSN) para el clúster transaccional.                      | `postgresql://c5_user:c5_pass@postgres-master:5432/c5_db` |
| `REGLAS_PATH`       | Ruta absoluta dentro del contenedor hacia el archivo JSON con la lógica de negocio activa. | `/app/shared/reglas.json`                                 |
