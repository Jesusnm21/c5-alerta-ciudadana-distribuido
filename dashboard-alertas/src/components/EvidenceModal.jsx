import { useState, useEffect } from 'react';
import { ShieldAlert, X, Mic, FileText, Image as ImageIcon } from 'lucide-react';
import { getMediaUrl } from '../utils/helpers';

export const EvidenceModal = ({ alerta, onClose }) => {
  const [textoTranscripcion, setTextoTranscripcion] = useState('');

  useEffect(() => {
    if (alerta?.media?.transcription_txt) {
      setTextoTranscripcion('Procesando IA de lenguaje natural...');
      fetch(getMediaUrl(alerta.media.transcription_txt))
        .then(res => {
          if (!res.ok) throw new Error("No se pudo leer el archivo");
          return res.text();
        })
        .then(text => setTextoTranscripcion(text))
        .catch(() => setTextoTranscripcion('Aviso: La transcripción aún no está disponible o el archivo no fue encontrado en el servidor.'));
    } else {
      setTextoTranscripcion('No hay transcripción de audio asociada a esta alerta.');
    }
  }, [alerta]);

  if (!alerta) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <div 
        className="absolute inset-0 bg-[#090e17]/90 backdrop-blur-md transition-opacity"
        onClick={onClose}
      ></div>
      
      <div className="relative bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden shadow-2xl shadow-black flex flex-col ring-1 ring-white/10">
        <div className="bg-slate-950 border-b border-slate-800 p-5 flex justify-between items-center z-10">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-3 text-white">
              <ShieldAlert className="w-6 h-6 text-indigo-500" />
              Reporte de Incidencia
            </h2>
            <p className="text-xs text-slate-400 font-mono mt-1 ml-9">ID: {alerta.deviceId}</p>
          </div>
          <button 
            onClick={onClose}
            className="p-2 bg-slate-800/50 hover:bg-red-500/20 hover:text-red-400 rounded-full transition-colors text-slate-400"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-8 bg-gradient-to-b from-slate-900 to-[#090e17]">
          {/* Sección Audio y Transcripción */}
          {alerta.media?.audio_wav && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-slate-800/40 p-5 rounded-xl border border-slate-700/50">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2 mb-4">
                  <Mic className="w-4 h-4 text-emerald-400" /> Registro de Audio
                </h3>
                <audio 
                  controls 
                  src={getMediaUrl(alerta.media.audio_wav)} 
                  className="w-full h-10 rounded-lg bg-slate-900 outline-none"
                />
              </div>
              
              <div className="bg-slate-800/40 p-5 rounded-xl border border-slate-700/50">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2 mb-4">
                  <FileText className="w-4 h-4 text-blue-400" /> Análisis NLP (Transcripción)
                </h3>
                <div className="bg-slate-950/50 p-4 rounded-lg text-sm text-slate-300 font-light border border-slate-800/80 shadow-inner">
                  <p className="italic leading-relaxed">"{textoTranscripcion}"</p>
                </div>
              </div>
            </div>
          )}

          {/* Sección Fotos */}
          {alerta.media?.photos?.length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2 mb-4 px-1">
                <ImageIcon className="w-4 h-4 text-indigo-400" /> Evidencia Fotográfica
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {alerta.media.photos.map((fotoUrl, idx) => (
                  <div key={idx} className="relative group rounded-xl overflow-hidden border border-slate-700 bg-slate-950 aspect-video shadow-lg">
                    <img 
                      src={getMediaUrl(fotoUrl)} 
                      alt={`Cámara ${idx + 1}`}
                      className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105 opacity-90 group-hover:opacity-100"
                      onError={(e) => {
                        e.target.src = 'https://via.placeholder.com/400x225/0f172a/475569?text=Señal+Perdida';
                      }}
                    />
                    <div className="absolute inset-0 pointer-events-none border-[1px] border-white/5 z-10"></div>
                    <div className="absolute top-2 left-2 bg-black/60 px-2 py-0.5 rounded text-[9px] font-mono text-emerald-400 border border-emerald-900/50 z-20">
                      CAM-0{idx + 1} // REC
                    </div>
                    <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent p-3 pt-8 z-20">
                      <span className="text-[10px] font-mono text-slate-300">
  {new Date(alerta.timestamp).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'medium', hour12: false })}
</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};