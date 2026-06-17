# Microservicio de Historial (history-service)


## Documentación API

La documentación Swagger está disponible en:

[Swagger UI - history-service](https://app.swaggerhub.com/apis-docs/vansus/alerna_ciudadada_microservicio_history/1.0.0?view=uiDocs#/history/get_api_history)


## Descripción General
La responsabilidad única y crítica de este microservicio dentro de la arquitectura del C5 es centralizar, estructurar, persistir de forma inmutable y proveer con fines de auditoría todo el histórico de incidentes, alertas ciudadanas y telemetría en tiempo real, así como administrar el almacenamiento y actualización del archivo maestro de reglas tácticas de clasificación de la Inteligencia Artificial.

Para soportar ráfagas de alta volatilidad operativa (situaciones de pánico masivo) sin degradar la experiencia de usuario, el servicio implementa un patrón de segregación de responsabilidades de lectura y escritura (CQRS) a nivel de base de datos:
1. **Escritura Asíncrona (Maestro):** Delega la persistencia de datos masivos a un hilo de ejecución independiente (`Worker Thread`) que procesa colas de mensajes y escribe directamente en el nodo principal (PostgreSQL Maestro).
2. **Lectura Distribuida (Réplica):** Atiende todas las solicitudes de búsqueda, filtrado y renderizado del grid dinámico en el Frontend consumiendo exclusivamente un nodo optimizado de lectura (PostgreSQL Réplica), garantizando tiempos de respuesta mínimos.

---

## Entradas (Inputs)
El microservicio se encuentra escuchando y procesando flujos de datos a través de tres canales de entrada concurrentes:

### 1. Mensajes Asíncronos (Redis Broker - `history_queue`)
Estructuras JSON binarias extraídas continuamente de la memoria intermedia de Redis. El payload varía según la acción requerida:
* **Payload de Registro de Nueva Alerta:**
  * Metadatos del dispositivo (`device_id` [String], `timestamp` [BigInteger Unix]).
  * Telemetría de geolocalización (`lat` [Float], `lon` [Float]).
  * Clasificación semántica de la IA (`emergency_type` [String], `priority` [String: CRÍTICO, ALTO, MEDIO]).
  * Contexto geográfico deducido (`zona_geografica` [String], `cuadrante` [String]).
  * Referencias multimedia (`maps_url` [String], `media_folder` [String]).
* **Payload de Actualización Táctica (`"action": "UPDATE_PRIORITY"`):**
  * Identificador único del emisor (`device_id`).
  * Campos actualizados automáticamente por el servicio de `priority-service` tras el procesamiento de reglas: `priority`, `emergency_type` y `response_unit`.  

### 2. Parámetros de Consulta HTTP (REST Query Parameters - `/api/history`)
Criterios de búsqueda enviados por el Frontend para la filtración de la bitácora del grid táctico:
* `start_date` / `end_date` [String]: Fechas delimitadoras en formato estándar `YYYY-MM-DD`.
* `zona_geografica` [String]: Cadena de texto para búsqueda por coincidencia parcial o sector de patrullaje.
* `priority` [String]: Nivel jerárquico de la emergencia para filtrado segregado.

### 3. Carga de Reglas de IA (REST Request Body - `/api/rules`)
* Un objeto JSON estructurado que contiene el árbol de conceptos gramaticales, palabras de descarte, términos salvavidas (guardarraíles) y mapeo corporativo de las unidades de respuesta de emergencia enviado desde el modal de configuración del monitorista.

---

## Salidas (Outputs)
Como resultado de sus procesos internos, el microservicio genera las siguientes salidas y mutaciones de estado:

1. **Persistencia Relacional Transaccional (PostgreSQL - Nodo Maestro):**
   * Inserción de nuevos registros estructurados en la tabla `alert_logs`.
   * Actualizaciones atómicas (`SQL UPDATE`) sobre las columnas de prioridad y despacho en registros históricos existentes basados en el último ID secuencial.
2. **Respuestas HTTP Estructuradas en Formato JSON:**
   * **Listado del Histórico:** Retorna un diccionario con el estado de la transacción (`"status": "success"`), el origen de la consulta (`"database_source": "replica_node"`), el conteo de registros y un arreglo detallado donde los timestamps numéricos han sido calculados a cadenas legibles de fecha local, inyectando las rutas absolutas para las 3 capturas fotográficas, audio `.wav` de evidencia y la transcripción de texto.
   * **Esquema de Reglas:** Envía el estado actual del diccionario de configuración de IA extraído desde el almacenamiento estático.
3. **Persistencia en Almacenamiento Local (File System Volumen):**
   * Escritura y actualización física del archivo estructurado `reglas.json` en la ruta compartida del clúster mediante operaciones de volcado atómico (`json.dump`).

---

## Proceso Interno (Flujo)
El comportamiento interno de la lógica de software está dividido en tres flujos de control paralelos coordinados por el framework FastAPI:

### A. Ciclo de Inicialización y Verificación de Entorno (`startup_event`)
1. Al arrancar el servidor ASGI Uvicorn, la aplicación ejecuta una rutina de verificación de infraestructura contra la base de datos PostgreSQL Maestra.
2. Aplica un bucle de tolerancia a fallos (`max_retries = 15`) con un retraso secuencial de 5 segundos entre intentos. Esto previene que el microservicio colapse si el motor de base de datos se encuentra inicializándose en el contenedor adyacente.
3. Una vez establecida la conexión, invoca las directivas de SQLAlchemy (`Base.metadata.create_all`) para validar la existencia o creación automática de la tabla `alert_logs` y sus índices correlativos.
4. Finalmente, instancia e inicia un hilo de ejecución secundario nativo (`threading.Thread`) configurado en modo demonio (`daemon=True`) para ejecutar el Worker de persistencia en paralelo sin bloquear el bucle de eventos principal de la API.

### B. Ciclo de Vida del Worker de Persistencia Asíncrona (`redis_alerts_worker`)
1. **Escucha y Bloqueo:** El hilo secundario ejecuta un bucle infinito donde invoca la función bloqueante `brpop` sobre la clave `history_queue` de Redis, configurando un temporizador de desgasificación (`timeout=5`). Esto mantiene el uso de CPU al mínimo cuando no hay alertas entrando.
2. **Decodificación Semántica:** Al extraer un mensaje, transforma los bytes a una cadena UTF-8 y parsea el contenido a un diccionario nativo.
3. **Evaluación de Acción de Flujo:**
   * **Caso de Actualización (`UPDATE_PRIORITY`):** Abre una sesión transaccional con `SessionMaster()`. Ejecuta una consulta sobre la tabla ordenando de forma descendente por el identificador autoincremental para aislar la alerta más reciente del dispositivo (`device_id`). Evalúa mutaciones en los campos `priority`, `emergency_type` y `response_unit`. Si detecta discrepancias, altera las propiedades de la entidad y realiza un `session.commit()` para impactar la base de datos de manera inmediata.
   * **Caso de Registro Nuevo:** Construye una instancia del modelo ORM `AlertLog` extrayendo las variables del payload. Si faltan datos opcionales, el software inyecta valores sanitizados por defecto (como coordenadas `0.0`, cuadrante `"S/C"` o zona `"Zona no calculada"`). Seguido, abre sesión en el Maestro, añade la entidad a la cola de inserción y consolida la persistencia transaccional.
4. **Manejo de Excepciones Tácticas:** Ante cualquier error de base de datos o fallo en la consistencia de tipos, el bloque `except` captura la anomalía, ejecuta un `session.rollback()` automático para evitar la corrupción de la sesión y emite logs de diagnóstico detallados en la consola. La sesión se cierra de manera obligatoria en la cláusula `finally`.

### C. Procesamiento de Consultas Históricas y Configuración (REST API Layer)
1. **Recepción de Petición de Historial (`/api/history`):** El endpoint intercepta la llamada GET y solicita una conexión limpia al Pool de conexiones del **Nodo Réplica**, aislando la carga de lecturas masivas del canal de escritura principal.
2. **Estructuración Dinámica de Consultas SQL (Query Building):**
   * Si se recibe el parámetro `priority`, inyecta un filtro de igualdad exacta sobre la columna indexada.
   * Si se recibe `zona_geografica`, inyecta una cláusula condicional de coincidencia parcial insensible a mayúsculas y minúsculas empleando el operador `ilike` (`%valor%`).
   * Si se especifican límites de fecha (`start_date` / `end_date`), el sistema parsea de forma segura las cadenas de texto a objetos nativos `datetime`, extrae sus respectivos timestamps Unix de inicio (`00:00:00`) y fin de día (`23:59:59` añadiendo un desplazamiento de `86399` segundos) y restringe la consulta mediante operaciones lógicas comparativas numéricas.
3. **Conversión Regional de Datos y Formateo JSON:** Recupera las entidades de la base de datos ordenadas de forma cronológica descendente (`AlertLog.timestamp.desc()`). El endpoint mapea cada entidad a una estructura de salida personalizada (Data Transfer Object) realizando las siguientes operaciones críticas:
   * **Ajuste de Zona Horaria (Timezone Correction):** Toma el timestamp Unix crudo y lo convierte explícitamente a la zona horaria oficial de México (CST / Centro de México, configurando un objeto `timezone(timedelta(hours=-6))`), exponiendo el campo `formatted_date` con la máscara `%Y-%m-%d %H:%M:%S` requerida por los componentes de React.
   * **Mapeo de Rutas Multimedia Absolutas:** Reconstruye dinámicamente la estructura de archivos adjuntos para las imágenes, el archivo de audio comprimido y la transcripción del texto concatenando las rutas relativas del volumen `/media`.
4. **Despacho y Cierre:** Concluido el mapeo, la sesión de la réplica se destruye de forma segura y se retorna una carga útil con código HTTP 200. En caso de fallas imprevistas en la infraestructura del clúster de lectura, se atrapa la excepción y se despacha un error HTTP 500 sanitizado.
5. **Lectura/Escritura de Reglas (`/api/rules`):** Ejecuta flujos atómicos de lectura (`open` en modo `'r'`) y escritura (`open` en modo `'w'`) con codificación universal `utf-8` sobre el archivo físico de configuración compartida, validando la integridad gramatical del JSON mediante excepciones controladas.

---

## Dependencias
El microservicio requiere que las siguientes dependencias de infraestructura y red estén operativas dentro del ecosistema C5:
* **Python 3.10-slim & FastAPI:** Entorno de ejecución y framework de alto rendimiento asíncrono.
* **PostgreSQL Clúster (Esquema de Alta Disponibilidad):**
  * **Nodo Maestro (`DB_MASTER`):** Cadena de conexión con privilegios de lectura y escritura para el Worker de persistencia.
  * **Nodo Réplica (`DB_REPLICA`):** Cadena de conexión optimizada para operaciones de solo lectura de la API REST.
* **Redis Server Instancia (`REDIS_HOST`):** Broker de mensajería en memoria encargado de sostener la estructura de datos tipo lista de la cola `history_queue`.
* **Volumen de Docker Compartido:** Espacio de almacenamiento en disco mapeado internamente a `/app/media` para la lectura/escritura estática de archivos compartidos e imágenes del sistema.