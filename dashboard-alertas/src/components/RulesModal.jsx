import { useState, useEffect } from 'react';
import { Settings, X, Save, CheckCircle, Brain, AlertOctagon, Info, Plus, Trash2, Filter, Truck } from 'lucide-react';

export const RulesModal = ({ onClose }) => {
  // Estados para manejar arreglos dinámicos en la UI
  const [mapeoIA, setMapeoIA] = useState([]); 
  const [descarte, setDescarte] = useState([]);
  const [guardrailes, setGuardrailes] = useState({});
  const [unidadesRespuesta, setUnidadesRespuesta] = useState([]); // <-- NUEVO ESTADO
  
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState('');
  const [tab, setTab] = useState('MAPEO_IA');
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    fetch('http://localhost:8000/api/rules')
      .then(res => res.json())
      .then(data => {
        // 1. Formatear MAPEO_IA
        const formattedMapeo = Object.entries(data.MAPEO_IA || {}).map(([k, v]) => ({
          id: Math.random().toString(36).substr(2, 9),
          concept: k,
          level: v
        }));
        setMapeoIA(formattedMapeo);

        // 2. Formatear ETIQUETAS_DE_DESCARTE
        const formattedDescarte = (data.ETIQUETAS_DE_DESCARTE || []).map(text => ({
          id: Math.random().toString(36).substr(2, 9),
          text: text
        }));
        setDescarte(formattedDescarte);

        // 3. Formatear GUARDRAILES
        const formattedGuardrailes = {};
        if (data.GUARDRAILES) {
          Object.keys(data.GUARDRAILES).forEach(k => {
            formattedGuardrailes[k] = data.GUARDRAILES[k].join(', ');
          });
        }
        setGuardrailes(formattedGuardrailes);

        // 4. Formatear UNIDADES_RESPUESTA a arreglo para la UI: [{ id, unit, keywords }] <-- NUEVO
        const formattedUnidades = Object.entries(data.UNIDADES_RESPUESTA || {}).map(([k, v]) => ({
          id: Math.random().toString(36).substr(2, 9),
          unit: k,
          keywords: Array.isArray(v) ? v.join(', ') : ''
        }));
        setUnidadesRespuesta(formattedUnidades);
        
        setCargando(false);
      })
      .catch(err => {
        console.error("Error cargando reglas:", err);
        setCargando(false);
      });
  }, []);

  const handleSave = async () => {
    setGuardando(true);
    try {
      // Reconstruir el JSON exacto para el Backend
      const payload = {
        MAPEO_IA: mapeoIA.reduce((acc, curr) => {
          if (curr.concept.trim()) acc[curr.concept.trim()] = curr.level;
          return acc;
        }, {}),
        
        ETIQUETAS_DE_DESCARTE: descarte
          .map(d => d.text.trim())
          .filter(Boolean),
          
        GUARDRAILES: {},

        UNIDADES_RESPUESTA: unidadesRespuesta.reduce((acc, curr) => { // <-- NUEVO REDUCE
          if (curr.unit.trim()) {
            acc[curr.unit.trim()] = curr.keywords
              .split(',')
              .map(s => s.trim())
              .filter(Boolean);
          }
          return acc;
        }, {})
      };

      Object.keys(guardrailes).forEach(k => {
        payload.GUARDRAILES[k] = guardrailes[k]
          .split(',')
          .map(s => s.trim())
          .filter(Boolean);
      });

      const res = await fetch('http://localhost:8000/api/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (res.ok) {
        setMensaje('Parámetros de clasificación actualizados exitosamente');
        setTimeout(() => setMensaje(''), 3000);
      }
    } catch (error) {
      console.error("Error guardando:", error);
    }
    setGuardando(false);
  };

  // --- Funciones para manejar MAPEO_IA ---
  const updateMapeo = (id, field, value) => {
    setMapeoIA(prev => prev.map(item => item.id === id ? { ...item, [field]: value } : item));
  };
  const addMapeoRow = () => {
    setMapeoIA([...mapeoIA, { id: Math.random().toString(36).substr(2, 9), concept: '', level: 'MEDIO' }]);
  };
  const removeMapeoRow = (id) => {
    setMapeoIA(prev => prev.filter(item => item.id !== id));
  };

  // --- Funciones para manejar DESCARTE ---
  const updateDescarte = (id, value) => {
    setDescarte(prev => prev.map(item => item.id === id ? { ...item, text: value } : item));
  };
  const addDescarteRow = () => {
    setDescarte([...descarte, { id: Math.random().toString(36).substr(2, 9), text: '' }]);
  };
  const removeDescarteRow = (id) => {
    setDescarte(prev => prev.filter(item => item.id !== id));
  };

  // --- Funciones para manejar GUARDRAILES ---
  const updateGuardrail = (llave, valorString) => {
    setGuardrailes(prev => ({ ...prev, [llave]: valorString }));
  };

  // --- Funciones para manejar UNIDADES_RESPUESTA <-- NUEVO ---
  const updateUnidad = (id, field, value) => {
    setUnidadesRespuesta(prev => prev.map(item => item.id === id ? { ...item, [field]: value } : item));
  };
  const addUnidadRow = () => {
    setUnidadesRespuesta([...unidadesRespuesta, { id: Math.random().toString(36).substr(2, 9), unit: '', keywords: '' }]);
  };
  const removeUnidadRow = (id) => {
    setUnidadesRespuesta(prev => prev.filter(item => item.id !== id));
  };

  if (cargando) return null;

  const TABS_CONFIG = {
    'MAPEO_IA': {
      titulo: 'Motor IA (NLP)',
      icono: <Brain className="w-4 h-4" />,
      descripcion: 'Añade, edita o elimina los conceptos semánticos que el sistema intentará clasificar. Usa frases naturales descriptivas (ej: "un accidente vehicular grave").'
    },
    'DESCARTE': {
      titulo: 'Etiquetas de Descarte',
      icono: <Filter className="w-4 h-4" />,
      descripcion: 'Si el sistema detecta que el reporte encaja en una de estas frases (broma, pedido de comida) con alta confianza, anulará los guardarraíles críticos.'
    },
    'GUARDRAILES': {
      titulo: 'Guardarrailes',
      icono: <AlertOctagon className="w-4 h-4" />,
      descripcion: 'Añade o elimina palabras estrictas de rescate. Sepáralas por comas. Si existen en el texto, fuerzan prioridad absoluta.'
    },
    'UNIDADES': { // <-- NUEVA CONFIGURACIÓN DE PESTAÑA
      titulo: 'Asignación de Unidades',
      icono: <Truck className="w-4 h-4" />,
      descripcion: 'Mapea de forma dinámica qué Unidades de Respuesta se deben enviar según los términos encontrados en la transcripción de audio o la etiqueta semántica del sistema.'
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative bg-slate-900 border border-slate-700 rounded-xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl shadow-indigo-900/20">
        
        {/* Cabecera */}
        <div className="p-5 border-b border-slate-800 flex justify-between items-center bg-slate-950 rounded-t-xl shrink-0">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-3 text-white tracking-tight">
              <Settings className="w-5 h-5 text-indigo-400" />
              Parámetros de Clasificación de Alertas
            </h2>
            <p className="text-xs text-slate-500 mt-1">Ajuste dinámico de conceptos, filtros, palabras críticas y despacho automático</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-2 bg-slate-800/50 rounded-full transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Pestañas */}
        <div className="flex border-b border-slate-800 bg-slate-900/50 px-4 pt-4 gap-2 shrink-0 overflow-x-auto">
          {Object.entries(TABS_CONFIG).map(([t, config]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-all flex items-center gap-2 whitespace-nowrap ${
                tab === t 
                ? 'border-indigo-500 text-indigo-400 bg-indigo-500/10' 
                : 'border-transparent text-slate-400 hover:text-slate-300 hover:bg-slate-800/50'
              } rounded-t-lg`}
            >
              {config.icono}
              {config.titulo}
            </button>
          ))}
        </div>

        {/* Cuerpo Scrollable */}
        <div className="p-6 overflow-y-auto flex-grow bg-slate-900 custom-scrollbar">
          <div className="mb-6 bg-slate-800/40 border border-slate-700/50 rounded-lg p-4 flex gap-3 items-start">
            <Info className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
            <p className="text-sm text-slate-300 leading-relaxed">
              {TABS_CONFIG[tab].descripcion}
            </p>
          </div>

          {/* TAB 1: MAPEO IA */}
          {tab === 'MAPEO_IA' && (
            <div className="space-y-3">
              <div className="grid grid-cols-12 gap-4 px-4 pb-2 border-b border-slate-800/50 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                <div className="col-span-7">Concepto Semántico</div>
                <div className="col-span-4">Prioridad</div>
                <div className="col-span-1 text-center">Acción</div>
              </div>
              
              {mapeoIA.map((item) => (
                <div key={item.id} className="grid grid-cols-12 gap-4 bg-slate-950 p-3 rounded-lg border border-slate-800 items-center hover:border-slate-700 transition-colors">
                  <div className="col-span-7">
                    <input 
                      type="text" 
                      value={item.concept} 
                      onChange={(e) => updateMapeo(item.id, 'concept', e.target.value)}
                      placeholder="Ej: una emergencia médica..."
                      className="w-full bg-slate-900 border border-slate-700 rounded-md p-2 text-sm text-slate-200 font-mono focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                  <div className="col-span-4">
                    <select
                      value={item.level}
                      onChange={(e) => updateMapeo(item.id, 'level', e.target.value)}
                      className="w-full bg-slate-900 text-sm border border-slate-700 rounded-md p-2 text-white outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all cursor-pointer"
                    >
                      <option value="CRITICO">🔴 CRÍTICO</option>
                      <option value="ALTO">🟠 ALTO</option>
                      <option value="MEDIO">🟡 MEDIO</option>
                    </select>
                  </div>
                  <div className="col-span-1 flex justify-center">
                    <button onClick={() => removeMapeoRow(item.id)} className="text-slate-500 hover:text-red-400 p-2 rounded-lg hover:bg-slate-800 transition-colors" title="Eliminar concepto">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
              
              <button onClick={addMapeoRow} className="mt-4 w-full py-3 border-2 border-dashed border-slate-700 hover:border-indigo-500 hover:text-indigo-400 text-slate-400 rounded-lg flex items-center justify-center gap-2 text-sm font-medium transition-colors">
                <Plus className="w-4 h-4" /> Añadir Nuevo Concepto
              </button>
            </div>
          )}

          {/* TAB 2: ETIQUETAS DE DESCARTE */}
          {tab === 'DESCARTE' && (
            <div className="space-y-3">
              <div className="grid grid-cols-12 gap-4 px-4 pb-2 border-b border-slate-800/50 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                <div className="col-span-11">Frase o Contexto a Descartar</div>
                <div className="col-span-1 text-center">Acción</div>
              </div>

              {descarte.map((item) => (
                <div key={item.id} className="grid grid-cols-12 gap-4 bg-slate-950 p-3 rounded-lg border border-slate-800 items-center hover:border-slate-700 transition-colors">
                  <div className="col-span-11">
                    <input 
                      type="text" 
                      value={item.text} 
                      onChange={(e) => updateDescarte(item.id, e.target.value)}
                      placeholder="Ej: una broma, burla, juego..."
                      className="w-full bg-slate-900 border border-slate-700 rounded-md p-2 text-sm text-slate-200 font-mono focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                  <div className="col-span-1 flex justify-center">
                    <button onClick={() => removeDescarteRow(item.id)} className="text-slate-500 hover:text-red-400 p-2 rounded-lg hover:bg-slate-800 transition-colors" title="Eliminar etiqueta">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}

              <button onClick={addDescarteRow} className="mt-4 w-full py-3 border-2 border-dashed border-slate-700 hover:border-indigo-500 hover:text-indigo-400 text-slate-400 rounded-lg flex items-center justify-center gap-2 text-sm font-medium transition-colors">
                <Plus className="w-4 h-4" /> Añadir Etiqueta de Descarte
              </button>
            </div>
          )}

          {/* TAB 3: GUARDRAILES CRÍTICOS */}
          {tab === 'GUARDRAILES' && (
            <div className="space-y-6">
              {Object.entries(guardrailes).map(([key, valorString]) => (
                <div key={key} className="bg-slate-950 p-5 rounded-lg border border-slate-800 focus-within:border-indigo-500/50 transition-colors">
                  <label className="block text-sm font-semibold text-slate-200 mb-1">
                    {key === 'palabras_criticas' ? 'Términos de Rescate / Salvavidas (Prioridad CRÍTICA)' : key.replace('_', ' ')}
                  </label>
                  <p className="text-[11px] text-slate-500 mb-3 font-mono">Llave técnica: {key}</p>
                  
                  <textarea
                    rows={4}
                    value={valorString}
                    onChange={(e) => updateGuardrail(key, e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-md p-3 text-sm text-indigo-100 font-mono outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 resize-none leading-relaxed"
                    placeholder="Ejemplo: ayuda, socorro, policía"
                  />
                  <div className="flex items-center gap-2 mt-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-500"></div>
                    <p className="text-[12px] text-slate-400">
                      Separa las palabras estrictas siempre por una **coma (,)**.
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* TAB 4: UNIDADES DE RESPUESTA <-- NUEVA INTERFAZ DINÁMICA */}
          {tab === 'UNIDADES' && (
            <div className="space-y-3">
              <div className="grid grid-cols-12 gap-4 px-4 pb-2 border-b border-slate-800/50 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                <div className="col-span-5">Unidad Corporativa / Operativa</div>
                <div className="col-span-6">Palabras Clave del Contexto (Separadas por comas)</div>
                <div className="col-span-1 text-center">Acción</div>
              </div>
              
              {unidadesRespuesta.map((item) => (
                <div key={item.id} className="grid grid-cols-12 gap-4 bg-slate-950 p-3 rounded-lg border border-slate-800 items-center hover:border-slate-700 transition-colors">
                  <div className="col-span-5">
                    <input 
                      type="text" 
                      value={item.unit} 
                      onChange={(e) => updateUnidad(item.id, 'unit', e.target.value)}
                      placeholder="Ej: Bomberos y Protección Civil"
                      className="w-full bg-slate-900 border border-slate-700 rounded-md p-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                  <div className="col-span-6">
                    <input 
                      type="text" 
                      value={item.keywords} 
                      onChange={(e) => updateUnidad(item.id, 'keywords', e.target.value)}
                      placeholder="Ej: fuego, humo, gas, explosión"
                      className="w-full bg-slate-900 border border-slate-700 rounded-md p-2 text-sm text-indigo-100 font-mono focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                  <div className="col-span-1 flex justify-center">
                    <button onClick={() => removeUnidadRow(item.id)} className="text-slate-500 hover:text-red-400 p-2 rounded-lg hover:bg-slate-800 transition-colors" title="Eliminar regla corporativa">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
              
              <button onClick={addUnidadRow} className="mt-4 w-full py-3 border-2 border-dashed border-slate-700 hover:border-indigo-500 hover:text-indigo-400 text-slate-400 rounded-lg flex items-center justify-center gap-2 text-sm font-medium transition-colors">
                <Plus className="w-4 h-4" /> Añadir Nueva Unidad de Respuesta
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-slate-800 bg-slate-950 rounded-b-xl flex justify-between items-center shrink-0">
          <div className="text-emerald-400 text-sm font-medium flex items-center gap-2">
            {mensaje && <><CheckCircle className="w-4 h-4" /> {mensaje}</>}
          </div>
          <button
            onClick={handleSave}
            disabled={guardando}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-500 text-white px-6 py-2.5 rounded-lg text-sm font-bold transition-all shadow-lg shadow-indigo-900/30 active:scale-95"
          >
            <Save className="w-4 h-4" />
            {guardando ? 'Aplicando en C5...' : 'Guardar Cambios'}
          </button>
        </div>
      </div>
    </div>
  );
};