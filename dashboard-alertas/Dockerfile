# --- Etapa 1: Construcción (Build) ---
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# Esto genera los archivos estáticos en la carpeta /app/dist
RUN npm run build 

# --- Etapa 2: Servidor de Producción (Nginx) ---
FROM nginx:alpine
# Copiamos los archivos compilados de la etapa anterior al directorio público de Nginx
COPY --from=builder /app/dist /usr/share/nginx/html

# Exponemos el puerto 80
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]