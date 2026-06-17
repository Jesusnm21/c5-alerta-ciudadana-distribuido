import { useState, useEffect, useRef, useMemo } from 'react';
import { ShieldAlert, Filter, ActivitySquare, RefreshCcw, Settings, Bell, BellRing, CheckCheck } from 'lucide-react';
import { RulesModal } from './components/RulesModal';
import { EvidenceModal } from './components/EvidenceModal';
import { AlertCard } from './components/AlertCard';

export default function App() {
  const [alertas, setAlertas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [wsStatus, setWsStatus] = useState('connecting');
  const ws = useRef(null);
  
  // --- REFERENCIA PARA RECONEXIÓN AUTOMÁTICA ---
  const reconnectTimeout = useRef(null);

  // --- REFERENCIA PARA CLICS EXTERNOS ---
  const notifWrapperRef = useRef(null);

  // --- ESTADOS PARA MODALES ---
  const [alertaSeleccionada, setAlertaSeleccionada] = useState(null);
  const [showRulesModal, setShowRulesModal] = useState(false);

  // --- ESTADOS PARA LOS FILTROS ---
  const [filtroUrgencia, setFiltroUrgencia] = useState('Todas');
  const [filtroCategoria, setFiltroCategoria] = useState('Todas');
  const [filtroUbicacion, setFiltroUbicacion] = useState('Todas');
  const [filtroFechaInicio, setFiltroFechaInicio] = useState(''); 
  const [filtroFechaFin, setFiltroFechaFin] = useState('');

  // --- SISTEMA DE NOTIFICACIONES CON PERSISTENCIA LOCAL ---
  const [notificaciones, setNotificaciones] = useState(() => {
    try {
      const respaldosGuardados = localStorage.getItem('c5_notificaciones_vivas');
      return respaldosGuardados ? JSON.parse(respaldosGuardados) : [];
    } catch (error) {
      console.error("Error al inicializar la caché de notificaciones:", error);
      return [];
    }
  });
  const [showNotifMenu, setShowNotifMenu] = useState(false);
  const [alertaResaltadaId, setAlertaResaltadaId] = useState(null);

  // --- DERIVACIÓN DE ETIQUETAS DINÁMICAS ---
  const prioridadesDinamicas = ['Todas', ...new Set(alertas.map(a => a.tipo).filter(Boolean))];
  const categoriasDinamicas = ['Todas', ...new Set(alertas.map(a => a.categoria).filter(Boolean))];
  const ubicacionesDinamicas = ['Todas', ...new Set(alertas.map(a => a.ubicacion).filter(Boolean))];

  // Evaluar si algún modal del sistema se encuentra activo en pantalla
  const unModalEstaActivo = useMemo(() => {
    return !!alertaSeleccionada || showRulesModal;
  }, [alertaSeleccionada, showRulesModal]);

  // Generador determinista de ID único para evitar discrepancies entre hilos de renderizado
  const generarIdTactico = (deviceId, timestamp) => {
    return `ws-${deviceId}-${timestamp}`;
  };

  const formatearAlerta = (data, isWebSocket = false) => {
    const ubicacionRaw = isWebSocket ? data.zona_geografica : data.geography?.zona_geografica;
    const cuadranteRaw = isWebSocket ? data.cuadrante : data.geography?.cuadrante;
    const mapsUrlRaw = isWebSocket ? data.maps_url : data.geography?.maps_url;
    const lat = isWebSocket ? data.lat : data.location?.lat;
    const lng = isWebSocket ? data.lon : data.location?.lon;
    
    const unidadRespuestaRaw = data.response_unit || 'Evaluando...';
    
    const media = isWebSocket 
      ? { 
          media_folder: data.media_folder,
          photos: data.media_folder ? [
            `${data.media_folder}/${data.device_id}_foto_1.jpg`,
            `${data.media_folder}/${data.device_id}_foto_2.jpg`,
            `${data.media_folder}/${data.device_id}_foto_3.jpg`
          ] : [],
          audio_wav: data.media_folder ? `${data.media_folder}/${data.device_id}_audio.wav` : null,
          transcription_txt: data.media_folder ? `${data.media_folder}/${data.device_id}_transcripcion.txt` : null
        } 
      : data.media_attachments || {};

    const prioridadRaw = (data.priority || 'MEDIO').toUpperCase();
    const idUnico = isWebSocket ? generarIdTactico(data.device_id, data.timestamp) : data.id;

    return {
      id: idUnico,
      deviceId: data.device_id,
      lat: lat || 0,
      lng: lng || 0,
      timestampRaw: data.timestamp, 
      timestamp: new Date(data.timestamp * 1000).toISOString(),
      tipo: prioridadRaw,
      categoria: data.emergency_type || 'Generica',
      ubicacion: ubicacionRaw || 'Ubicación no calculada',
      cuadrante: cuadranteRaw || 'S/C',
      mapsUrl: mapsUrlRaw || null,
      media: media,
      unidadRespuesta: unidadRespuestaRaw,
      descripcion: `Alerta recibida. Nivel de prioridad asignado: ${prioridadRaw}.`
    };
  };

  // --- EFECTO: CERRAR NOTIFICACIONES AL HACER CLIC FUERA ---
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (notifWrapperRef.current && !notifWrapperRef.current.contains(event.target)) {
        setShowNotifMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // --- EFECTO: PERSISTIR NOTIFICACIONES EN TIEMPO REAL ---
  useEffect(() => {
    try {
      localStorage.setItem('c5_notificaciones_vivas', JSON.stringify(notificaciones));
    } catch (error) {
      console.error("Error al escribir en localStorage:", error);
    }
  }, [notificaciones]);

  useEffect(() => {
    // 1. Obtener Historial Inicial
    fetch('http://localhost:8000/api/history')
      .then(res => res.json())
      .then(data => {
        if (data.status === 'success') {
          const alertasFormateadas = data.data.map(item => formatearAlerta(item, false));
          setAlertas(alertasFormateadas);
        }
      })
      .catch(err => console.error("Error al obtener historial:", err))
      .finally(() => setLoading(false));

    // 2. Función de Conexión WebSocket Resiliente
    const connectWebSocket = () => {
      if (ws.current && (ws.current.readyState === WebSocket.OPEN || ws.current.readyState === WebSocket.CONNECTING)) {
        return;
      }

      setWsStatus('connecting');
      ws.current = new WebSocket('ws://localhost:8001/ws/operators');
      
      ws.current.onopen = () => {
        console.log("🟢 Conectado al C5 en tiempo real");
        setWsStatus('connected');
        if (reconnectTimeout.current) {
            clearTimeout(reconnectTimeout.current);
            reconnectTimeout.current = null;
        }
      };
      
      ws.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          const targetDeviceId = data.device_id || data.deviceId;
          if (!targetDeviceId) return;

          const targetPriority = data.priority || data.priority_level;

          // INTERCEPCIÓN (Actualización desde IA)
          if (data.action === "UPDATE_PRIORITY") {
            
            // 1. Actualizamos Alertas Principal
            setAlertas((prevAlertas) => {
              const targetIndex = prevAlertas.findIndex(a => String(a.deviceId) === String(targetDeviceId));
              if (targetIndex === -1) return prevAlertas; 

              const alertasActualizadas = [...prevAlertas];
              const a = alertasActualizadas[targetIndex];
              
              const nuevoTipo = targetPriority ? String(targetPriority).toUpperCase() : a.tipo;
              const nuevaCategoria = data.emergency_type || data.categoria || a.categoria;
              const nuevaUnidad = data.response_unit || a.unidadRespuesta;
              
              alertasActualizadas[targetIndex] = { 
                ...a, 
                tipo: nuevoTipo,
                categoria: nuevaCategoria,
                unidadRespuesta: nuevaUnidad,
                descripcion: `Alerta recibida. Nivel de prioridad asignado: ${nuevoTipo}.`
              };

              return alertasActualizadas;
            });

            // 2. Actualizamos Notificaciones INDEPENDIENTEMENTE y sólo la más reciente (findIndex, no map)
            setNotificaciones((prevNotif) => {
              const targetIndex = prevNotif.findIndex(n => String(n.deviceId) === String(targetDeviceId));
              if (targetIndex === -1) return prevNotif;

              const notifActualizadas = [...prevNotif];
              const n = notifActualizadas[targetIndex];

              const nuevoTipo = targetPriority ? String(targetPriority).toUpperCase() : n.tipo;
              const nuevaCategoria = data.emergency_type || data.categoria || n.categoria;

              notifActualizadas[targetIndex] = { 
                ...n, 
                tipo: nuevoTipo, 
                categoria: nuevaCategoria 
              };

              return notifActualizadas;
            });

            return; 
          }

          // PROCESAMIENTO ESTÁNDAR (Creación instantánea)
          const idCalculado = generarIdTactico(targetDeviceId, data.timestamp);
          const nuevaAlerta = formatearAlerta(data, true);

          // 1. Actualizamos la lista de alertas principal
          setAlertas((prevAlertas) => {
            const esDuplicado = prevAlertas.some(a => a.id === idCalculado);
            if (esDuplicado) return prevAlertas;
            return [nuevaAlerta, ...prevAlertas];
          });

          // 2. Actualizamos las notificaciones de manera INDEPENDIENTE
          setNotificaciones((prevNotif) => {
            const esDuplicado = prevNotif.some(n => n.id === idCalculado);
            if (esDuplicado) return prevNotif;
            return [
              {
                id: nuevaAlerta.id,
                deviceId: nuevaAlerta.deviceId,
                categoria: nuevaAlerta.categoria,
                tipo: nuevaAlerta.tipo,
                ubicacion: nuevaAlerta.ubicacion,
                timestamp: nuevaAlerta.timestamp,
                revisada: false
              },
              ...prevNotif
            ];
          });

        } catch (error) {
          console.error("Error procesando mensaje por WS:", error);
        }
      };

      const handleDisconnect = () => {
        setWsStatus('disconnected');
        console.log("🔴 Conexión WS perdida. Intentando reconectar en 3 segundos...");
        if (!reconnectTimeout.current) {
            reconnectTimeout.current = setTimeout(() => {
                reconnectTimeout.current = null;
                connectWebSocket();
            }, 3000);
        }
      };

      ws.current.onclose = handleDisconnect;
      ws.current.onerror = handleDisconnect;
    };

    connectWebSocket();

    return () => {
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
      if (ws.current && (ws.current.readyState === WebSocket.OPEN || ws.current.readyState === WebSocket.CONNECTING)) {
        ws.current.onclose = null;
        ws.current.onerror = null;
        ws.current.close();
      }
    };
  }, []);

  // --- INTERCEPTOR CRÍTICO: AL PRESIONAR "ANALIZAR EVIDENCIA" DESAPARECE LA NOTIFICACIÓN ---
  const handleSeleccionarAlerta = (alerta) => {
    setAlertaSeleccionada(alerta);
    // Solución adicional: Filtramos por ID único en lugar de Device ID para no borrar todo el historial del dispositivo
    setNotificaciones(prev => prev.filter(n => String(n.id) !== String(alerta.id)));
  };

  // --- INTERRUPTOR DE NOTIFICACIÓN CLICKEADA EN EL DROPDOWN DE LA CAMPANA ---
  const handleNotificacionClick = (notif) => {
    setNotificaciones(prev => prev.map(n => n.id === notif.id ? { ...n, revisada: true } : n));
    
    limpiarFiltros();
    setShowNotifMenu(false);

    setTimeout(() => {
      // Búsqueda por ID único de alerta en lugar del dispositivo
      const elementoTarjeta = document.getElementById(`card-${notif.id}`);
      
      if (elementoTarjeta) {
        setAlertaResaltadaId(notif.id);
        elementoTarjeta.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        console.warn(`[C5-NAV] No se localizó la tarjeta física para la alerta: ${notif.id}`);
      }
    }, 150);

    setTimeout(() => {
      setAlertaResaltadaId(null);
    }, 4500);
  };

  const marcarTodasComoRevisadas = () => {
    setNotificaciones(prev => prev.map(n => ({ ...n, revisada: true })));
  };

  const conteoSinRevisar = useMemo(() => notificaciones.filter(n => !n.revisada).length, [notificaciones]);

  // --- FILTROS ---
  const alertasFiltradas = alertas.filter(alerta => {
    const cumpleUrgencia = filtroUrgencia === 'Todas' || alerta.tipo === filtroUrgencia;
    const cumpleCategoria = filtroCategoria === 'Todas' || alerta.categoria === filtroCategoria;
    const cumpleUbicacion = filtroUbicacion === 'Todas' || alerta.ubicacion.includes(filtroUbicacion);
    
    const cumpleFecha = (() => {
      if (!filtroFechaInicio && !filtroFechaFin) return true;
      const alertaTime = new Date(alerta.timestamp).getTime();
      const start = filtroFechaInicio ? new Date(filtroFechaInicio).getTime() : -Infinity;
      const end = filtroFechaFin ? new Date(filtroFechaFin).getTime() : Infinity;
      return alertaTime >= start && alertaTime <= end;
    })();

    return cumpleUrgencia && cumpleCategoria && cumpleUbicacion && cumpleFecha;
  });

  const limpiarFiltros = () => {
    setFiltroUrgencia('Todas');
    setFiltroCategoria('Todas');
    setFiltroUbicacion('Todas');
    setFiltroFechaInicio('');
    setFiltroFechaFin('');
  };

  const metricas = useMemo(() => {
    return {
      total: alertasFiltradas.length,
      criticas: alertasFiltradas.filter(a => a.tipo === 'CRITICO').length,
      hoy: alertasFiltradas.filter(a => {
        if (!a.timestamp) return false;
        return new Date(a.timestamp).toDateString() === new Date().toDateString();
      }).length
    };
  }, [alertasFiltradas]);

  return (
    <div className="min-h-screen bg-[#090e17] p-4 lg:p-8 font-sans text-slate-200 relative selection:bg-indigo-500/30 overflow-x-hidden">
      
      {/* HEADER & TOP BAR */}
      <header className="mb-8 flex flex-col xl:flex-row xl:items-end justify-between gap-6 border-b border-slate-800 pb-6 relative">
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="relative flex h-3 w-3">
              {wsStatus === 'connected' && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
              <span className={`relative inline-flex rounded-full h-3 w-3 ${wsStatus === 'connected' ? 'bg-emerald-500' : wsStatus === 'connecting' ? 'bg-yellow-500' : 'bg-red-500'}`}></span>
            </div>
            <span className="text-xs font-mono font-medium tracking-wider uppercase text-slate-400">
              {wsStatus === 'connected' ? 'Enlace C5 Activo' : wsStatus === 'connecting' ? 'Conectando...' : 'Enlace Perdido (Reconectando)'}
            </span>
          </div>
          
          <div className="flex flex-col gap-3">
            <h1 className="text-3xl lg:text-4xl font-extrabold flex items-center gap-3 text-white tracking-tight">
              <ShieldAlert className="w-10 h-10 text-indigo-500" />
              Vanguardia C5 <span className="text-slate-500 font-light">| Jilotepec</span>
            </h1>
            <div className="flex flex-wrap items-center gap-4">
              <p className="text-slate-400 text-sm max-w-xl">
                Plataforma táctica de monitoreo neuronal. Recepción de incidencias y telemetría en tiempo real.
              </p>
              <button 
                onClick={() => setShowRulesModal(true)}
                className="flex items-center gap-2 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-md border border-slate-700 transition-all hover:scale-102 active:scale-95 duration-150"
              >
                <Settings className="w-3.5 h-3.5" />
                Configurar Reglas Clasificación De Prioridad
              </button>
            </div>
          </div>
        </div>

        {/* CONTENEDOR DE ACCIONES */}
        <div className="flex items-center gap-4 w-full xl:w-auto justify-between xl:justify-end relative">
          
          {/* WRAPPER PARA NOTIFICACIONES Y CLICS EXTERNOS */}
          <div 
            ref={notifWrapperRef}
            className={`relative transition-all duration-300 ${unModalEstaActivo ? 'z-0 pointer-events-none opacity-30' : 'z-[50]'}`}
          >
            <button
              onClick={() => setShowNotifMenu(!showNotifMenu)}
              className={`p-4 rounded-xl border transition-all duration-300 relative flex items-center justify-center ${
                conteoSinRevisar > 0 
                  ? 'bg-indigo-950/40 border-indigo-500/50 text-indigo-400 shadow-lg shadow-indigo-500/20 scale-105' 
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
              }`}
              title="Panel de incidencias entrantes sin revisar"
            >
              {conteoSinRevisar > 0 ? (
                <BellRing className="w-6 h-6 animate-pulse text-indigo-400" />
              ) : (
                <Bell className="w-6 h-6" />
              )}
              
              {conteoSinRevisar > 0 && (
                <span className="absolute -top-1.5 -right-1.5 h-5 min-w-[20px] px-1 bg-gradient-to-r from-red-500 to-pink-500 border border-slate-950 rounded-full text-[10px] font-black text-white flex items-center justify-center animate-bounce shadow-md">
                  {conteoSinRevisar}
                </span>
              )}
            </button>

            {/* PANEL DE NOTIFICACIONES */}
            <div 
              className={`absolute right-0 mt-3 w-[340px] md:w-[400px] bg-slate-950/95 backdrop-blur-xl border border-slate-800 rounded-2xl shadow-2xl shadow-black/80 flex flex-col max-h-[480px] overflow-hidden origin-top-right transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                showNotifMenu 
                  ? 'opacity-100 scale-100 translate-y-0 pointer-events-auto' 
                  : 'opacity-0 scale-95 -translate-y-4 pointer-events-none'
              }`}
            >
              <div className="p-4 bg-slate-900/80 border-b border-slate-800 flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-200 tracking-wider uppercase">Monitor de Arribos</span>
                  {conteoSinRevisar > 0 && (
                    <span className="text-[10px] bg-indigo-500/20 text-indigo-400 px-2 py-0.5 rounded-full font-bold">
                      {conteoSinRevisar} activos
                    </span>
                  )}
                </div>
                {notificaciones.length > 0 && (
                  <button 
                    onClick={marcarTodasComoRevisadas}
                    className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition-colors font-semibold active:scale-95"
                  >
                    <CheckCheck className="w-3.5 h-3.5" /> Despejar vistas
                  </button>
                )}
              </div>

              <div className="overflow-y-auto flex-grow custom-scrollbar divide-y divide-slate-900/60 max-h-[400px]">
                {notificaciones.length === 0 ? (
                  <div className="p-10 text-center text-slate-500 text-xs flex flex-col items-center justify-center gap-3">
                    <Bell className="w-10 h-10 text-slate-700 opacity-40" />
                    <p className="font-medium">Cola de incidencias despejada.</p>
                    <p className="text-[11px] text-slate-600">Las alertas capturadas por WebSocket se enlistarán aquí en tiempo real.</p>
                  </div>
                ) : (
                  notificaciones.map((notif) => (
                    <div 
                      key={notif.id}
                      onClick={() => handleNotificacionClick(notif)}
                      className={`p-4 transition-all duration-200 text-left flex flex-col gap-1 relative border-l-2 hover:scale-[0.99] active:scale-[0.98] cursor-pointer ${
                        notif.revisada 
                          ? 'bg-transparent border-l-transparent opacity-45 hover:opacity-75' 
                          : 'bg-slate-900/40 hover:bg-slate-900/80 border-l-indigo-500 active:bg-slate-900'
                      }`}
                    >
                      <div className="flex justify-between items-start gap-2">
                        <span className="text-xs font-bold text-slate-100 tracking-wide truncate max-w-[75%]">
                          {notif.categoria}
                        </span>
                        <span className={`text-[9px] font-black px-2 py-0.5 rounded border tracking-wider shrink-0 ${
                          notif.tipo === 'CRITICO' 
                            ? 'bg-red-500/10 text-red-400 border-red-500/20' 
                            : notif.tipo === 'ALTO' 
                              ? 'bg-orange-500/10 text-orange-400 border-orange-500/20' 
                              : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                        }`}>
                          {notif.tipo}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 truncate font-light">{notif.ubicacion}</p>
                      <span className="text-[10px] text-slate-400 font-mono mt-1 text-right block">
                        {new Date(notif.timestamp).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* KPIs */}
          <div className="flex gap-4 overflow-x-auto pb-2 xl:pb-0 hide-scrollbar flex-grow xl:flex-grow-0 max-w-full xl:max-w-none">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 min-w-[130px] flex flex-col justify-center shadow-inner">
              <span className="text-slate-500 text-xs font-semibold uppercase tracking-wider mb-1">Total Alertas</span>
              <span className="text-3xl font-bold text-white">{metricas.total}</span>
            </div>
            <div className="bg-red-950/20 border border-red-900/30 rounded-xl p-4 min-w-[130px] flex flex-col justify-center shadow-inner">
              <span className="text-red-400/80 text-xs font-semibold uppercase tracking-wider mb-1">Críticas</span>
              <span className="text-3xl font-bold text-red-400">{metricas.criticas}</span>
            </div>
            <div className="bg-indigo-950/20 border border-indigo-900/30 rounded-xl p-4 min-w-[130px] flex flex-col justify-center shadow-inner">
              <span className="text-indigo-400/80 text-xs font-semibold uppercase tracking-wider mb-1">Hoy</span>
              <span className="text-3xl font-bold text-indigo-400">{metricas.hoy}</span>
            </div>
          </div>
        </div>
      </header>

      {/* FILTROS AVANZADOS */}
      <div className="bg-slate-900/50 backdrop-blur-md border border-slate-800 p-5 rounded-2xl mb-8 shadow-xl relative z-30 transition-all duration-300">
        <div className="flex items-center justify-between mb-5 border-b border-slate-800/80 pb-4">
          <div className="flex items-center gap-2 text-slate-300 font-medium">
            <Filter className="w-5 h-5 text-indigo-400" />
            Parámetros de Filtrado
          </div>
          <button 
            onClick={limpiarFiltros}
            className="text-xs flex items-center gap-1.5 text-slate-400 hover:text-white transition-all bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-full active:scale-95 duration-150"
          >
            <RefreshCcw className="w-3 h-3" /> Limpiar
          </button>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-5">
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] text-slate-500 font-bold uppercase tracking-widest">Prioridad</label>
            <select 
              className="bg-slate-950 border border-slate-800 text-sm rounded-lg p-2.5 text-slate-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all appearance-none cursor-pointer"
              value={filtroUrgencia} onChange={(e) => setFiltroUrgencia(e.target.value)}
            >
              {prioridadesDinamicas.map(prio => <option key={prio} value={prio}>{prio}</option>)}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] text-slate-500 font-bold uppercase tracking-widest">Tipo de Alerta</label>
            <select 
              className="bg-slate-950 border border-slate-800 text-sm rounded-lg p-2.5 text-slate-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all appearance-none cursor-pointer"
              value={filtroCategoria} onChange={(e) => setFiltroCategoria(e.target.value)}
            >
              {categoriasDinamicas.map(cat => <option key={cat} value={cat}>{cat}</option>)}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] text-slate-500 font-bold uppercase tracking-widest">Sector / Cuadrante</label>
            <select 
              className="bg-slate-950 border border-slate-800 text-sm rounded-lg p-2.5 text-slate-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all appearance-none cursor-pointer"
              value={filtroUbicacion} onChange={(e) => setFiltroUbicacion(e.target.value)}
            >
              {ubicacionesDinamicas.map(ubi => <option key={ubi} value={ubi}>{ubi}</option>)}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] text-slate-500 font-bold uppercase tracking-widest">Desde (Fecha/Hora)</label>
            <input 
              type="datetime-local" 
              className="bg-slate-950 border border-slate-800 text-sm rounded-lg p-2.5 text-slate-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all [color-scheme:dark] cursor-pointer"
              value={filtroFechaInicio} onChange={(e) => setFiltroFechaInicio(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] text-slate-500 font-bold uppercase tracking-widest">Hasta (Fecha/Hora)</label>
            <input 
              type="datetime-local" 
              className="bg-slate-950 border border-slate-800 text-sm rounded-lg p-2.5 text-slate-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all [color-scheme:dark] cursor-pointer"
              value={filtroFechaFin} onChange={(e) => setFiltroFechaFin(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* ESTADO DE CARGA */}
      {loading && (
        <div className="flex flex-col justify-center items-center py-20 bg-slate-900/30 rounded-2xl border border-slate-800 border-dashed relative z-10 animate-pulse">
          <ActivitySquare className="w-10 h-10 text-indigo-500 animate-spin mb-4 duration-1000" />
          <span className="text-slate-400 font-mono text-sm">SINCRONIZANDO DATOS TÁCTICOS...</span>
        </div>
      )}

      {/* GRID DE ALERTAS */}
      {!loading && alertasFiltradas.length === 0 && (
        <div className="text-center py-20 bg-slate-900/30 rounded-2xl border border-slate-800 border-dashed text-slate-500 relative z-10 animate-in fade-in duration-300">
          No hay incidentes que coincidan con los filtros actuales o seleccionados.
        </div>
      )}

      {/* AQUÍ SE APLICÓ EL EFECTO HOVER EN EL WRAPPER DE LA TARJETA Y EL ID DINÁMICO */}
      {!loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 relative z-10">
          {alertasFiltradas.map((alerta) => (
            <div 
              key={alerta.id} 
              id={`card-${alerta.id}`}
              className="animate-in fade-in zoom-in-95 slide-in-from-bottom-4 duration-300 ease-out transition-all hover:-translate-y-1.5 hover:shadow-[0_25px_60px_-15px_rgba(59,130,246,0.7)] hover:z-20 rounded-2xl"
            >
              <AlertCard 
                alerta={alerta} 
                onSelect={handleSeleccionarAlerta} 
                isResaltada={String(alertaResaltadaId) === String(alerta.id)} 
              />
            </div>
          ))}
        </div>
      )}

      {/* MODALES EXTERNOS */}
      {alertaSeleccionada && (
        <EvidenceModal 
          alerta={alertaSeleccionada} 
          onClose={() => setAlertaSeleccionada(null)} 
        />
      )}

      {showRulesModal && (
        <RulesModal onClose={() => setShowRulesModal(false)} />
      )}
    </div>
  );
}