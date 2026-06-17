# Manual de Configuración y Arquitectura: Nginx Proxy Inverso 

## 1. Función y Rol del Componente
Nginx funciona en esta arquitectura como el **Edge Server** (Servidor de Borde) y componente crítico para la capa de infraestructura del proyecto C5. Su implementación cumple tres funciones estratégicas:

* **Punto de Entrada Unificado:** Centraliza todas las solicitudes HTTP que ingresan al sistema desde redes externas, actuando como una barrera de seguridad que oculta la topología de la red interna (microservicios) al usuario final.
* **Orquestador de Tráfico:** Gestiona la terminación de conexiones TCP/HTTP, permitiendo que el tráfico entrante sea correctamente dirigido hacia los componentes de backend o hacia el servidor de archivos estáticos.



## 2. Configuración de Rutas y Redirección
El proxy está configurado para exponer una interfaz pública mínima, manteniendo la superficie de ataque reducida mientras permite una gestión de tráfico interna robusta:

* **Puertos Expuestos:** El sistema expone únicamente el **Puerto 80 (HTTP)** hacia el exterior, centralizando todo el acceso en una sola puerta de entrada para simplificar la gestión de red.
* **Gestión de Frontend:** Las solicitudes dirigidas a la raíz (`/`) son resueltas mediante archivos estáticos alojados en `/usr/share/nginx/html`. Se ha configurado la directiva `try_files $uri $uri/ /index.html;` para soportar la navegación de aplicaciones Single Page (SPA), permitiendo que el cliente gestione sus propias rutas de navegación sin que Nginx arroje errores al recargar la página.


