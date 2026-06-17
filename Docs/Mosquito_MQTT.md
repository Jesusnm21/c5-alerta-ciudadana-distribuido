# Arquitectura de Balanceo de Carga: Mosquitto MQTT

## 1. El Paradigma de Distribución
En nuestra arquitectura C5, el balanceo de carga para el servicio de recepción no se realiza en la capa HTTP mediante Nginx, sino a nivel de mensajería (Messaging Layer) a través del protocolo **MQTT v5** con el broker **Eclipse Mosquitto**.

Este modelo permite que las réplicas del microservicio `reception` actúen como un clúster de consumidores de alto rendimiento. En lugar de un balanceo pasivo, utilizamos **Suscripciones Compartidas (Shared Subscriptions)**, donde el broker actúa como el orquestador inteligente que distribuye los mensajes entre las instancias disponibles.

## 2. Funcionamiento y Distribución de Carga
La lógica de distribución está definida por la interacción entre el broker, el clúster de recepción y los dispositivos ESP32:

* **Suscripción Compartida:** Dentro del código del microservicio `reception`, la suscripción se realiza mediante: 
  `client.subscribe("$share/grupo_c5/c5/alerts")`
  Esto instruye a Mosquitto a tratar a todas las instancias conectadas bajo `grupo_c5` como un único grupo de procesamiento cooperativo.
* **Algoritmo de Distribución (Round-Robin):** Cuando el ESP32 publica una alerta en el tópico `c5/alerts`, Mosquitto intercepta el mensaje y, mediante su mecanismo nativo de suscripciones compartidas, selecciona **una sola instancia** del grupo para procesarlo utilizando un algoritmo de **Round-Robin**. Esto garantiza que la carga de trabajo (procesamiento de IA, transcripción de audio, geolocalización) se reparta de forma equitativa, cíclica y automática entre `reception1`, `reception2` y `reception3`.
* **Afinidad de Sesión:** Para mantener la integridad de los datos, el microservicio que recibe la alerta inicial bloquea el `device_id` en **Redis** (`redis_client.set(f"lock:device:{device_id}", ...)`). Esto asegura que todos los paquetes subsecuentes del mismo dispositivo (fotos y audio) sean procesados por la misma instancia que inició la alerta, preservando el contexto.

## 3. Comparativa Técnica: Mosquitto vs. Nginx

| Característica | Balanceo vía Nginx (HTTP) | Balanceo vía Mosquitto (MQTT) |
| :--- | :--- | :--- |
| **Modelo** | Request/Response (Sincrónico) | Pub/Sub (Asincrónico) |
| **Resiliencia** | Si el backend cae, la petición HTTP se pierde o falla. | El broker retiene el mensaje hasta que una instancia esté disponible. |
| **Escalabilidad** | Externa (Nginx actúa como intermediario). | Nativa (el protocolo MQTT maneja grupos de consumo). |
| **Desacoplación** | El cliente debe conocer la URL/IP del proxy. | El dispositivo (ESP32) solo conoce el tópico de publicación. |
| **Uso en C5** | Reservado para servir Frontend. | Asignado para la ingestión y balanceo de telemetría. |

## 4. Justificación del Modelo
La implementación de Mosquitto como balanceador es superior para nuestro caso de uso porque permite que los microservicios escalen horizontalmente sin necesidad de configurar *health checks* complejos en un proxy. El broker asegura que el sistema sea **tolerante a fallos**: si una instancia de `reception` se desconecta, Mosquitto redirige el tráfico hacia las instancias restantes sin interrumpir la recepción de alertas de los dispositivos físicos.