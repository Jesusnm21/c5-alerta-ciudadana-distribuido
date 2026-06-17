# Microservicio de Geolocalización (geolocation-service)

## Descripción General
El microservicio geolocation es un componente crítico del sistema de alertamiento temprano y respuesta rápida. Su función principal es procesar las coordenadas geográficas bidimensionales (Latitud y Longitud) enviadas por los dispositivos IoT (como el nodo sensor embebido XIAO ESP32S3) durante una alerta de emergencia.

El servicio traduce estas coordenadas crudas en información contextualizada de alto valor operativo: asigna una zona geográfica específica de Jilotepec, determina un cuadrante de seguridad/atención y genera un enlace web directo a Google Maps para facilitar el despliegue del personal de emergencias. Está desarrollado en Python 3.10 utilizando una arquitectura de alto rendimiento basada en gRPC (Remote Procedure Calls).

## Interfaces de Entrada (Inputs)
El microservicio expone un único procedimiento remoto (RPC) que recibe datos serializados binarios a través del protocolo HTTP/2.
•**lat (float, requerido):** Coordenada de latitud en formato decimal.
•**lon (float, requerido):** Coordenada de longitud en formato decimal.
**Flujo de Integración IoT:** El dispositivo físico XIAO_SENSE_01 transmite estas coordenadas embebidas en una estructura JSON hacia el broker MQTT (c5/alerts). Un componente intermedio (orquestador/ingestor de datos) se encarga de suscribirse a ese tópico, extraer la latitud y longitud del payload JSON del ESP32, y transformarlo en un llamado gRPC hacia este microservicio.

## Interfaces de Salida (Outputs)
Al finalizar el procesamiento, el microservicio responde de forma sincrónica con una estructura estructurada de datos.

Parámetros de Salida (GeoResponse)
**lat (float)**: Latitud original eco-reflejada.
**lon (float):** Longitud original eco-reflejada.
**zona_geografica (string):** Nombre del punto de interés o zona urbana identificada dentro del municipio de Jilotepec.
**cuadrante (string):** Sector estratégico operativo asignado para la atención de la emergencia.
**maps_url (string):** URL dinámica estructurada para visualizar la posición exacta de la alerta en la plataforma Google Maps.

## Proceso Interno (Flujo Detallado)
Cuando se invoca el método ProcessLocation, el microservicio ejecuta de manera secuencial los siguientes pasos lógicos:

**1.Recepción y Extracción:** Se extraen las variables lat y lon del objeto GeoRequest.
**2.Evaluación Geo-espacial (Cerca Perimetral):** El servicio aplica un umbral estricto sobre la latitud para segmentar la región de Jilotepec:
**Condición ($Latitud > 19.95$):** Se determina que el evento ocurre en el sector norte.
Zona: Central de Autobuses de Jilotepec.
Cuadrante: Sector Norte-Transporte.

**Condición General (Complementaria):** Se determina que el evento ocurre en el casco central.
Zona: Jardín Central de Jilotepec.
Cuadrante: Sector Centro-Jardin.
**3.Construcción de URL de Mapas:** Se genera una cadena de texto interpolada usando el formato estándar de coordenadas geográficas para Google Maps.
**4.Instanciación del Retorno:** Se construye el objeto GeoResponse con los datos computados y se envía de regreso por el canal gRPC abierto.

# Contratos y Comunicaciones gRPC
**Especificación del Contrato de Mensajería**
El comportamiento y la estructura de los datos del microservicio se rigen de manera estricta bajo un contrato de interfaz definido con Protocol Buffers (proto3). Este contrato actúa como una API fuertemente tipada que describe los siguientes elementos:

**Estructura del Request (GeoRequest):** Define un mensaje compuesto por dos campos numéricos de precisión flotante mapeados en los índices serializados 1 y 2, los cuales corresponden rigurosamente a la latitud y longitud.

**Estructura del Response (GeoResponse):** Establece una carga útil de retorno compuesta por cinco campos serializados de forma secuencial. Los primeros dos campos replican las coordenadas flotantes recibidas, mientras que los campos 3, 4 y 5 transportan cadenas de texto codificadas en UTF-8 correspondientes a la zona geográfica identificada, el cuadrante de seguridad y la URL de mapas generada.

