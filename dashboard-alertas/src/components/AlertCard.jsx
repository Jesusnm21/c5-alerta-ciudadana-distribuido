import { AlertTriangle, MapPin, Clock, Activity, Flame, Shield, Wrench, Image as ImageIcon, Mic, ExternalLink, Navigation } from 'lucide-react';

const obtenerEstilosUrgencia = (tipo, isResaltada) => {
  if (isResaltada) {
    return 'bg-gradient-to-br from-slate-900 to-indigo-950/70 ring-4 ring-indigo-500 border-l-4 border-l-indigo-400 scale-[1.03] shadow-2xl shadow-indigo-500/50 animate-pulse duration-1000 z-10';
  }

  switch (tipo) {
    case 'CRITICO': return 'bg-gradient-to-br from-slate-900 to-red-950/40 border-l-4 border-l-red-500 border-t-slate-800 border-r-slate-800 border-b-slate-800 shadow-lg shadow-red-900/10 hover:border-l-red-400';
    case 'ALTO': return 'bg-gradient-to-br from-slate-900 to-orange-950/40 border-l-4 border-l-orange-500 border-t-slate-800 border-r-slate-800 border-b-slate-800 shadow-lg shadow-orange-900/10 hover:border-l-orange-400';
    case 'MEDIO': return 'bg-gradient-to-br from-slate-900 to-yellow-950/30 border-l-4 border-l-yellow-500 border-t-slate-800 border-r-slate-800 border-b-slate-800 shadow-lg shadow-yellow-900/5 hover:border-l-yellow-400';
    case 'BAJO': return 'bg-gradient-to-br from-slate-900 to-blue-950/30 border-l-4 border-l-blue-500 border-t-slate-800 border-r-slate-800 border-b-slate-800 shadow-lg shadow-blue-900/5 hover:border-l-blue-400';
    default: return 'bg-slate-900 border-l-4 border-l-slate-500 border-t-slate-800 border-r-slate-800 border-b-slate-800';
  }
};

const obtenerBadgeUrgencia = (tipo) => {
  switch (tipo) {
    case 'CRITICO': return 'bg-red-500/10 text-red-400 border-red-500/20';
    case 'ALTO': return 'bg-orange-500/10 text-orange-400 border-orange-500/20';
    case 'MEDIO': return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
    case 'BAJO': return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
    default: return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
  }
};

const obtenerIconoCategoria = (categoria) => {
  const catLower = categoria.toLowerCase();
  if (catLower.includes('médic') || catLower.includes('salud')) return <Activity className="w-4 h-4 text-pink-400" />;
  if (catLower.includes('seguridad') || catLower.includes('robo')) return <Shield className="w-4 h-4 text-indigo-400" />;
  if (catLower.includes('protección') || catLower.includes('incendio')) return <Flame className="w-4 h-4 text-orange-400" />;
  if (catLower.includes('falla') || catLower.includes('movilidad')) return <Wrench className="w-4 h-4 text-cyan-400" />;
  return <AlertTriangle className="w-4 h-4 text-slate-400" />;
};

export const AlertCard = ({ alerta, onSelect, isResaltada }) => {
  return (
    <div 
      id={`card-${alerta.id}`} 
      data-device-id={alerta.deviceId} // <-- LÍNEA CRÍTICA AGREGADA
      className={`group relative p-6 rounded-2xl transition-all duration-500 flex flex-col justify-between ${obtenerEstilosUrgencia(alerta.tipo, isResaltada)}`}
    >
      {/* Card Header */}
      <div className="flex justify-between items-start mb-5">
        <div className="flex items-center gap-2.5 bg-slate-950/50 px-3 py-1.5 rounded-lg border border-slate-700/50 text-xs font-medium backdrop-blur-sm shadow-inner">
          {obtenerIconoCategoria(alerta.categoria)}
          <span className="text-slate-200">{alerta.categoria}</span>
        </div>
        <div className={`px-2.5 py-1 border rounded font-bold text-[10px] uppercase tracking-widest ${obtenerBadgeUrgencia(alerta.tipo)}`}>
          {alerta.tipo}
        </div>
      </div>

      {/* Card Body */}
      <div className="space-y-4 flex-grow">
        <p className="text-slate-300 text-sm leading-relaxed font-light">
          {alerta.descripcion}
        </p>

        {/* MÓDULO DE DESPACHO / UNIDAD */}
        <div className="flex items-center gap-2 bg-indigo-950/30 text-indigo-200 px-3 py-2 rounded-lg border border-indigo-900/50 mt-2">
          <Navigation className="w-4 h-4 text-indigo-400" />
          <span className="text-xs font-semibold">Enviar rapidamente: </span>
          <span className="text-xs">{alerta.unidadRespuesta}</span>
        </div>

        <div className="bg-slate-950/40 rounded-xl p-3 border border-slate-800/50">
          <div className="flex items-start gap-3">
            <MapPin className="w-5 h-5 text-indigo-400 mt-0.5 shrink-0" />
            <div className="flex flex-col">
              <span className="text-sm font-medium text-slate-200">{alerta.ubicacion}</span>
              <span className="text-[11px] text-slate-500 font-mono mt-1">Cuadrante: {alerta.cuadrante}</span>
            </div>
          </div>
        </div>

        {/* Media Indicators */}
        {(alerta.media?.photos?.length > 0 || alerta.media?.audio_wav) && (
          <div className="flex flex-wrap gap-2 pt-1">
            {alerta.media?.photos?.length > 0 && (
              <span className="flex items-center gap-1.5 text-[11px] font-medium bg-slate-800/80 text-slate-300 px-2.5 py-1.5 rounded-md border border-slate-700">
                <ImageIcon className="w-3.5 h-3.5 text-indigo-400" /> {alerta.media.photos.length} Capturas
              </span>
            )}
            {alerta.media?.audio_wav && (
              <span className="flex items-center gap-1.5 text-[11px] font-medium bg-slate-800/80 text-slate-300 px-2.5 py-1.5 rounded-md border border-slate-700">
                <Mic className="w-3.5 h-3.5 text-emerald-400" /> Audio IA
              </span>
            )}
          </div>
        )}
      </div>

      {/* Card Footer */}
      <div className="mt-5 pt-4 border-t border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2 text-slate-400 text-xs font-mono">
          <Clock className="w-3.5 h-3.5 text-slate-500" />
          {new Date(alerta.timestamp).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}
        </div>
        
        <div className="flex gap-2">
          {alerta.mapsUrl && (
            <a 
              href={alerta.mapsUrl} 
              target="_blank" 
              rel="noopener noreferrer"
              className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors border border-slate-700 hover:text-white"
              title="Mostrar en Google Maps la ubicación de la alerta recibida"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          )}
          {(alerta.media?.photos?.length > 0 || alerta.media?.audio_wav) && (
            <button 
              onClick={() => onSelect(alerta)}
              className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-xs font-semibold shadow-lg shadow-indigo-900/20 transition-all hover:-translate-y-0.5"
            >
              Analizar Evidencia
            </button>
          )}
        </div>
      </div>
    </div>
  );
};