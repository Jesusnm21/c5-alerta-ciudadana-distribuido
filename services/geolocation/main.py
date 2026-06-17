# services/geolocation/main.py
import grpc
from concurrent import futures
import time
import geolocation_pb2
import geolocation_pb2_grpc

class GeolocationServicer(geolocation_pb2_grpc.GeolocationServiceServicer):
    def ProcessLocation(self, request, context):
        lat = request.lat
        lon = request.lon
        
        # Lógica de asignación de zonas basada en coordenadas
        if lat > 19.95:
            zona = "Central de Autobuses de Jilotepec"
            cuadrante = "Sector Norte-Transporte"
        else:
            zona = "Jardín Central de Jilotepec"
            cuadrante = "Sector Centro-Jardin"
            
        # Generar el enlace de Google Maps dinámicamente
        maps_url = f"https://www.google.com/maps?q={lat},{lon}"
            
        return geolocation_pb2.GeoResponse(
            lat=lat,
            lon=lon,
            zona_geografica=zona,
            cuadrante=cuadrante,
            maps_url=maps_url  # <-- Nuevo campo añadido
        )

def serve():
    # Inicializamos el servidor gRPC con un pool de hilos para alta concurrencia
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=10))
    geolocation_pb2_grpc.add_GeolocationServiceServicer_to_server(GeolocationServicer(), server)
    
    # gRPC suele usar puertos en el rango 5005x
    server.add_insecure_port('[::]:50052')
    print("Servidor gRPC de Geolocalización iniciado en el puerto 50052...")
    server.start()
    try:
        while True:
            time.sleep(86400)
    except KeyboardInterrupt:
        server.stop(0)

if __name__ == '__main__':
    serve()