**Definición del Servicio:** Declara un servicio unario llamado GeolocationService, el cual expone de forma pública el procedimiento remoto ProcessLocation. Este procedimiento acepta únicamente el mensaje de petición previamente descrito y garantiza la devolución sincrónica del mensaje de respuesta.

## Arquitectura de Red y Concurrencia
**Protocolo de Transporte:** Toda la comunicación se realiza sobre HTTP/2 de manera insegura (sin cifrado TLS implementado para entornos locales de desarrollo y pruebas), lo que permite aprovechar características avanzadas como la multiplexación de streams en una sola conexión TCP.

**Puerto de Escucha:** El servicio está configurado para enlazarse de forma universal a todas las interfaces de red disponibles en el host ([::]) utilizando de manera estricta el puerto 50052, el cual está reservado exclusivamente para el tráfico de geolocalización dentro del ecosistema del sistema.

**Manejo de Carga Elevada:** Para evitar bloqueos en el hilo principal de ejecución ante ráfagas masivas de alarmas provocadas por los dispositivos IoT, el servidor gRPC se inicializa utilizando un pool de hilos de la librería concurrent.futures de Python. Este pool está limitado a un máximo de 10 hilos trabajadores concurrentes (max_workers=10), asegurando que el microservicio pueda procesar de forma paralela hasta 10 peticiones simultáneas con un consumo de memoria predecible.

## Infraestructura y Dependencias
#### Dependencias del Entorno del Servidor (Python Backend)
Para el correcto funcionamiento del microservicio de geolocalización, el intérprete de Python en su versión tres punto diez requiere la instalación de tres paquetes pilares fundamentales:

**Librería del núcleo gRPC (grpcio):** Es la encargada de gestionar el ciclo de vida de las conexiones HTTP/2, la serialización/deserialización binaria y el manejo de los hilos de red en segundo plano.

**Herramientas de desarrollo gRPC (grpcio-tools):** Contiene el compilador protoc optimizado para Python, esencial para traducir el contrato de interfaz a clases nativas ejecutables.

**Librería de soporte Protocol Buffers (protobuf):** Proporciona los mecanismos de serialización rápida y el tipado estricto de datos exigidos por el estándar de Google.

## Dockerización e Imagen Base
El microservicio está diseñado para ser completamente aislado dentro de un contenedor virtual para garantizar portabilidad y consistencia en el despliegue. Se utiliza una imagen base oficial de Python en su distribución slim de Linux Debian, lo que minimiza el tamaño del contenedor al excluir paquetes innecesarios del sistema operativo y reducir la superficie de vulnerabilidades. Durante la construcción de esta imagen, se copian los archivos del proyecto, se descargan las dependencias de red sin almacenar archivos en caché y se ejecuta automáticamente el compilador de Protocol Buffers para generar los módulos de código nativos de Python antes de exponer el puerto cincuenta mil cincuenta y dos de la aplicación.

## Configuración del Entorno y Despliegue
**Compilación Manual de los Stubs**
Cuando se realizan modificaciones en la lógica del contrato o en la estructura de los mensajes, el desarrollador puede compilar manualmente el archivo proto en un entorno local. Esto se logra ejecutando el compilador de herramientas gRPC de Python directamente desde la consola del sistema, indicando el directorio actual de inclusión y ordenando la creación de los archivos de bindings correspondientes que el código del servidor importará posteriormente.

**Estrategia de Despliegue con Docker**
El despliegue automatizado consta de tres fases bien definidas para garantizar el correcto aprovisionamiento en servidores locales o en la nube:

**Construcción de la Imagen:** Se procesa el archivo de configuración Docker en el directorio raíz, asignando una etiqueta identificadora única al contenedor para registrar la versión final del servicio de geolocalización.

**Ejecución del Contenedor:** Se inicializa el servicio en segundo plano (modo desmontado), mapeando explícitamente el puerto del host hacia el puerto interno del contenedor para permitir que el ingestor de alertas o el backend general puedan enviar las peticiones de coordenadas sin restricciones.

**Auditoría y Monitoreo:** Se examinan las salidas estándar de texto generadas por el contenedor para verificar que la inicialización del pool de hilos haya sido exitosa y que el servidor gRPC se encuentre escuchando activamente en el puerto asignado listo para operar.

