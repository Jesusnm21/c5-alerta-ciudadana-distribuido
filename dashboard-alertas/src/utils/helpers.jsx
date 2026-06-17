// --- FUNCIÓN UTILITARIA PARA RUTAS MULTIMEDIA ---
export const getMediaUrl = (path) => {
  if (!path) return '';
  return path.replace('/app/media', 'http://localhost:8000/media');
};