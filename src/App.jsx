import { useState, useEffect, useCallback } from "react";
import { Bell, Settings, AlertTriangle, AlertCircle, LifeBuoy, Undo2, Check, Target, Scissors, LogOut, LayoutDashboard, ClipboardList, FolderOpen, Users, TrendingUp, Clock, KeyRound, Shield, Package, ShoppingCart, GitBranch, Activity } from "lucide-react";
import { supabase } from "./supabase";

const hashClave = async (clave, usuario) => {
  const encoder = new TextEncoder();
  const salt = "origentex_" + usuario + "_" + clave.length + "_v2";
  const data = encoder.encode(clave + salt);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
};

const sanitizar = (str) => {
  const s = String(str).trim().slice(0, 200);
  return s.split("").filter(c => c !== "<" && c !== ">" && c !== '"' && c !== "'" && c !== "`" && c !== ";" && c !== "\\").join("");
};
const SESION_MS = 8 * 60 * 60 * 1000;
const INACTIVIDAD_MS = 30 * 60 * 1000;

// ─── ADMIN PREDEFINIDO ────────────────────────────────────────────────────────

const ADMIN_ROOT = { id: "admin_root", nombre: "Administrador", usuario: "admin", rol: "ADMIN", modulo: "", activo: true, hashPendiente: false };
const ADMIN_ROOT_CLAVE = "origen2026*";

// ─── ROLES ────────────────────────────────────────────────────────────────────

const ROLES = {
  ADMIN:               { label: "Administrador",          color: "#ffe600", icon: "👑",  permisos: ["inicio","dashboard","ordenes","catalogo","operarios","eficiencia","horarios","reporte","usuarios","log"] },
  DIRECTOR_PRODUCCION: { label: "Director de Producción", color: "#ff6600", icon: "🏭",  permisos: ["inicio","pipeline","pedidos","ordenes","catalogo","corte","inventario","eficiencia","reporte","dashboard"] },
  COMERCIAL:           { label: "Comercial",              color: "#cc00ff", icon: "💼",  permisos: ["inicio","pedidos"] },
  JEFE_COMPRAS:        { label: "Jefe de Compras",        color: "#00eeff", icon: "📦",  permisos: ["inicio","inventario"] },
  JEFE_CORTE:          { label: "Jefe de Corte",          color: "#ffaa00", icon: "✂️", permisos: ["inicio","corte"] },
  SUPERVISOR:          { label: "Supervisor",             color: "#0088ff", icon: "🎯",  permisos: ["inicio","dashboard","ordenes","catalogo","operarios","eficiencia","horarios"] },
  OPERARIO:            { label: "Operario",               color: "#00ff88", icon: "🔧",  permisos: ["tablet"] },
};

// ─── DATOS INICIALES ──────────────────────────────────────────────────────────

const MODULOS = ["Módulo A", "Módulo B", "Módulo C", "Módulo D", "Módulo E"];
const MAQUINAS = ["Fileteadora", "Recubridora", "Plana", "Ojaladora", "Botonera", "Bordadora", "Cortadora"];
const MOTIVOS_PARADA = [
  { motivo: "Falta de material",        afectaEf: false },
  { motivo: "Máquina dañada",           afectaEf: false },
  { motivo: "Espera de instrucciones",  afectaEf: false },
  { motivo: "Cambio de referencia",     afectaEf: false },
  { motivo: "Mantenimiento",            afectaEf: false },
  { motivo: "Ida al baño",              afectaEf: false },
  { motivo: "Daño de la operaria",      afectaEf: true  },
  { motivo: "Otro",                     afectaEf: false },
];
const TIPOS_DEFECTO = ["Costura abierta", "Medida incorrecta", "Tela defectuosa", "Mal ensamble", "Mancha", "Otro"];
const TALLAS_DISPONIBLES = ["Única", "XS", "S", "M", "L", "XL", "2XL"];

// ─── CONFIGURACIÓN DE HORARIOS ────────────────────────────────────────────────

const HORARIOS_INIT = {
  turno: {
    inicio: "06:00",
    horasProductivas: 8.8,
    horasExtraMax: 2,
    diasBase: ["L","M","X","J","V"],
  },
  pausaActiva: {
    hora: "10:00",
    duracion: 5,
    activa: true,
  },
  modulos: {
    "Módulo A": { desayuno: { hora: "08:00", duracion: 20 }, almuerzo: { hora: "12:00", duracion: 20 }, horasExtra: 0, turnoSabado: false, turnoDomingo: false },
    "Módulo B": { desayuno: { hora: "08:20", duracion: 20 }, almuerzo: { hora: "12:20", duracion: 20 }, horasExtra: 0, turnoSabado: false, turnoDomingo: false },
    "Módulo C": { desayuno: { hora: "08:40", duracion: 20 }, almuerzo: { hora: "12:40", duracion: 20 }, horasExtra: 0, turnoSabado: false, turnoDomingo: false },
    "Módulo D": { desayuno: { hora: "09:00", duracion: 20 }, almuerzo: { hora: "13:00", duracion: 20 }, horasExtra: 0, turnoSabado: false, turnoDomingo: false },
    "Módulo E": { desayuno: { hora: "09:20", duracion: 20 }, almuerzo: { hora: "13:20", duracion: 20 }, horasExtra: 0, turnoSabado: false, turnoDomingo: false },
  },
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const proyectarFinLote = (registrosGlobales, asignaciones, usuarios, ordenes, modulo) => {
  const operariosModulo = usuarios.filter(u => u.rol === "OPERARIO" && u.activo && u.modulo === modulo);
  if (!operariosModulo.length) return null;

  let totalRestantes = 0;
  let velocidadTotal = 0;
  let contVelocidad = 0;

  operariosModulo.forEach(u => {
    const asig = asignaciones.find(a => a.usuarioId === u.id);
    if (!asig?.ordenId || !asig?.operaciones?.length) return;

    const orden = ordenes.find(o => o.id === asig.ordenId);
    if (!orden) return;

    // Calcular restantes en su operación
    asig.operaciones.forEach(op => {
      const regsOp = registrosGlobales.filter(r => r.usuarioId === u.id && !r.esParada && !r.esDefecto && r.operacion === op);
      const sec = orden.secuencia.find(s => s.operacion === op);
      if (!sec) return;

      const restantes = Math.max(0, sec.piezas - regsOp.length);
      totalRestantes += restantes;

      // Velocidad actual de este operario en esta operación
      const regsValidos = regsOp.filter(r => r.tiempoReal !== null);
      if (regsValidos.length >= 3) {
        const prom = regsValidos.slice(0, 10).reduce((a, r) => a + r.tiempoReal, 0) / Math.min(regsValidos.length, 10);
        velocidadTotal += 1 / prom; // prendas por minuto
        contVelocidad++;
      }
    });
  });

  if (!contVelocidad || !totalRestantes) return null;

  const velocidadModulo = velocidadTotal; // prendas por minuto total del módulo
  const minRestantes = Math.round(totalRestantes / velocidadModulo);
  const finEstimado = new Date(Date.now() + minRestantes * 60000);

  return {
    totalRestantes,
    minRestantes,
    finEstimado: finEstimado.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }),
    urgente: minRestantes < 30,
  };
};

const OPERACION_CALIDAD = ["revisar calidad", "control de calidad", "calidad", "control calidad"];

const esOpCalidad = (nombre) => OPERACION_CALIDAD.some(c => nombre?.toLowerCase().includes(c));

const calcEficienciaRealModulo = (registrosGlobales, asignaciones, usuarios, ordenes, horarios, modulo) => {
  const operariosModulo = usuarios.filter(u => u.rol === "OPERARIO" && u.activo && u.modulo === modulo);
  if (!operariosModulo.length) return null;

  // Solo operarios con asignación activa
  const operariosConAsig = operariosModulo.filter(u => asignaciones.find(a => a.usuarioId === u.id && a.ordenId && a.operaciones?.length));
  if (!operariosConAsig.length) return null;

  // Minutos productivos del turno para este módulo
  const minProdPorOperario = horarios
    ? calcFinTurno(horarios, modulo) - horaAMin(horarios.turno.inicio)
      - (horarios.modulos[modulo]?.desayuno.duracion || 0)
      - (horarios.modulos[modulo]?.almuerzo.duracion || 0)
      - (horarios.pausaActiva.activa ? horarios.pausaActiva.duracion : 0)
    : 480;

  // Minutos totales del módulo = operarios con asignación × minutos productivos
  const minTotalesModulo = operariosConAsig.length * minProdPorOperario;

  // SAM total = suma de SAM de TODAS las operaciones asignadas en el módulo (sin repetir, agrupadas por orden)
  let samTotal = 0;
  const opsContadas = new Set();
  operariosConAsig.forEach(u => {
    const asig = asignaciones.find(a => a.usuarioId === u.id);
    const orden = ordenes.find(o => o.id === asig?.ordenId);
    if (!orden) return;
    asig.operaciones?.forEach(op => {
      const key = asig.ordenId + "_" + op; // Agrupar por orden para manejar múltiples órdenes
      if (!opsContadas.has(key)) {
        const sec = orden.secuencia.find(s => s.operacion === op);
        if (sec?.tiempo) { samTotal += sec.tiempo; opsContadas.add(key); }
      }
    });
  });

  if (!samTotal) return null;

  // Meta del turno
  const meta = Math.floor(minTotalesModulo / samTotal);

  // Facturables — solo operación de calidad
  let terminadas = 0;
  let defectos = 0;
  operariosConAsig.forEach(u => {
    const asig = asignaciones.find(a => a.usuarioId === u.id);
    const opCalidad = asig?.operaciones?.find(op => esOpCalidad(op));

    if (opCalidad) {
      // Plan A: operario de calidad asignado
      terminadas += registrosGlobales.filter(r =>
        r.usuarioId === u.id && !r.esParada && !r.esDefecto && r.operacion === opCalidad
      ).length;
    } else {
      // Plan B: última operación asignada como proxy
      const ultimaOp = asig?.operaciones?.[asig.operaciones.length - 1];
      if (ultimaOp) {
        terminadas += registrosGlobales.filter(r =>
          r.usuarioId === u.id && !r.esParada && !r.esDefecto && r.operacion === ultimaOp
        ).length;
      }
    }
    defectos += registrosGlobales.filter(r => r.usuarioId === u.id && r.esDefecto).length;
  });

  const facturables = Math.max(0, terminadas - defectos);
  const eficiencia = meta > 0 ? Math.round((facturables / meta) * 100) : null;

  return {
    terminadas, defectos, facturables, meta,
    eficiencia, samTotal, operarios: operariosConAsig.length,
    minTotales: minTotalesModulo,
  };
};

const horaAMin = (hora) => {
  const [h, m] = hora.split(":").map(Number);
  return h * 60 + m;
};

// Minutos desde medianoche actuales
const ahoraEnMin = () => {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
};

// Calcula fin de turno en minutos
const calcFinTurno = (horarios, modulo) => {
  const inicioMin = horaAMin(horarios.turno.inicio);
  const prodMin = Math.round(horarios.turno.horasProductivas * 60);
  const descMod = horarios.modulos[modulo];
  const desayunoMin = descMod ? descMod.desayuno.duracion : 0;
  const almuerzoMin = descMod ? descMod.almuerzo.duracion : 0;
  const pausaMin = horarios.pausaActiva.activa ? horarios.pausaActiva.duracion : 0;
  const extraMin = descMod ? (descMod.horasExtra || 0) * 60 : 0;
  return inicioMin + prodMin + desayunoMin + almuerzoMin + pausaMin + extraMin;
};

// Detecta si ahora corresponde a un descanso del módulo
const detectarDescanso = (horarios, modulo) => {
  const ahora = ahoraEnMin();
  const mod = horarios.modulos[modulo];
  if (!mod) return null;

  const descansos = [
    { nombre: "Desayuno",     duracion: mod.desayuno.duracion,          inicio: horaAMin(mod.desayuno.hora),          color: "#ff9900" },
    { nombre: "Pausa Activa", duracion: horarios.pausaActiva.duracion,   inicio: horaAMin(horarios.pausaActiva.hora),  color: "#00eeff" },
    { nombre: "Almuerzo",     duracion: mod.almuerzo.duracion,           inicio: horaAMin(mod.almuerzo.hora),          color: "#ff9900" },
  ];

  for (const d of descansos) {
    const minAntes = d.inicio - ahora;
    if (minAntes > 0 && minAntes <= 2) return { ...d, estado: "aviso", minAntes };
    if (ahora >= d.inicio && ahora < d.inicio + d.duracion) return { ...d, estado: "activo", minRestantes: d.inicio + d.duracion - ahora };
  }
  return null;
};

const getCompletadas = (t, operacion) => {
  if (t.completadasPorOp) return t.completadasPorOp[operacion] || 0;
  return t.completadas || 0;
};

const getTotalCompletadas = (t) => {
  if (t.completadasPorOp) return Object.values(t.completadasPorOp).reduce((s, v) => s + v, 0);
  return t.completadas || 0;
};

const calcEficienciaOperario = (operarioId, ordenes) => {
  let total = 0, count = 0;
  ordenes.forEach(o => o.secuencia.forEach(s => {
    if (s.operario === operarioId && s.piezas > 0) {
      total += (s.completadas / s.piezas) * 100;
      count++;
    }
  }));
  return count ? Math.round(total / count) : 0;
};

// ─── DESIGN TOKENS ────────────────────────────────────────────────────────────

const T = {
  bg:      "#0a0a0f",
  surface: "rgba(255,255,255,0.04)",
  border:  "rgba(255,255,255,0.08)",
  yellow:  "#ffe600",
  orange:  "#ff6600",
  red:     "#ff0044",
  green:   "#00ff88",
  blue:    "#0088ff",
  purple:  "#cc00ff",
  cyan:    "#00eeff",
  amber:   "#ffaa00",
  text:    "#ffffff",
  muted:   "#888888",
  faint:   "rgba(255,255,255,0.06)",
  font:    "'Barlow Condensed', 'Arial Narrow', Arial, sans-serif",
  mono:    "'Share Tech Mono', 'Courier New', monospace",
};

const efColor = (ef) => ef >= 90 ? T.green : ef >= 80 ? T.yellow : T.red;

// ─── COMPONENTES UI ───────────────────────────────────────────────────────────

const Glass = ({ children, style = {} }) => (
  <div style={{ background: T.surface, backdropFilter: "blur(20px)", border: "1px solid " + T.border, borderRadius: 14, ...style }}>
    {children}
  </div>
);

const Badge = ({ children, color = "blue", style = {} }) => {
  const colors = {
    blue:   ["#001833", "#0088ff", "#0044aa"],
    green:  ["#001a0d", "#00ff88", "#00aa44"],
    yellow: ["#1a1500", "#ffe600", "#aa9900"],
    red:    ["#1a0011", "#ff0044", "#aa0033"],
    gray:   ["#1a1a1a", "#888888", "#333333"],
    orange: ["#1a0a00", "#ff6600", "#aa4400"],
    cyan:   ["#001a1c", "#00eeff", "#00aaaa"],
  };
  const [bg, text, border] = colors[color] || colors.gray;
  return (
    <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 4, background: bg, color: text, border: "1px solid " + border, fontFamily: T.mono, fontWeight: 700, letterSpacing: "0.06em", whiteSpace: "nowrap", ...style }}>
      {children}
    </span>
  );
};

const KPI = ({ label, value, sub, color = "yellow" }) => {
  const accent = { yellow: T.yellow, green: T.green, red: T.red, purple: T.purple, cyan: T.cyan, blue: T.blue }[color] || T.yellow;
  return (
    <Glass style={{ padding: "10px 14px", borderLeft: "4px solid " + accent }}>
      <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, letterSpacing: "0.14em", marginBottom: 2 }}>{label}</p>
      <p style={{ fontSize: 28, fontWeight: 900, color: accent, fontFamily: T.font, lineHeight: 1 }}>{value}</p>
      {sub && <p style={{ fontSize: 10, color: T.muted, marginTop: 2, fontFamily: T.mono }}>{sub}</p>}
    </Glass>
  );
};

const ProgressBar = ({ value, height = 6 }) => {
  const color = value >= 90 ? T.green : value >= 80 ? T.yellow : T.red;
  return (
    <div style={{ width: "100%", background: "rgba(255,255,255,0.06)", height, borderRadius: height / 2 }}>
      <div style={{ height: "100%", width: Math.min(value, 100) + "%", background: color, borderRadius: height / 2, transition: "width 0.5s" }} />
    </div>
  );
};

// ─── LOGIN ────────────────────────────────────────────────────────────────────

const Login = ({ usuarios, onLogin }) => {
  const [usuario, setUsuario] = useState("");
  const [clave, setClave] = useState("");
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);

  const intentar = async () => {
    const u = sanitizar(usuario).toLowerCase();
    const c = sanitizar(clave);
    if (!u || !c) { setError("Completa todos los campos"); return; }
    setCargando(true);
    try {
      // Admin predefinido
      const hashRoot = await hashClave(ADMIN_ROOT_CLAVE, ADMIN_ROOT.usuario);
      if (u === ADMIN_ROOT.usuario && await hashClave(c, ADMIN_ROOT.usuario) === hashRoot) {
        onLogin(ADMIN_ROOT);
        return;
      }

      // Usuarios de Supabase — buscar por username (case-insensitive), hash con el username guardado
      const candidato = usuarios.find(x => x.usuario.toLowerCase() === u && x.activo);
      if (candidato) {
        const hashCheck = await hashClave(c, candidato.usuario);
        if (candidato.clave === hashCheck) {
          onLogin(candidato);
          return;
        }
      }
      setError("Usuario o clave incorrectos.");
    } catch(e) {
      setError("Error de conexión. Intenta de nuevo.");
    } finally { setCargando(false); }
  };

  const INP = { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", padding: "14px 16px", color: "#f0f0f0", fontSize: 15, outline: "none", fontFamily: T.font, width: "100%", borderRadius: 8, boxSizing: "border-box" };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #0a0a0f 0%, #0d0d1a 50%, #0a0f0a 100%)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 380, display: "flex", flexDirection: "column", gap: 22 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "10px 24px", marginBottom: 10, background: "rgba(0,255,136,0.06)", border: "1px solid rgba(0,255,136,0.3)", borderRadius: 12 }}>
            <Scissors size={20} color={T.green} strokeWidth={2} />
            <span style={{ fontSize: 32, fontWeight: 900, color: T.green, fontFamily: "'Barlow Condensed', Arial", letterSpacing: "0.1em" }}>ORIGENTEX</span>
          </div>
          <p style={{ fontSize: 11, color: T.muted, fontFamily: "monospace", letterSpacing: "0.2em" }}>CONTROL DE PISO</p>
        </div>
        <Glass style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ fontSize: 9, color: T.muted, fontFamily: "monospace", letterSpacing: "0.14em", display: "block", marginBottom: 6 }}>USUARIO</label>
            <input value={usuario} onChange={e => setUsuario(e.target.value)} onKeyDown={e => e.key === "Enter" && intentar()} placeholder="Tu usuario" style={INP} autoComplete="username" />
          </div>
          <div>
            <label style={{ fontSize: 9, color: T.muted, fontFamily: "monospace", letterSpacing: "0.14em", display: "block", marginBottom: 6 }}>CLAVE</label>
            <input type="password" value={clave} onChange={e => setClave(e.target.value)} onKeyDown={e => e.key === "Enter" && intentar()} placeholder="••••" style={INP} autoComplete="current-password" />
          </div>
          {error && <p style={{ color: T.red, fontSize: 12, fontFamily: "monospace", textAlign: "center" }}>⚠ {error}</p>}
          <button onClick={intentar} disabled={cargando} style={{ padding: "16px 0", background: cargando ? "rgba(255,255,255,0.05)" : "linear-gradient(135deg, " + T.green + ", " + T.cyan + ")", color: cargando ? T.muted : "#000", border: "none", fontSize: 16, fontWeight: 900, fontFamily: "'Barlow Condensed', Arial", letterSpacing: "0.12em", cursor: cargando ? "default" : "pointer", borderRadius: 10 }}>
            {cargando ? "VERIFICANDO..." : "INGRESAR →"}
          </button>
        </Glass>
      </div>
    </div>
  );
};

// ─── DASHBOARD ────────────────────────────────────────────────────────────────

const Dashboard = ({ ordenes, operarios, registrosGlobales = [], usuarios = [], asignaciones = [], horarios }) => {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick(v => v + 1), 300000); // cada 5 min
    return () => clearInterval(t);
  }, []);
  const totalPiezas = ordenes.reduce((a, o) => a + o.cantidadTotal, 0);
  const prodReal = registrosGlobales.filter(r => !r.esParada && !r.esDefecto).length;
  const totalProducidas = prodReal > 0 ? prodReal : ordenes.reduce((a, o) => a + o.cantidadProducida, 0);
  const efGeneral = totalPiezas ? Math.round((totalProducidas / totalPiezas) * 100) : 0;
  const activos = operarios.filter(o => o.activo).length;
  const enProceso = ordenes.filter(o => o.estado === "En proceso").length;
  const criticas = ordenes.filter(o => {
    const dias = Math.ceil((new Date(o.fechaEntrega) - new Date()) / 86400000);
    return dias <= 7 && o.cantidadProducida < o.cantidadTotal;
  }).length;

  const efPorUsuario = (uid) => {
    const regs = registrosGlobales.filter(r => r.usuarioId === uid && !r.esParada && r.tiempoReal !== null && r.sam !== null);
    if (!regs.length) return 0;
    const prom = regs.reduce((a, r) => a + r.tiempoReal, 0) / regs.length;
    const sam = regs[0].sam;
    return sam ? Math.round((sam / prom) * 100) : 0;
  };

  const efModulos = MODULOS.map(mod => ({
    modulo: mod,
    data: horarios ? calcEficienciaRealModulo(registrosGlobales, asignaciones, usuarios, ordenes, horarios, mod) : null,
  })).filter(m => m.data && m.data.meta > 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 8 }}>
        <KPI label="Eficiencia General" value={efGeneral + "%"} sub="Produccion del turno" color={efGeneral >= 90 ? "green" : efGeneral >= 80 ? "yellow" : "red"} />
        <KPI label="Operarios Activos" value={activos} sub={"de " + operarios.length + " total"} color="green" />
        <KPI label="Ordenes en Proceso" value={enProceso} sub={ordenes.length + " total"} color="blue" />
        <KPI label="Ordenes Criticas" value={criticas} sub="Entrega en 7 dias" color={criticas > 0 ? "red" : "gray"} />
      </div>

      {/* Eficiencia real por módulo */}
      {efModulos.length > 0 && (
        <Glass style={{ overflow: "hidden" }}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid " + T.border, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <p style={{ fontSize: 10, color: T.green, fontFamily: T.mono, letterSpacing: "0.14em" }}>EFICIENCIA REAL — FACTURABLES</p>
            <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono }}>Actualiza cada 5min</p>
          </div>
          {efModulos.map(({ modulo, data }) => (
            <div key={modulo} style={{ padding: "12px 14px", borderBottom: "1px solid " + T.faint }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 900, color: T.text, fontFamily: T.font }}>{modulo}</p>
                  <div style={{ display: "flex", gap: 10, marginTop: 3, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 10, color: T.green, fontFamily: T.mono }}>{data.facturables} facturables</span>
                    {data.defectos > 0 && <span style={{ fontSize: 10, color: T.red, fontFamily: T.mono }}>{data.defectos} defectos</span>}
                    <span style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>meta {data.meta} uds</span>
                    <span style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>{data.operarios} op. · SAM {data.samTotal?.toFixed(1)}min</span>
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <p style={{ fontSize: 26, fontWeight: 900, color: data.eficiencia !== null ? efColor(data.eficiencia) : T.muted, fontFamily: T.mono, lineHeight: 1 }}>
                    {data.eficiencia !== null ? data.eficiencia + "%" : "—"}
                  </p>
                  <p style={{ fontSize: 8, color: T.muted, fontFamily: T.mono }}>EF. REAL</p>
                </div>
              </div>
              <ProgressBar value={data.eficiencia || 0} />
            </div>
          ))}
        </Glass>
      )}

      {/* Balance de carga y alertas de fin de lote */}
      {(() => {
        const alertas = MODULOS.map(mod => {
          const proy = proyectarFinLote(registrosGlobales, asignaciones, usuarios, ordenes, mod);
          return proy ? { modulo: mod, ...proy } : null;
        }).filter(Boolean);

        if (!alertas.length) return null;
        return (
          <Glass style={{ overflow: "hidden" }}>
            <div style={{ padding: "10px 14px", borderBottom: "1px solid " + T.border }}>
              <p style={{ fontSize: 10, color: T.orange, fontFamily: T.mono, letterSpacing: "0.14em" }}>⚡ ALERTAS DE PRODUCCIÓN</p>
            </div>
            {alertas.map(a => (
              <div key={a.modulo} style={{ padding: "10px 14px", borderBottom: "1px solid " + T.faint, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 900, color: a.urgente ? T.red : T.yellow, fontFamily: T.font }}>{a.modulo}</p>
                  <p style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>
                    {a.urgente ? "⚡ Termina en menos de 30 min" : "📦 Fin estimado: " + a.finEstimado}
                  </p>
                  {a.urgente && <p style={{ fontSize: 10, color: T.yellow, fontFamily: T.mono, marginTop: 2 }}>→ Prepara el siguiente lote</p>}
                </div>
                <div style={{ textAlign: "right" }}>
                  <p style={{ fontSize: 18, fontWeight: 900, color: a.urgente ? T.red : T.yellow, fontFamily: T.mono }}>{a.finEstimado}</p>
                  <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono }}>{a.totalRestantes} uds restantes</p>
                </div>
              </div>
            ))}
          </Glass>
        );
      })()}
      <Glass style={{ overflow: "hidden" }}>
        <div style={{ padding: "10px 14px", borderBottom: "1px solid " + T.border }}>
          <p style={{ fontSize: 10, color: T.muted, fontFamily: T.mono, letterSpacing: "0.14em" }}>OPERARIOS — EFICIENCIA TURNO</p>
        </div>
        {operarios.filter(o => o.activo).map(op => {
          const u = usuarios.find(u => u.nombre === op.nombre);
          const ef = u ? efPorUsuario(u.id) : calcEficienciaOperario(op.id, ordenes);
          return (
            <div key={op.id} style={{ padding: "10px 14px", borderBottom: "1px solid " + T.faint, display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg, " + T.green + ", " + T.cyan + ")", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 900, color: "#000", flexShrink: 0 }}>
                {op.nombre.charAt(0)}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: T.text, fontFamily: T.font }}>{op.nombre}</span>
                  <span style={{ fontSize: 13, fontFamily: T.mono, fontWeight: 900, color: ef > 0 ? efColor(ef) : T.muted }}>{ef > 0 ? ef + "%" : "—"}</span>
                </div>
                {ef > 0 && <ProgressBar value={ef} />}
                <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, marginTop: 3 }}>{op.maquina} · {op.turno}</p>
              </div>
            </div>
          );
        })}
      </Glass>

      <Glass style={{ overflow: "hidden" }}>
        <div style={{ padding: "10px 14px", borderBottom: "1px solid " + T.border }}>
          <p style={{ fontSize: 10, color: T.muted, fontFamily: T.mono, letterSpacing: "0.14em" }}>ORDENES ACTIVAS</p>
        </div>
        {ordenes.filter(o => o.estado !== "Completado").map(o => {
          const pct = Math.round((o.cantidadProducida / o.cantidadTotal) * 100);
          const dias = Math.ceil((new Date(o.fechaEntrega) - new Date()) / 86400000);
          return (
            <div key={o.id} style={{ padding: "10px 14px", borderBottom: "1px solid " + T.faint }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 700, color: T.text, fontFamily: T.font }}>{o.referencia}</p>
                  <p style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>{o.cliente} · {o.id}</p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <p style={{ fontSize: 14, fontWeight: 900, color: efColor(pct), fontFamily: T.mono }}>{pct}%</p>
                  <p style={{ fontSize: 9, color: dias <= 7 ? T.red : dias <= 14 ? T.yellow : T.green, fontFamily: T.mono }}>{dias}d entrega</p>
                </div>
              </div>
              <ProgressBar value={pct} />
            </div>
          );
        })}
      </Glass>
    </div>
  );
};

// ─── GESTIÓN DE ÓRDENES ───────────────────────────────────────────────────────

const GestionOrdenes = ({ ordenes, setOrdenes, operarios, catalogo = [] }) => {
  const [vista, setVista] = useState("lista");
  const [ordenSel, setOrdenSel] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [refSelId, setRefSelId] = useState("");
  const [cliente, setCliente] = useState("");
  const [fechaEntrega, setFechaEntrega] = useState("");
  const [cantidades, setCantidades] = useState({});
  const [noAplica, setNoAplica] = useState(new Set());

  const refSel = catalogo.find(r => r.id === refSelId);

  const seleccionarRef = (id) => {
    setRefSelId(id);
    setCantidades({});
    setNoAplica(new Set());
  };

  const toggleOp = (opNombre) => {
    setNoAplica(prev => {
      const next = new Set(prev);
      next.has(opNombre) ? next.delete(opNombre) : next.add(opNombre);
      return next;
    });
  };

  const crearOrden = () => {
    if (!refSel || !cliente || !fechaEntrega) return;
    const tallas = refSel.tallas
      .filter(t => cantidades[t] > 0)
      .map(t => ({ talla: t, cantidad: parseInt(cantidades[t]) || 0, completadasPorOp: {} }));
    if (!tallas.length) return;
    const cantidadTotal = tallas.reduce((a, t) => a + t.cantidad, 0);
    const nueva = {
      id: "OP-" + Date.now(),
      referencia: refSel.nombre,
      descripcion: refSel.descripcion,
      cliente,
      fechaEntrega,
      cantidadTotal,
      cantidadProducida: 0,
      estado: "Pendiente",
      prioridad: "Media",
      tallas,
      secuencia: refSel.operaciones
        .filter(op => !noAplica.has(op.operacion))
        .map(op => ({
          operacion: op.operacion,
          tiempo: op.sam,
          operario: null,
          piezas: cantidadTotal,
          completadas: 0,
          estado: "Pendiente",
        })),
    };
    setOrdenes(prev => [...prev, nueva]);
    setShowForm(false);
    setRefSelId(""); setCliente(""); setFechaEntrega(""); setCantidades({}); setNoAplica(new Set());
  };

  if (vista === "detalle" && ordenSel) {
    const orden = ordenes.find(o => o.id === ordenSel);
    if (!orden) { setVista("lista"); return null; }
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => setVista("lista")} style={{ color: T.yellow, fontFamily: T.mono, fontSize: 12, background: "none", border: "none", cursor: "pointer", fontWeight: 700 }}>← VOLVER</button>
          <span style={{ color: T.muted, fontFamily: T.mono, fontSize: 12 }}>{orden.id} · {orden.descripcion}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
          {[["Cliente", orden.cliente], ["Entrega", orden.fechaEntrega], ["Avance", Math.round((orden.cantidadProducida / orden.cantidadTotal) * 100) + "%"]].map(([l, v]) => (
            <Glass key={l} style={{ padding: "10px 12px" }}>
              <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, letterSpacing: "0.12em" }}>{l.toUpperCase()}</p>
              <p style={{ fontSize: 15, fontWeight: 800, color: l === "Avance" ? T.yellow : T.text, fontFamily: T.font }}>{v}</p>
            </Glass>
          ))}
        </div>

        {orden.tallas && orden.tallas.length > 0 && (
          <Glass style={{ overflow: "hidden" }}>
            <div style={{ padding: "8px 14px", borderBottom: "1px solid " + T.border }}>
              <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, letterSpacing: "0.14em" }}>AVANCE POR TALLA</p>
            </div>
            <div style={{ padding: 12, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8 }}>
              {orden.tallas.map(t => {
                const comp = getTotalCompletadas(t);
                const pct = t.cantidad > 0 ? Math.round((comp / t.cantidad) * 100) : 0;
                return (
                  <div key={t.talla} style={{ background: pct >= 100 ? "rgba(0,255,136,0.1)" : "rgba(255,255,255,0.03)", border: "1px solid " + (pct >= 100 ? T.green : T.border), borderRadius: 10, padding: "10px 12px" }}>
                    <p style={{ fontSize: 22, fontWeight: 900, color: pct >= 100 ? T.green : T.text, fontFamily: T.font, lineHeight: 1 }}>{t.talla}</p>
                    <ProgressBar value={pct} height={4} />
                    <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, marginTop: 4 }}>{comp}/{t.cantidad} uds</p>
                    <p style={{ fontSize: 9, fontWeight: 700, color: pct >= 100 ? T.green : T.muted, fontFamily: T.mono }}>{pct >= 100 ? "✓ Completa" : "Faltan " + (t.cantidad - comp)}</p>
                  </div>
                );
              })}
            </div>
            <div style={{ padding: "8px 14px", borderTop: "1px solid " + T.border, display: "flex", gap: 16, flexWrap: "wrap" }}>
              <span style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>Total: <b style={{ color: T.text }}>{orden.tallas.reduce((s, t) => s + t.cantidad, 0)} uds</b></span>
              <span style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>Completadas: <b style={{ color: T.green }}>{orden.tallas.reduce((s, t) => s + getTotalCompletadas(t), 0)} uds</b></span>
              <span style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>Pendientes: <b style={{ color: T.yellow }}>{orden.tallas.reduce((s, t) => s + (t.cantidad - getTotalCompletadas(t)), 0)} uds</b></span>
            </div>
          </Glass>
        )}

        <Glass style={{ overflow: "hidden" }}>
          <div style={{ padding: "8px 14px", borderBottom: "1px solid " + T.border }}>
            <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, letterSpacing: "0.14em" }}>SECUENCIA DE OPERACIONES</p>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ background: "rgba(255,255,255,0.03)", borderBottom: "2px solid " + T.yellow }}>
                  {["#", "Operacion", "SAM", "Piezas", "Completadas", "Ef.", "Estado"].map(h => (
                    <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: T.muted, fontFamily: T.mono, fontWeight: 700, letterSpacing: "0.1em", fontSize: 9 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orden.secuencia.map((s, i) => {
                  const ef = s.piezas ? Math.round((s.completadas / s.piezas) * 100) : 0;
                  const estadoColor = { "Completado": "green", "En proceso": "cyan", "Pendiente": "gray" };
                  return (
                    <tr key={i} style={{ borderBottom: "1px solid " + T.faint }}>
                      <td style={{ padding: "7px 10px", color: T.muted, fontFamily: T.mono }}>{String(i + 1).padStart(2, "0")}</td>
                      <td style={{ padding: "7px 10px", color: T.text, fontWeight: 600 }}>{s.operacion}</td>
                      <td style={{ padding: "7px 10px", color: T.yellow, fontFamily: T.mono }}>{s.tiempo}</td>
                      <td style={{ padding: "7px 10px", color: T.muted, fontFamily: T.mono }}>{s.piezas}</td>
                      <td style={{ padding: "7px 10px", color: T.text, fontFamily: T.mono }}>{s.completadas}</td>
                      <td style={{ padding: "7px 10px", fontFamily: T.mono, fontWeight: 900, color: ef >= 90 ? T.green : ef >= 80 ? T.yellow : ef > 0 ? T.red : T.muted }}>{ef > 0 ? ef + "%" : "—"}</td>
                      <td style={{ padding: "7px 10px" }}><Badge color={estadoColor[s.estado] || "gray"}>{s.estado}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Glass>
      </div>
    );
  }

  const INP = { background: "rgba(255,255,255,0.05)", border: "1px solid " + T.border, padding: "10px 12px", color: T.text, fontSize: 13, outline: "none", fontFamily: T.font, width: "100%", borderRadius: 6 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <p style={{ fontSize: 10, color: T.muted, fontFamily: T.mono, letterSpacing: "0.14em" }}>ÓRDENES DE PRODUCCIÓN</p>
        <button onClick={() => setShowForm(v => !v)} style={{ background: T.yellow, color: "#000", fontFamily: T.mono, fontWeight: 900, fontSize: 11, padding: "7px 16px", border: "none", cursor: "pointer" }}>+ NUEVA ORDEN</button>
      </div>

      {showForm && (
        <Glass style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={{ fontSize: 11, color: T.yellow, fontFamily: T.mono, letterSpacing: "0.12em" }}>NUEVA ORDEN DE PRODUCCIÓN</p>
          <div>
            <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, marginBottom: 6 }}>REFERENCIA DEL CATÁLOGO</p>
            <select value={refSelId} onChange={e => seleccionarRef(e.target.value)}
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid " + T.border, padding: "10px 12px", color: T.text, fontSize: 13, outline: "none", fontFamily: T.font, width: "100%", borderRadius: 6 }}>
              <option value="">Selecciona una referencia...</option>
              {catalogo.map(r => <option key={r.id} value={r.id}>{r.nombre} — {r.descripcion}</option>)}
            </select>
          </div>
          {refSel && refSel.operaciones.length > 0 && (
            <div>
              <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, letterSpacing: "0.12em", marginBottom: 8 }}>
                PROCESOS — toca para marcar "No aplica"
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {refSel.operaciones.map((op, i) => {
                  const excluida = noAplica.has(op.operacion);
                  return (
                    <div key={i} onClick={() => toggleOp(op.operacion)}
                      style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 12px", borderRadius: 7, border: "1px solid " + (excluida ? "rgba(255,68,68,0.4)" : "rgba(0,255,136,0.25)"), background: excluida ? "rgba(255,68,68,0.06)" : "rgba(0,255,136,0.04)", cursor: "pointer", opacity: excluida ? 0.6 : 1 }}>
                      <span style={{ fontSize: 12, color: excluida ? T.red : T.text, textDecoration: excluida ? "line-through" : "none", fontFamily: T.mono }}>{op.operacion}</span>
                      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <span style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>{op.sam} min</span>
                        <span style={{ fontSize: 9, fontFamily: T.mono, fontWeight: 700, color: excluida ? T.red : T.green }}>
                          {excluida ? "NO APLICA" : "APLICA"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p style={{ fontSize: 10, color: T.muted, fontFamily: T.mono, marginTop: 6, textAlign: "right" }}>
                {refSel.operaciones.length - noAplica.size} de {refSel.operaciones.length} procesos activos ·{" "}
                SAM: {refSel.operaciones.filter(op => !noAplica.has(op.operacion)).reduce((a, o) => a + (o.sam || 0), 0).toFixed(1)} min
              </p>
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, marginBottom: 4 }}>CLIENTE</p>
              <input value={cliente} onChange={e => setCliente(e.target.value)} placeholder="Nombre del cliente" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid " + T.border, padding: "10px 12px", color: T.text, fontSize: 13, outline: "none", fontFamily: T.font, width: "100%", borderRadius: 6 }} />
            </div>
            <div>
              <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, marginBottom: 4 }}>FECHA DE ENTREGA</p>
              <input type="date" value={fechaEntrega} onChange={e => setFechaEntrega(e.target.value)} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid " + T.border, padding: "10px 12px", color: T.text, fontSize: 13, outline: "none", fontFamily: T.font, width: "100%", borderRadius: 6 }} />
            </div>
          </div>
          {refSel && (
            <div>
              <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, letterSpacing: "0.12em", marginBottom: 8 }}>CANTIDADES POR TALLA</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                {refSel.tallas.map(t => (
                  <div key={t}>
                    <p style={{ fontSize: 11, fontWeight: 900, color: T.text, fontFamily: T.font, marginBottom: 4, textAlign: "center" }}>{t}</p>
                    <input type="number" min={0} placeholder="0" value={cantidades[t] || ""}
                      onChange={e => setCantidades(p => ({ ...p, [t]: parseInt(e.target.value) || 0 }))}
                      style={{ background: "rgba(255,255,255,0.05)", border: "1px solid " + (cantidades[t] > 0 ? T.green : T.border), padding: "8px", color: cantidades[t] > 0 ? T.green : T.text, fontSize: 13, outline: "none", fontFamily: T.mono, width: "100%", borderRadius: 6, textAlign: "center" }} />
                  </div>
                ))}
              </div>
              {Object.values(cantidades).some(v => v > 0) && (
                <p style={{ fontSize: 11, color: T.yellow, fontFamily: T.mono, marginTop: 8, textAlign: "right" }}>
                  Total: {Object.values(cantidades).reduce((a, v) => a + (parseInt(v) || 0), 0)} unidades
                </p>
              )}
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={crearOrden}
              disabled={!refSel || !cliente || !fechaEntrega || !Object.values(cantidades).some(v => v > 0)}
              style={{ flex: 1, padding: "12px 0", background: refSel && cliente && fechaEntrega && Object.values(cantidades).some(v => v > 0) ? T.green : "rgba(255,255,255,0.05)", color: refSel && cliente && fechaEntrega && Object.values(cantidades).some(v => v > 0) ? "#000" : T.muted, border: "none", fontFamily: T.mono, fontWeight: 900, cursor: "pointer", borderRadius: 8 }}>
              CREAR ORDEN
            </button>
            <button onClick={() => setShowForm(false)} style={{ padding: "12px 16px", background: "transparent", color: T.muted, border: "1px solid " + T.border, fontFamily: T.mono, cursor: "pointer", borderRadius: 8 }}>CANCELAR</button>
          </div>
        </Glass>
      )}

      {ordenes.map(o => {
        const pct = Math.round((o.cantidadProducida / o.cantidadTotal) * 100);
        const dias = Math.ceil((new Date(o.fechaEntrega) - new Date()) / 86400000);
        const prioColor = { Alta: T.red, Media: T.yellow, Baja: T.green }[o.prioridad] || T.muted;
        return (
          <Glass key={o.id} style={{ overflow: "hidden" }}>
            <div style={{ padding: "12px 14px", cursor: "pointer" }} onClick={() => { setOrdenSel(o.id); setVista("detalle"); }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                    <p style={{ fontSize: 16, fontWeight: 900, color: T.text, fontFamily: T.font }}>{o.referencia}</p>
                    <Badge color={o.estado === "Completado" ? "green" : o.estado === "En proceso" ? "cyan" : "gray"}>{o.estado}</Badge>
                    <span style={{ fontSize: 9, color: prioColor, fontFamily: T.mono, fontWeight: 700 }}>{o.prioridad}</span>
                  </div>
                  <p style={{ fontSize: 11, color: T.muted, fontFamily: T.mono }}>{o.cliente} · {o.id}</p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <p style={{ fontSize: 20, fontWeight: 900, color: efColor(pct), fontFamily: T.mono, lineHeight: 1 }}>{pct}%</p>
                  <p style={{ fontSize: 9, fontFamily: T.mono, color: dias <= 7 ? T.red : dias <= 14 ? T.yellow : T.green }}>{dias}d</p>
                </div>
              </div>
              <ProgressBar value={pct} />
              <div style={{ display: "flex", gap: 12, marginTop: 6, fontSize: 10, color: T.muted, fontFamily: T.mono }}>
                <span>{o.cantidadProducida}/{o.cantidadTotal} uds</span>
                <span>{o.secuencia.filter(s => s.estado === "Completado").length}/{o.secuencia.length} ops</span>
                <span>{o.descripcion}</span>
              </div>
            </div>
          </Glass>
        );
      })}
    </div>
  );
};

// ─── GESTIÓN DE OPERARIOS / SUPERVISOR ───────────────────────────────────────

const GestionOperarios = ({ operarios, setOperarios, ordenes, usuarios, asignaciones, setAsignaciones, mensajes, setMensajes, sesion, registrosGlobales = [] }) => {
  const [tabLocal, setTabLocal] = useState("piso");
  const [showForm, setShowForm] = useState(false);
  const [nuevo, setNuevo] = useState({ nombre: "", maquina: MAQUINAS[0], turno: "Mañana" });
  const [msgForm, setMsgForm] = useState({ texto: "", destino: "todos", moduloDest: MODULOS[0], usuarioDest: "" });

  const agregar = () => {
    if (!nuevo.nombre) return;
    setOperarios(prev => [...prev, { ...nuevo, id: Date.now(), activo: true, usuario: "" }]);
    setShowForm(false);
    setNuevo({ nombre: "", maquina: MAQUINAS[0], turno: "Mañana" });
  };

  const enviarMensaje = () => {
    if (!msgForm.texto.trim()) return;
    setMensajes(prev => [{
      id: Date.now(), texto: msgForm.texto.trim(),
      destino: msgForm.destino, moduloDest: msgForm.moduloDest,
      usuarioDest: msgForm.usuarioDest,
      ts: new Date().toLocaleTimeString("es-CO"),
      de: sesion?.nombre || "Supervisor", leidoPor: [],
    }, ...prev]);
    setMsgForm(p => ({ ...p, texto: "" }));
  };

  const esSupervisor = sesion?.rol === "SUPERVISOR" || sesion?.rol === "ADMIN";
  const TABS = [["piso","🏭 Piso en vivo"],["operarios","👷 Operarios"],["mensajes","💬 Mensajes"], ...(esSupervisor ? [["asignaciones","🎯 Asignaciones"]] : [])];
  const INP = { background: "rgba(255,255,255,0.05)", border: "1px solid " + T.border, padding: "8px 10px", color: T.text, fontSize: 12, outline: "none", fontFamily: T.font, width: "100%", borderRadius: 6 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid " + T.faint }}>
        {TABS.map(([id, label]) => (
          <button key={id} onClick={() => setTabLocal(id)} style={{ padding: "8px 14px", fontSize: 12, fontWeight: 800, fontFamily: T.font, background: "transparent", color: tabLocal === id ? "#4499ff" : T.muted, border: "none", borderBottom: tabLocal === id ? "2px solid #4499ff" : "2px solid transparent", cursor: "pointer" }}>
            {label}
          </button>
        ))}
      </div>

      {/* PISO EN VIVO */}
      {tabLocal === "piso" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Alertas */}
          {(() => {
            const paradas = registrosGlobales.filter(r => r.esParada).slice(0, 3);
            const ayudas = mensajes.filter(m => m.destino === "supervisor" && !m.leidoPor?.includes(sesion?.id)).slice(0, 3);
            if (!paradas.length && !ayudas.length) return null;
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {paradas.map(r => (
                  <div key={r.id} style={{ background: "rgba(255,102,0,0.1)", border: "1px solid " + T.orange, borderRadius: 10, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <AlertTriangle size={16} color={T.orange} />
                      <div>
                        <p style={{ fontSize: 12, fontWeight: 900, color: T.orange, fontFamily: T.font }}>{r.nombre} — PARADA</p>
                        <p style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>{r.motivo} · {r.ts}</p>
                      </div>
                    </div>
                    <Badge color="orange">{r.modulo}</Badge>
                  </div>
                ))}
                {ayudas.map(m => (
                  <div key={m.id} style={{ background: "rgba(68,153,255,0.1)", border: "1px solid #4499ff", borderRadius: 10, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <LifeBuoy size={16} color="#4499ff" />
                      <div>
                        <p style={{ fontSize: 12, fontWeight: 900, color: "#4499ff", fontFamily: T.font }}>{m.de} — AYUDA</p>
                        <p style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>{m.texto}</p>
                      </div>
                    </div>
                    <button onClick={() => {
                      const tiempoRespMin = Math.round((Date.now() - m.id) / 60000);
                      setMensajes(prev => prev.map(x => x.id === m.id ? { ...x, leidoPor: [...(x.leidoPor || []), sesion?.id], tiempoRespuestaMin: tiempoRespMin, atendidoPor: sesion?.nombre } : x));
                    }}
                      style={{ background: "#4499ff", color: "#fff", border: "none", borderRadius: 6, padding: "4px 10px", fontSize: 10, fontFamily: T.mono, cursor: "pointer" }}>
                      ✓ ATENDIDO
                    </button>
                  </div>
                ))}
              </div>
            );
          })()}

          {(usuarios || []).filter(u => u.rol === "OPERARIO" && u.activo).map(u => {
            const asig = asignaciones?.find(a => a.usuarioId === u.id);
            const orden = ordenes.find(o => o.id === asig?.ordenId);
            const tallas = orden?.tallas || [];
            const totalComp = tallas.reduce((s, t) => s + getTotalCompletadas(t), 0);
            const totalCant = tallas.reduce((s, t) => s + t.cantidad, 0);
            const pctGeneral = totalCant > 0 ? Math.round((totalComp / totalCant) * 100) : 0;
            const misRegs = registrosGlobales.filter(r => r.usuarioId === u.id && !r.esParada && !r.esDefecto);
            const ultimaParada = registrosGlobales.find(r => r.usuarioId === u.id && r.esParada);
            const tieneAyuda = mensajes.some(m => m.de === u.nombre && !m.leidoPor?.includes(sesion?.id));
            const ultimoReg = registrosGlobales.find(r => r.usuarioId === u.id && !r.esParada);
            const minSin = ultimoReg ? Math.round((Date.now() - ultimoReg.id) / 60000) : null;
            const alertaSin = minSin !== null && minSin >= 10;

            // Proyección de fin de lote del módulo
            const proyeccion = proyectarFinLote(registrosGlobales, asignaciones, usuarios, ordenes, u.modulo);
            let efTurno = null;
            if (misRegs.length > 0 && misRegs[0].sam) {
              const prom = misRegs.reduce((a, r) => a + r.tiempoReal, 0) / misRegs.length;
              efTurno = Math.round((misRegs[0].sam / prom) * 100);
            }
            const borde = tieneAyuda ? "#4499ff" : alertaSin ? T.red : ultimaParada ? T.orange : T.border;

            return (
              <Glass key={u.id} style={{ border: "1px solid " + borde, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ background: "linear-gradient(135deg, " + T.green + ", " + T.cyan + ")", width: 34, height: 34, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 900, color: "#000" }}>
                      {u.nombre.charAt(0)}
                    </div>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <p style={{ fontSize: 14, fontWeight: 900, color: T.text, fontFamily: T.font }}>{u.nombre}</p>
                        {tieneAyuda && <LifeBuoy size={14} color="#4499ff" />}
                        {alertaSin && <span style={{ fontSize: 9, color: T.red, fontFamily: T.mono, background: "rgba(255,0,68,0.1)", border: "1px solid rgba(255,0,68,0.3)", padding: "1px 6px", borderRadius: 4 }}>{minSin}min sin marcar</span>}
                        {ultimaParada && !tieneAyuda && !alertaSin && <AlertTriangle size={14} color={T.orange} />}
                      </div>
                      <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono }}>{u.modulo}</p>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    {efTurno !== null && (
                      <div style={{ textAlign: "right" }}>
                        <p style={{ fontSize: 20, fontWeight: 900, color: efColor(efTurno), fontFamily: T.mono, lineHeight: 1 }}>{efTurno}%</p>
                        <p style={{ fontSize: 8, color: T.muted, fontFamily: T.mono }}>EFICIENCIA</p>
                      </div>
                    )}
                    <div style={{ textAlign: "right" }}>
                      <p style={{ fontSize: 20, fontWeight: 900, color: T.yellow, fontFamily: T.mono, lineHeight: 1 }}>{misRegs.length}</p>
                      <p style={{ fontSize: 8, color: T.muted, fontFamily: T.mono }}>UDS HOY</p>
                    </div>
                  </div>
                </div>

                {orden && (
                  <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "6px 10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <p style={{ fontSize: 11, fontWeight: 900, color: T.yellow, fontFamily: T.mono }}>{orden.referencia} · {orden.id}</p>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {asig?.operaciones?.map(op => <Badge key={op} color="gray">{op}</Badge>)}
                    </div>
                  </div>
                )}

                {tallas.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {tallas.map(t => {
                        const comp = getTotalCompletadas(t);
                        const pct = t.cantidad > 0 ? Math.round((comp / t.cantidad) * 100) : 0;
                        return (
                          <div key={t.talla} style={{ background: pct >= 100 ? "rgba(0,255,136,0.1)" : "rgba(255,255,255,0.03)", border: "1px solid " + (pct >= 100 ? T.green : T.border), borderRadius: 10, padding: "8px 12px", minWidth: 70 }}>
                            <p style={{ fontSize: 16, fontWeight: 900, color: pct >= 100 ? T.green : T.text, fontFamily: T.font, lineHeight: 1 }}>{t.talla}</p>
                            <ProgressBar value={pct} height={3} />
                            <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, marginTop: 3 }}>{comp}/{t.cantidad}</p>
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1 }}><ProgressBar value={pctGeneral} /></div>
                      <span style={{ fontSize: 12, fontWeight: 900, color: efColor(pctGeneral), fontFamily: T.mono, width: 40, textAlign: "right" }}>{pctGeneral}%</span>
                    </div>
                  </div>
                )}

                {ultimaParada && (
                  <div style={{ background: "rgba(255,102,0,0.08)", border: "1px solid rgba(255,102,0,0.3)", borderRadius: 8, padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <AlertTriangle size={12} color={T.orange} />
                      <p style={{ fontSize: 10, color: T.orange, fontFamily: T.mono }}>{ultimaParada.motivo} · {ultimaParada.ts}</p>
                    </div>
                    <button onClick={() => {
                      setMensajes(prev => [{ id: Date.now(), texto: "Parada resuelta por " + sesion?.nombre + ". Puedes reanudar.", destino: "operario", usuarioDest: u.id, de: sesion?.nombre, leidoPor: [], ts: new Date().toLocaleTimeString("es-CO") }, ...prev]);
                    }} style={{ background: T.green, color: "#000", border: "none", borderRadius: 6, padding: "4px 10px", fontSize: 10, fontFamily: T.mono, fontWeight: 900, cursor: "pointer", whiteSpace: "nowrap" }}>
                      ✓ RESOLVER
                    </button>
                  </div>
                )}

                {/* Proyección fin de lote */}
                {proyeccion && (
                  <div style={{ background: proyeccion.urgente ? "rgba(255,0,68,0.08)" : "rgba(0,255,136,0.06)", border: "1px solid " + (proyeccion.urgente ? "rgba(255,0,68,0.3)" : "rgba(0,255,136,0.2)"), borderRadius: 8, padding: "6px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <p style={{ fontSize: 10, color: proyeccion.urgente ? T.red : T.green, fontFamily: T.mono }}>
                      {proyeccion.urgente ? "⚡ LOTE TERMINA PRONTO" : "📦 FIN ESTIMADO DEL LOTE"}
                    </p>
                    <div style={{ textAlign: "right" }}>
                      <p style={{ fontSize: 13, fontWeight: 900, color: proyeccion.urgente ? T.red : T.green, fontFamily: T.mono }}>{proyeccion.finEstimado}</p>
                      <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono }}>{proyeccion.totalRestantes} uds · {proyeccion.minRestantes}min</p>
                    </div>
                  </div>
                )}

                {/* Asignación rápida */}
                <div style={{ borderTop: "1px solid " + T.faint, paddingTop: 8, display: "flex", gap: 6, alignItems: "center" }}>
                  <select defaultValue={asig?.ordenId || ""} disabled={!esSupervisor} onChange={e => {
                    setAsignaciones(prev => {
                      const sinEste = prev.filter(a => a.usuarioId !== u.id);
                      if (!e.target.value) return sinEste;
                      const orden = ordenes.find(o => o.id === e.target.value);
                      setMensajes(prev => [{ id: Date.now(), texto: "Tu asignación cambió a " + (orden?.referencia || e.target.value) + ". Revisa tus operaciones.", destino: "operario", usuarioDest: u.id, de: sesion?.nombre || "Supervisor", leidoPor: [], ts: new Date().toLocaleTimeString("es-CO") }, ...prev]);
                      return [...sinEste, { usuarioId: u.id, ordenId: e.target.value, operaciones: asig?.operaciones || [] }];
                    });
                  }} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid " + T.border, color: T.muted, fontFamily: T.mono, fontSize: 10, padding: "4px 8px", borderRadius: 6, cursor: esSupervisor ? "pointer" : "default", flex: 1, opacity: esSupervisor ? 1 : 0.5 }}>
                    <option value="">Sin orden</option>
                    {ordenes.filter(o => o.estado !== "Completado").map(o => <option key={o.id} value={o.id}>{o.id} · {o.referencia}</option>)}
                  </select>
                  <span style={{ fontSize: 9, color: T.muted, fontFamily: T.mono }}>{asig?.operaciones?.length || 0} op.</span>
                </div>
              </Glass>
            );
          })}
        </div>
      )}

      {/* OPERARIOS */}
      {tabLocal === "operarios" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <p style={{ fontSize: 10, color: T.muted, fontFamily: T.mono, letterSpacing: "0.14em" }}>GESTIÓN DE OPERARIOS</p>
            <button onClick={() => setShowForm(v => !v)} style={{ background: T.yellow, color: "#000", fontFamily: T.mono, fontWeight: 900, fontSize: 11, padding: "7px 14px", border: "none", cursor: "pointer" }}>+ NUEVO</button>
          </div>
          {showForm && (
            <Glass style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              <input placeholder="Nombre completo" value={nuevo.nombre} onChange={e => setNuevo(p => ({ ...p, nombre: e.target.value }))} style={INP} />
              <select value={nuevo.maquina} onChange={e => setNuevo(p => ({ ...p, maquina: e.target.value }))} style={INP}>
                {MAQUINAS.map(m => <option key={m}>{m}</option>)}
              </select>
              <select value={nuevo.turno} onChange={e => setNuevo(p => ({ ...p, turno: e.target.value }))} style={INP}>
                {["Mañana", "Tarde", "Noche"].map(t => <option key={t}>{t}</option>)}
              </select>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={agregar} style={{ flex: 1, padding: "10px 0", background: T.green, color: "#000", border: "none", fontFamily: T.mono, fontWeight: 900, cursor: "pointer" }}>AGREGAR</button>
                <button onClick={() => setShowForm(false)} style={{ padding: "10px 16px", background: "transparent", color: T.muted, border: "1px solid " + T.border, fontFamily: T.mono, cursor: "pointer" }}>CANCELAR</button>
              </div>
            </Glass>
          )}
          {operarios.map(op => (
            <Glass key={op.id} style={{ padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: "50%", background: op.activo ? "linear-gradient(135deg," + T.green + "," + T.cyan + ")" : "rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 900, color: op.activo ? "#000" : T.muted }}>
                  {op.nombre.charAt(0)}
                </div>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 700, color: op.activo ? T.text : T.muted, fontFamily: T.font }}>{op.nombre}</p>
                  <p style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>{op.maquina} · {op.turno}</p>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <Badge color={op.activo ? "green" : "gray"}>{op.activo ? "Activo" : "Inactivo"}</Badge>
                <button onClick={() => setOperarios(prev => prev.map(o => o.id === op.id ? { ...o, activo: !o.activo } : o))}
                  style={{ background: "transparent", border: "1px solid " + T.border, color: T.muted, fontFamily: T.mono, fontSize: 10, padding: "4px 8px", cursor: "pointer" }}>
                  {op.activo ? "Desactivar" : "Activar"}
                </button>
              </div>
            </Glass>
          ))}
        </div>
      )}

      {/* ASIGNACIONES */}
      {tabLocal === "asignaciones" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Resumen de cobertura */}
          {(() => {
            const operariosRol = (usuarios || []).filter(u => u.rol === "OPERARIO" && u.activo);
            const asignados = operariosRol.filter(u => asignaciones?.find(a => a.usuarioId === u.id && a.ordenId));
            const sinAsig = operariosRol.filter(u => !asignaciones?.find(a => a.usuarioId === u.id && a.ordenId));
            return (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 4 }}>
                <div style={{ background: T.green + "12", border: "1px solid " + T.green + "33", borderRadius: 10, padding: "10px 12px", textAlign: "center" }}>
                  <p style={{ fontSize: 20, fontWeight: 900, color: T.green, fontFamily: T.mono }}>{asignados.length}</p>
                  <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, marginTop: 2 }}>ASIGNADOS</p>
                </div>
                <div style={{ background: (sinAsig.length > 0 ? T.amber : T.muted) + "12", border: "1px solid " + (sinAsig.length > 0 ? T.amber : T.muted) + "33", borderRadius: 10, padding: "10px 12px", textAlign: "center" }}>
                  <p style={{ fontSize: 20, fontWeight: 900, color: sinAsig.length > 0 ? T.amber : T.muted, fontFamily: T.mono }}>{sinAsig.length}</p>
                  <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, marginTop: 2 }}>SIN ASIGNAR</p>
                </div>
                <div style={{ background: T.cyan + "12", border: "1px solid " + T.cyan + "33", borderRadius: 10, padding: "10px 12px", textAlign: "center" }}>
                  <p style={{ fontSize: 20, fontWeight: 900, color: T.cyan, fontFamily: T.mono }}>{operariosRol.length}</p>
                  <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, marginTop: 2 }}>TOTAL ACTIVOS</p>
                </div>
              </div>
            );
          })()}

          {/* Tarjetas por operario */}
          {(usuarios || []).filter(u => u.rol === "OPERARIO").map(u => {
            const asig = asignaciones?.find(a => a.usuarioId === u.id);
            const orden = asig?.ordenId ? ordenes.find(o => o.id === asig.ordenId) : null;
            const tieneAsig = !!(asig?.ordenId);
            const secuenciaCompleta = orden?.secuencia?.map(s => s.operacion) || [];
            const opsAsignadas = asig?.operaciones || [];
            const faltantes = secuenciaCompleta.filter(op => !opsAsignadas.includes(op));

            return (
              <Glass key={u.id} style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12, borderColor: tieneAsig ? T.green + "33" : T.amber + "33" }}>
                {/* Cabecera operario */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: tieneAsig ? T.green : T.amber, flexShrink: 0 }} />
                    <div>
                      <p style={{ fontSize: 14, fontWeight: 900, color: T.text, fontFamily: T.font }}>{u.nombre}</p>
                      <p style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>{u.modulo || "Sin módulo"}</p>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    {tieneAsig && (
                      <button onClick={() => setAsignaciones(prev => prev.filter(a => a.usuarioId !== u.id))}
                        style={{ background: "transparent", border: "1px solid " + T.red + "66", color: T.red, fontFamily: T.mono, fontSize: 10, padding: "3px 8px", cursor: "pointer", borderRadius: 4 }}>
                        ✕ Limpiar
                      </button>
                    )}
                  </div>
                </div>

                {/* Selector de orden */}
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <label style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, letterSpacing: "0.08em" }}>ORDEN ASIGNADA</label>
                  <select value={asig?.ordenId || ""} onChange={e => {
                    setAsignaciones(prev => {
                      const sinEste = prev.filter(a => a.usuarioId !== u.id);
                      if (!e.target.value) return sinEste;
                      return [...sinEste, { usuarioId: u.id, ordenId: e.target.value, operaciones: [] }];
                    });
                  }} style={{ ...INP, color: tieneAsig ? T.text : T.muted }}>
                    <option value="">— Sin asignación —</option>
                    {ordenes.filter(o => o.estado !== "Completado").map(o => (
                      <option key={o.id} value={o.id}>{o.referencia} · {o.cliente}</option>
                    ))}
                  </select>
                </div>

                {/* Operaciones */}
                {orden && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {faltantes.length > 0 && (
                      <div style={{ background: T.amber + "12", border: "1px solid " + T.amber + "33", borderRadius: 6, padding: "6px 10px" }}>
                        <p style={{ fontSize: 9, color: T.amber, fontFamily: T.mono }}>⚠ Sin asignar: {faltantes.join(", ")}</p>
                      </div>
                    )}
                    {faltantes.length === 0 && secuenciaCompleta.length > 0 && (
                      <div style={{ background: T.green + "12", border: "1px solid " + T.green + "33", borderRadius: 6, padding: "6px 10px" }}>
                        <p style={{ fontSize: 9, color: T.green, fontFamily: T.mono }}>✓ Todas las operaciones asignadas</p>
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {orden.secuencia?.map(s => {
                        const seleccionada = asig?.operaciones?.includes(s.operacion);
                        return (
                          <button key={s.operacion} onClick={() => {
                            setAsignaciones(prev => prev.map(a => a.usuarioId !== u.id ? a : ({
                              ...a,
                              operaciones: seleccionada
                                ? a.operaciones.filter(op => op !== s.operacion)
                                : [...(a.operaciones || []), s.operacion],
                            })));
                          }} title={s.sam ? `SAM: ${s.sam} min` : ""}
                            style={{ padding: "4px 10px", background: seleccionada ? T.green + "20" : "rgba(255,255,255,0.03)", border: "1px solid " + (seleccionada ? T.green : T.border), borderRadius: 20, color: seleccionada ? T.green : T.muted, fontFamily: T.mono, fontSize: 10, cursor: "pointer" }}>
                            {s.operacion}
                            {s.sam ? <span style={{ opacity: 0.6, marginLeft: 4 }}>{s.sam}s</span> : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </Glass>
            );
          })}
        </div>
      )}

      {/* MENSAJES */}
      {tabLocal === "mensajes" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Glass style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ fontSize: 10, color: T.muted, fontFamily: T.mono, letterSpacing: "0.12em" }}>ENVIAR MENSAJE</p>
            <select value={msgForm.destino} onChange={e => setMsgForm(p => ({ ...p, destino: e.target.value }))} style={INP}>
              <option value="todos">Todos los operarios</option>
              <option value="modulo">Un módulo específico</option>
            </select>
            {msgForm.destino === "modulo" && (
              <select value={msgForm.moduloDest} onChange={e => setMsgForm(p => ({ ...p, moduloDest: e.target.value }))} style={INP}>
                {MODULOS.map(m => <option key={m}>{m}</option>)}
              </select>
            )}
            <textarea value={msgForm.texto} onChange={e => setMsgForm(p => ({ ...p, texto: e.target.value }))} placeholder="Escribe el mensaje..." rows={3}
              style={{ ...INP, resize: "none", outline: "none" }} />
            <button onClick={enviarMensaje} style={{ padding: "10px 0", background: msgForm.texto.trim() ? "#4499ff" : "rgba(255,255,255,0.05)", color: msgForm.texto.trim() ? "#fff" : T.muted, border: "none", fontFamily: T.mono, fontWeight: 900, fontSize: 12, cursor: msgForm.texto.trim() ? "pointer" : "default" }}>
              ENVIAR MENSAJE
            </button>
          </Glass>
          {mensajes.map(m => (
            <Glass key={m.id} style={{ padding: "12px 14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: T.text, fontFamily: T.font }}>{m.de}</p>
                <p style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>{m.ts}</p>
              </div>
              <p style={{ fontSize: 12, color: T.muted, fontFamily: T.font }}>{m.texto}</p>
              <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, marginTop: 4 }}>Para: {m.destino === "todos" ? "Todos" : m.moduloDest}</p>
            </Glass>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── EFICIENCIA ───────────────────────────────────────────────────────────────

const Eficiencia = ({ ordenes, operarios, registrosGlobales = [], usuarios = [] }) => {
  const [vistaTab, setVistaTab] = useState("ranking");

  const efPorUsuario = (uid) => {
    const regs = registrosGlobales.filter(r => r.usuarioId === uid && !r.esParada && r.tiempoReal !== null && r.sam !== null);
    if (!regs.length) return null;
    const prom = regs.reduce((a, r) => a + r.tiempoReal, 0) / regs.length;
    return regs[0].sam ? Math.round((regs[0].sam / prom) * 100) : null;
  };

  const stats = operarios.map(op => {
    const u = usuarios.find(u => u.nombre === op.nombre);
    const efReal = u ? efPorUsuario(u.id) : null;
    const ef = efReal !== null ? efReal : calcEficienciaOperario(op.id, ordenes);
    const udsHoy = u ? registrosGlobales.filter(r => r.usuarioId === u.id && !r.esParada).length : 0;
    return { ...op, ef, efReal: efReal !== null, udsHoy };
  });

  const horas = Array.from({ length: 10 }, (_, i) => i + 7);
  const tablaCalor = usuarios.filter(u => u.rol === "OPERARIO").map(u => {
    const regsU = registrosGlobales.filter(r => r.usuarioId === u.id && !r.esParada);
    const porHora = horas.map(h => regsU.filter(r => new Date(r.id).getHours() === h).length);
    const max = Math.max(...porHora, 1);
    return { nombre: u.nombre, porHora, max };
  });

  const rankColors = [T.yellow, "#aaaaaa", T.orange];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid " + T.faint }}>
        {[["ranking","▲ Ranking"],["calor","🌡 Calor por hora"]].map(([id, label]) => (
          <button key={id} onClick={() => setVistaTab(id)} style={{ padding: "8px 16px", fontSize: 12, fontWeight: 800, fontFamily: T.font, background: "transparent", color: vistaTab === id ? "#4499ff" : T.muted, border: "none", borderBottom: vistaTab === id ? "2px solid #4499ff" : "2px solid transparent", cursor: "pointer" }}>
            {label}
          </button>
        ))}
      </div>

      {vistaTab === "ranking" && (
        <Glass style={{ overflow: "hidden" }}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid " + T.border }}>
            <p style={{ fontSize: 10, color: T.yellow, fontFamily: T.mono, letterSpacing: "0.14em" }}>RANKING OPERARIOS — TURNO ACTUAL</p>
          </div>
          {[...stats].sort((a, b) => b.ef - a.ef).map((op, rank) => (
            <div key={op.id} style={{ padding: "10px 14px", borderBottom: "1px solid " + T.faint, display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 18, fontWeight: 900, fontFamily: T.mono, color: rankColors[rank] || T.muted, width: 22, textAlign: "center" }}>{rank + 1}</span>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: T.text, fontFamily: T.font }}>{op.nombre}</span>
                    {op.efReal && <span style={{ fontSize: 8, color: T.green, fontFamily: T.mono, background: "rgba(0,255,136,0.1)", padding: "1px 5px", borderRadius: 4 }}>REAL</span>}
                  </div>
                  <span style={{ fontSize: 14, fontFamily: T.mono, fontWeight: 900, color: op.ef > 0 ? efColor(op.ef) : T.muted }}>{op.ef > 0 ? op.ef + "%" : "—"}</span>
                </div>
                {op.ef > 0 && <ProgressBar value={op.ef} />}
                <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, marginTop: 3 }}>{op.udsHoy} uds hoy · {op.maquina}</p>
              </div>
            </div>
          ))}
        </Glass>
      )}

      {vistaTab === "calor" && (
        <Glass style={{ overflow: "hidden" }}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid " + T.border }}>
            <p style={{ fontSize: 10, color: "#4499ff", fontFamily: T.mono, letterSpacing: "0.14em" }}>PRODUCCIÓN POR HORA DEL DÍA</p>
          </div>
          {registrosGlobales.length === 0 ? (
            <p style={{ fontSize: 12, color: T.muted, fontFamily: T.mono, textAlign: "center", padding: 24 }}>Sin registros del turno actual</p>
          ) : (
            <div style={{ padding: 14, overflowX: "auto" }}>
              <div style={{ display: "grid", gridTemplateColumns: "80px repeat(10, 1fr)", gap: 3, marginBottom: 6 }}>
                <div />
                {horas.map(h => <div key={h} style={{ textAlign: "center", fontSize: 9, color: T.muted, fontFamily: T.mono }}>{h}h</div>)}
              </div>
              {tablaCalor.map(row => (
                <div key={row.nombre} style={{ display: "grid", gridTemplateColumns: "80px repeat(10, 1fr)", gap: 3, marginBottom: 3 }}>
                  <div style={{ fontSize: 10, color: T.text, fontFamily: T.font, fontWeight: 700, display: "flex", alignItems: "center" }}>{row.nombre.split(" ")[0]}</div>
                  {row.porHora.map((count, i) => {
                    const intensity = row.max > 0 ? count / row.max : 0;
                    const bg = count === 0 ? "rgba(255,255,255,0.03)" : intensity >= 0.8 ? T.green : intensity >= 0.5 ? T.yellow : T.red;
                    return (
                      <div key={i} style={{ height: 32, borderRadius: 4, background: bg, opacity: count === 0 ? 1 : 0.3 + intensity * 0.7, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {count > 0 && <span style={{ fontSize: 9, fontWeight: 900, color: "#000", fontFamily: T.mono }}>{count}</span>}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </Glass>
      )}
    </div>
  );
};

// ─── CONFIGURACIÓN DE HORARIOS ────────────────────────────────────────────────

const ConfigHorarios = ({ horarios, setHorarios, sesion }) => {
  const puedeEditar = sesion?.rol === "ADMIN" || sesion?.rol === "SUPERVISOR";
  const INP = { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", padding: "8px 10px", color: T.text, fontSize: 13, outline: "none", fontFamily: T.mono, borderRadius: 6, width: "100%" };

  const updMod = (modulo, key, subkey, value) => {
    setHorarios(prev => ({
      ...prev,
      modulos: {
        ...prev.modulos,
        [modulo]: {
          ...prev.modulos[modulo],
          [key]: subkey
            ? { ...prev.modulos[modulo][key], [subkey]: value }
            : value,
        },
      },
    }));
  };

  const finTurno = (modulo) => {
    const min = calcFinTurno(horarios, modulo);
    return String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <p style={{ fontSize: 10, color: T.muted, fontFamily: T.mono, letterSpacing: "0.14em" }}>CONFIGURACIÓN DE HORARIOS</p>

      {/* Turno general */}
      <Glass style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <p style={{ fontSize: 11, color: T.yellow, fontFamily: T.mono, letterSpacing: "0.12em" }}>TURNO GENERAL</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, marginBottom: 4 }}>INICIO TURNO</p>
            <input type="time" value={horarios.turno.inicio} disabled={!puedeEditar}
              onChange={e => setHorarios(prev => ({ ...prev, turno: { ...prev.turno, inicio: e.target.value } }))}
              style={INP} />
          </div>
          <div>
            <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, marginBottom: 4 }}>HORAS PRODUCTIVAS</p>
            <input type="number" value={horarios.turno.horasProductivas} min={1} max={12} step={0.1} disabled={!puedeEditar}
              onChange={e => setHorarios(prev => ({ ...prev, turno: { ...prev.turno, horasProductivas: parseFloat(e.target.value) || 8.8 } }))}
              style={INP} />
          </div>
        </div>
      </Glass>

      {/* Pausa activa */}
      <Glass style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <p style={{ fontSize: 11, color: T.cyan, fontFamily: T.mono, letterSpacing: "0.12em" }}>🧘 PAUSA ACTIVA — TODA LA PLANTA</p>
          <button onClick={() => setHorarios(prev => ({ ...prev, pausaActiva: { ...prev.pausaActiva, activa: !prev.pausaActiva.activa } }))}
            disabled={!puedeEditar}
            style={{ background: horarios.pausaActiva.activa ? T.green : "rgba(255,255,255,0.08)", border: "none", borderRadius: 20, width: 44, height: 24, cursor: "pointer", position: "relative" }}>
            <div style={{ width: 18, height: 18, background: "#fff", borderRadius: "50%", position: "absolute", top: 3, left: horarios.pausaActiva.activa ? 23 : 3, transition: "left 0.2s" }} />
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, marginBottom: 4 }}>HORA</p>
            <input type="time" value={horarios.pausaActiva.hora} disabled={!puedeEditar}
              onChange={e => setHorarios(prev => ({ ...prev, pausaActiva: { ...prev.pausaActiva, hora: e.target.value } }))}
              style={INP} />
          </div>
          <div>
            <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, marginBottom: 4 }}>DURACIÓN (min)</p>
            <input type="number" value={horarios.pausaActiva.duracion} min={1} max={30} disabled={!puedeEditar}
              onChange={e => setHorarios(prev => ({ ...prev, pausaActiva: { ...prev.pausaActiva, duracion: parseInt(e.target.value) || 5 } }))}
              style={INP} />
          </div>
        </div>
      </Glass>

      {/* Por módulo */}
      {Object.entries(horarios.modulos).map(([modulo, conf]) => (
        <Glass key={modulo} style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <p style={{ fontSize: 13, fontWeight: 900, color: T.green, fontFamily: T.font }}>{modulo}</p>
            <div style={{ textAlign: "right" }}>
              <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono }}>FIN DE TURNO</p>
              <p style={{ fontSize: 14, fontWeight: 900, color: T.yellow, fontFamily: T.mono }}>{finTurno(modulo)}</p>
            </div>
          </div>

          {/* Desayuno */}
          <div>
            <p style={{ fontSize: 9, color: "#ff9900", fontFamily: T.mono, letterSpacing: "0.12em", marginBottom: 6 }}>☕ DESAYUNO</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, marginBottom: 4 }}>HORA</p>
                <input type="time" value={conf.desayuno.hora} disabled={!puedeEditar}
                  onChange={e => updMod(modulo, "desayuno", "hora", e.target.value)}
                  style={INP} />
              </div>
              <div>
                <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, marginBottom: 4 }}>DURACIÓN (min)</p>
                <input type="number" value={conf.desayuno.duracion} min={5} max={60} disabled={!puedeEditar}
                  onChange={e => updMod(modulo, "desayuno", "duracion", parseInt(e.target.value) || 20)}
                  style={INP} />
              </div>
            </div>
          </div>

          {/* Almuerzo */}
          <div>
            <p style={{ fontSize: 9, color: "#ff9900", fontFamily: T.mono, letterSpacing: "0.12em", marginBottom: 6 }}>🍽 ALMUERZO</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, marginBottom: 4 }}>HORA</p>
                <input type="time" value={conf.almuerzo.hora} disabled={!puedeEditar}
                  onChange={e => updMod(modulo, "almuerzo", "hora", e.target.value)}
                  style={INP} />
              </div>
              <div>
                <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, marginBottom: 4 }}>DURACIÓN (min)</p>
                <input type="number" value={conf.almuerzo.duracion} min={5} max={60} disabled={!puedeEditar}
                  onChange={e => updMod(modulo, "almuerzo", "duracion", parseInt(e.target.value) || 20)}
                  style={INP} />
              </div>
            </div>
          </div>

          {/* Extras y días especiales */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            <div>
              <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, marginBottom: 4 }}>HORAS EXTRA</p>
              <select value={conf.horasExtra} disabled={!puedeEditar}
                onChange={e => updMod(modulo, "horasExtra", null, parseInt(e.target.value))}
                style={INP}>
                <option value={0}>0h</option>
                <option value={1}>1h</option>
                <option value={2}>2h</option>
              </select>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono }}>SÁBADO</p>
              <button onClick={() => puedeEditar && updMod(modulo, "turnoSabado", null, !conf.turnoSabado)}
                style={{ background: conf.turnoSabado ? "rgba(0,255,136,0.15)" : "rgba(255,255,255,0.04)", border: "1px solid " + (conf.turnoSabado ? T.green : T.border), borderRadius: 8, padding: "8px 0", color: conf.turnoSabado ? T.green : T.muted, fontFamily: T.mono, fontSize: 11, cursor: puedeEditar ? "pointer" : "default", fontWeight: 700 }}>
                {conf.turnoSabado ? "✓ ACTIVO" : "INACTIVO"}
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono }}>DOMINGO</p>
              <button onClick={() => puedeEditar && updMod(modulo, "turnoDomingo", null, !conf.turnoDomingo)}
                style={{ background: conf.turnoDomingo ? "rgba(0,255,136,0.15)" : "rgba(255,255,255,0.04)", border: "1px solid " + (conf.turnoDomingo ? T.green : T.border), borderRadius: 8, padding: "8px 0", color: conf.turnoDomingo ? T.green : T.muted, fontFamily: T.mono, fontSize: 11, cursor: puedeEditar ? "pointer" : "default", fontWeight: 700 }}>
                {conf.turnoDomingo ? "✓ ACTIVO" : "INACTIVO"}
              </button>
            </div>
          </div>
        </Glass>
      ))}
    </div>
  );
};

// ─── ADMIN HOME ───────────────────────────────────────────────────────────────

const AdminHome = ({ setTab, ordenes, operarios, usuarios, registrosGlobales, logActividad, sesion }) => {
  const enProceso = ordenes.filter(o => o.estado === "En proceso").length;
  const activos = operarios.filter(o => o.activo).length;
  const usuariosActivos = usuarios.filter(u => u.activo).length;
  const prodHoy = registrosGlobales.filter(r => !r.esParada && !r.esDefecto).length;
  const paradasHoy = registrosGlobales.filter(r => r.esParada).length;
  const efGeneral = (() => {
    const regs = registrosGlobales.filter(r => !r.esParada && !r.esDefecto && r.tiempoReal !== null && r.sam !== null);
    if (!regs.length) return null;
    const prom = regs.reduce((a, r) => a + r.tiempoReal, 0) / regs.length;
    const sam = regs[0].sam;
    return sam ? Math.round((sam / prom) * 100) : null;
  })();

  const esAdmin = sesion?.rol === "ADMIN";
  const permisos = ROLES[sesion?.rol]?.permisos || [];

  const CARDS_ALL = [
    { id: "dashboard",  icon: <LayoutDashboard size={28} color={T.yellow} strokeWidth={1.5} />, label: "Dashboard",  color: T.yellow,  kpi: efGeneral ? efGeneral + "% ef." : "Sin datos", sub: "Eficiencia general" },
    { id: "ordenes",    icon: <ClipboardList   size={28} color={T.cyan}   strokeWidth={1.5} />, label: "Ordenes",    color: T.cyan,    kpi: enProceso,                                      sub: "En proceso" },
    { id: "catalogo",   icon: <FolderOpen      size={28} color={T.blue}   strokeWidth={1.5} />, label: "Catalogo",   color: T.blue,    kpi: ordenes.length,                                 sub: "Referencias activas" },
    { id: "operarios",  icon: <Users           size={28} color={T.green}  strokeWidth={1.5} />, label: "Operarios",  color: T.green,   kpi: activos,                                        sub: "Activos en planta" },
    { id: "eficiencia", icon: <TrendingUp      size={28} color={T.orange} strokeWidth={1.5} />, label: "Eficiencia", color: T.orange,  kpi: prodHoy,                                        sub: "Uds producidas hoy" },
    { id: "horarios",   icon: <Clock           size={28} color={T.purple} strokeWidth={1.5} />, label: "Horarios",   color: T.purple,  kpi: "5 modulos",                                    sub: "Configurados" },
    { id: "reporte",    icon: <ClipboardList   size={28} color={T.cyan}   strokeWidth={1.5} />, label: "Reporte",    color: T.cyan,    kpi: "Hoy",                                          sub: "Reporte del dia" },
    { id: "usuarios",   icon: <KeyRound        size={28} color={T.yellow} strokeWidth={1.5} />, label: "Usuarios",   color: T.yellow,  kpi: usuariosActivos,                                sub: "Usuarios activos" },
    { id: "log",        icon: <Shield          size={28} color={T.muted}  strokeWidth={1.5} />, label: "Log",        color: T.muted,   kpi: logActividad.length,                            sub: "Eventos registrados" },
  ];

  const CARDS = CARDS_ALL.filter(c => permisos.includes(c.id));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <p style={{ fontSize: 22, fontWeight: 900, color: T.text, fontFamily: T.font }}>Panel de Administración</p>
        <p style={{ fontSize: 11, color: T.muted, fontFamily: T.mono }}>{new Date().toLocaleDateString("es-CO", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
      </div>

      {/* KPIs rápidos */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        {[
          { label: "Producción hoy", value: prodHoy, color: T.green },
          { label: "Paradas hoy",    value: paradasHoy, color: paradasHoy > 0 ? T.red : T.muted },
          { label: "Eficiencia",     value: efGeneral ? efGeneral + "%" : "—", color: efGeneral ? efColor(efGeneral) : T.muted },
        ].map(k => (
          <div key={k.label} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid " + T.border, borderRadius: 12, padding: "10px 12px", textAlign: "center" }}>
            <p style={{ fontSize: 22, fontWeight: 900, color: k.color, fontFamily: T.mono, lineHeight: 1 }}>{k.value}</p>
            <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, marginTop: 3 }}>{k.label.toUpperCase()}</p>
          </div>
        ))}
      </div>

      {/* Tarjetas de módulos */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {CARDS.map(c => (
          <button key={c.id} onClick={() => setTab(c.id)}
            style={{ background: "rgba(255,255,255,0.04)", backdropFilter: "blur(20px)", border: "1px solid " + c.color + "33", borderRadius: 14, padding: "16px 14px", cursor: "pointer", textAlign: "left", display: "flex", flexDirection: "column", gap: 8, transition: "all 0.2s" }}
            onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.08)"}
            onMouseLeave={e => e.currentTarget.style.background = "rgba(255,255,255,0.04)"}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ background: "rgba(255,255,255,0.06)", border: "1px solid " + c.color + "44", borderRadius: 10, padding: 8 }}>
                {c.icon}
              </div>
              <div style={{ textAlign: "right" }}>
                <p style={{ fontSize: 18, fontWeight: 900, color: c.color, fontFamily: T.mono, lineHeight: 1 }}>{c.kpi}</p>
                <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono }}>{c.sub}</p>
              </div>
            </div>
            <div>
              <p style={{ fontSize: 15, fontWeight: 900, color: c.color, fontFamily: T.font, lineHeight: 1 }}>{c.label}</p>
              <div style={{ height: 2, background: c.color, marginTop: 6, width: "30%", borderRadius: 2 }} />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

// ─── HOME DIRECTOR DE PRODUCCIÓN ─────────────────────────────────────────────

const HomeDirector = ({ setTab, ordenes, usuarios, registrosGlobales }) => {
  const enProceso = ordenes.filter(o => o.estado === "En proceso").length;
  const pendientes = ordenes.filter(o => o.estado === "Pendiente").length;
  const activos = (usuarios || []).filter(u => u.rol === "OPERARIO" && u.activo).length;
  const prodHoy = registrosGlobales.filter(r => !r.esParada && !r.esDefecto).length;

  const CARDS = [
    { id: "pipeline",   icon: <GitBranch  size={26} color={T.orange} strokeWidth={1.5} />, label: "Pipeline",    color: T.orange, kpi: enProceso + pendientes, sub: "Órdenes activas"     },
    { id: "pedidos",    icon: <ShoppingCart size={26} color={T.purple} strokeWidth={1.5} />, label: "Pedidos",     color: T.purple,   kpi: "—",                    sub: "Órdenes de clientes" },
    { id: "ordenes",    icon: <ClipboardList size={26} color={T.cyan} strokeWidth={1.5} />, label: "Producción", color: T.cyan,   kpi: enProceso,              sub: "En proceso"          },
    { id: "inventario", icon: <Package    size={26} color={T.blue}   strokeWidth={1.5} />, label: "Compras",     color: T.blue,   kpi: "—",                    sub: "Materiales e insumos"},
    { id: "corte",      icon: <Scissors   size={26} color={T.amber}  strokeWidth={1.5} />, label: "Corte",       color: T.amber,  kpi: "—",                    sub: "Órdenes de corte"    },
    { id: "eficiencia", icon: <TrendingUp size={26} color={T.green}  strokeWidth={1.5} />, label: "Eficiencia",  color: T.green,  kpi: prodHoy,                sub: "Uds producidas hoy"  },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <p style={{ fontSize: 22, fontWeight: 900, color: T.text, fontFamily: T.font }}>Director de Producción</p>
        <p style={{ fontSize: 11, color: T.muted, fontFamily: T.mono }}>{new Date().toLocaleDateString("es-CO", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        {[
          { label: "En proceso",       value: enProceso, color: T.cyan   },
          { label: "Pendientes",       value: pendientes, color: T.yellow },
          { label: "Operarios activos", value: activos,  color: T.green  },
        ].map(k => (
          <div key={k.label} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid " + T.border, borderRadius: 12, padding: "10px 12px", textAlign: "center" }}>
            <p style={{ fontSize: 22, fontWeight: 900, color: k.color, fontFamily: T.mono, lineHeight: 1 }}>{k.value}</p>
            <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, marginTop: 3 }}>{k.label.toUpperCase()}</p>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {CARDS.map(c => (
          <button key={c.id} onClick={() => setTab(c.id)}
            style={{ background: "rgba(255,255,255,0.04)", backdropFilter: "blur(20px)", border: "1px solid " + c.color + "33", borderRadius: 14, padding: "16px 14px", cursor: "pointer", textAlign: "left", display: "flex", flexDirection: "column", gap: 8, transition: "all 0.2s" }}
            onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.08)"}
            onMouseLeave={e => e.currentTarget.style.background = "rgba(255,255,255,0.04)"}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              {c.icon}
              <span style={{ fontSize: 20, fontWeight: 900, color: c.color, fontFamily: T.mono }}>{c.kpi}</span>
            </div>
            <div>
              <p style={{ fontSize: 13, fontWeight: 800, color: T.text }}>{c.label}</p>
              <p style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>{c.sub}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

// ─── HOME COMERCIAL ───────────────────────────────────────────────────────────

const HomeComercial = ({ setTab }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
    <div>
      <p style={{ fontSize: 22, fontWeight: 900, color: T.text, fontFamily: T.font }}>Área Comercial</p>
      <p style={{ fontSize: 11, color: T.muted, fontFamily: T.mono }}>{new Date().toLocaleDateString("es-CO", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
    </div>
    <button onClick={() => setTab("pedidos")}
      style={{ background: "rgba(204,0,255,0.08)", border: "1px solid rgba(204,0,255,0.3)", borderRadius: 14, padding: 20, cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 16, transition: "all 0.2s" }}
      onMouseEnter={e => e.currentTarget.style.background = "rgba(204,0,255,0.15)"}
      onMouseLeave={e => e.currentTarget.style.background = "rgba(204,0,255,0.08)"}>
      <ShoppingCart size={36} color={T.purple} strokeWidth={1.5} />
      <div>
        <p style={{ fontSize: 16, fontWeight: 900, color: T.text }}>Órdenes de Pedido</p>
        <p style={{ fontSize: 11, color: T.muted, fontFamily: T.mono }}>Gestiona los pedidos de clientes</p>
      </div>
    </button>
  </div>
);

// ─── HOME JEFE DE COMPRAS ─────────────────────────────────────────────────────

const HomeJefeCompras = ({ setTab }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
    <div>
      <p style={{ fontSize: 22, fontWeight: 900, color: T.text, fontFamily: T.font }}>Jefe de Compras</p>
      <p style={{ fontSize: 11, color: T.muted, fontFamily: T.mono }}>{new Date().toLocaleDateString("es-CO", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
    </div>
    <button onClick={() => setTab("inventario")}
      style={{ background: "rgba(0,238,255,0.08)", border: "1px solid rgba(0,238,255,0.3)", borderRadius: 14, padding: 20, cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 16, transition: "all 0.2s" }}
      onMouseEnter={e => e.currentTarget.style.background = "rgba(0,238,255,0.15)"}
      onMouseLeave={e => e.currentTarget.style.background = "rgba(0,238,255,0.08)"}>
      <Package size={36} color={T.cyan} strokeWidth={1.5} />
      <div>
        <p style={{ fontSize: 16, fontWeight: 900, color: T.text }}>Inventario y Compras</p>
        <p style={{ fontSize: 11, color: T.muted, fontFamily: T.mono }}>Gestiona materiales, telas e insumos</p>
      </div>
    </button>
  </div>
);

// ─── HOME JEFE DE CORTE ───────────────────────────────────────────────────────

const HomeJefeCorte = ({ setTab }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
    <div>
      <p style={{ fontSize: 22, fontWeight: 900, color: T.text, fontFamily: T.font }}>Jefe de Corte</p>
      <p style={{ fontSize: 11, color: T.muted, fontFamily: T.mono }}>{new Date().toLocaleDateString("es-CO", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
    </div>
    <button onClick={() => setTab("corte")}
      style={{ background: "rgba(255,170,0,0.08)", border: "1px solid rgba(255,170,0,0.3)", borderRadius: 14, padding: 20, cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 16, transition: "all 0.2s" }}
      onMouseEnter={e => e.currentTarget.style.background = "rgba(255,170,0,0.15)"}
      onMouseLeave={e => e.currentTarget.style.background = "rgba(255,170,0,0.08)"}>
      <Scissors size={36} color={T.amber} strokeWidth={1.5} />
      <div>
        <p style={{ fontSize: 16, fontWeight: 900, color: T.text }}>Módulo de Corte</p>
        <p style={{ fontSize: 11, color: T.muted, fontFamily: T.mono }}>Gestiona órdenes de corte internas y externas</p>
      </div>
    </button>
  </div>
);

// ─── HOME SUPERVISOR ─────────────────────────────────────────────────────────

const HomeSupervisor = ({ setTab, ordenes, operarios, usuarios, registrosGlobales, asignaciones }) => {
  const operariosActivos = (usuarios || []).filter(u => u.rol === "OPERARIO" && u.activo);
  const sinAsig = operariosActivos.filter(u => !(asignaciones || []).find(a => a.usuarioId === u.id && a.ordenId));
  const paradasActivas = (registrosGlobales || []).filter(r => r.esParada && r.activa);
  const unidadesHoy = (registrosGlobales || []).filter(r => !r.esParada && !r.esDefecto).length;
  const ordenesEnProceso = (ordenes || []).filter(o => o.estado === "En proceso");

  const efGeneral = (() => {
    const regs = (registrosGlobales || []).filter(r => !r.esParada && !r.esDefecto && r.tiempoReal > 0 && r.sam > 0);
    if (!regs.length) return null;
    return Math.round(regs.reduce((a, r) => a + (r.sam / r.tiempoReal * 100), 0) / regs.length);
  })();

  const ordenesSinCobertura = ordenesEnProceso.filter(o => {
    const todasOps = (o.secuencia || []).map(s => s.operacion);
    const asignadasTotal = (asignaciones || []).filter(a => a.ordenId === o.id).flatMap(a => a.operaciones || []);
    return todasOps.some(op => !asignadasTotal.includes(op));
  });

  const alertas = [
    sinAsig.length > 0 && { tipo: "operarios", msg: `${sinAsig.length} operario${sinAsig.length > 1 ? "s" : ""} sin asignación`, color: T.amber, nombres: sinAsig.map(u => u.nombre) },
    paradasActivas.length > 0 && { tipo: "paradas", msg: `${paradasActivas.length} parada${paradasActivas.length > 1 ? "s" : ""} activa${paradasActivas.length > 1 ? "s" : ""} en este momento`, color: "#ff4444", nombres: [...new Set(paradasActivas.map(r => r.nombre))] },
    ordenesSinCobertura.length > 0 && { tipo: "cobertura", msg: `${ordenesSinCobertura.length} orden${ordenesSinCobertura.length > 1 ? "es" : ""} con operaciones sin asignar`, color: T.amber, nombres: ordenesSinCobertura.map(o => o.referencia) },
    efGeneral !== null && efGeneral < 80 && { tipo: "eficiencia", msg: `Eficiencia general por debajo del objetivo: ${efGeneral}%`, color: "#ff4444" },
  ].filter(Boolean);

  const CARDS = [
    { id: "operarios",  label: "Piso en vivo",   sub: "Operarios, asignaciones y mensajes", color: T.blue,   icon: <Users        size={26} color={T.blue}   strokeWidth={1.5} /> },
    { id: "eficiencia", label: "Eficiencia",      sub: "Métricas del turno por operario",    color: T.green,  icon: <TrendingUp   size={26} color={T.green}  strokeWidth={1.5} /> },
    { id: "ordenes",    label: "Órdenes",          sub: "Estado de producción activa",        color: T.cyan,   icon: <ClipboardList size={26} color={T.cyan}  strokeWidth={1.5} /> },
    { id: "horarios",   label: "Horarios",         sub: "Configuración del turno",            color: T.purple, icon: <Clock        size={26} color={T.purple} strokeWidth={1.5} /> },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <p style={{ fontSize: 22, fontWeight: 900, color: T.text, fontFamily: T.font }}>Supervisor de Piso</p>
        <p style={{ fontSize: 11, color: T.muted, fontFamily: T.mono }}>{new Date().toLocaleDateString("es-CO", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 8 }}>
        {[
          { label: "Activos",        value: operariosActivos.length,                       color: T.green },
          { label: "Sin asignación", value: sinAsig.length,                                color: sinAsig.length > 0 ? T.amber : T.muted },
          { label: "Paradas ahora",  value: paradasActivas.length,                         color: paradasActivas.length > 0 ? "#ff4444" : T.muted },
          { label: "Uds del turno",  value: unidadesHoy,                                   color: T.cyan },
          { label: "Eficiencia",     value: efGeneral !== null ? efGeneral + "%" : "—",    color: efGeneral !== null ? efColor(efGeneral) : T.muted },
        ].map(k => (
          <div key={k.label} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid " + T.border, borderRadius: 12, padding: "10px 8px", textAlign: "center" }}>
            <p style={{ fontSize: 20, fontWeight: 900, color: k.color, fontFamily: T.mono, lineHeight: 1 }}>{k.value}</p>
            <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, marginTop: 3 }}>{k.label.toUpperCase()}</p>
          </div>
        ))}
      </div>

      {/* Alertas */}
      {alertas.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {alertas.map((a, i) => (
            <div key={i} style={{ background: a.color + "12", border: "1px solid " + a.color + "44", borderRadius: 10, padding: "10px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: a.color, flexShrink: 0 }} />
                <p style={{ fontSize: 12, fontWeight: 700, color: a.color, flex: 1 }}>{a.msg}</p>
                <button onClick={() => setTab(a.tipo === "eficiencia" ? "eficiencia" : "operarios")}
                  style={{ background: a.color + "22", border: "1px solid " + a.color + "55", borderRadius: 5, padding: "2px 10px", color: a.color, cursor: "pointer", fontSize: 10, fontFamily: T.mono }}>
                  Ver →
                </button>
              </div>
              {a.nombres?.length > 0 && (
                <p style={{ fontSize: 11, color: T.muted, paddingLeft: 14, marginTop: 4 }}>{a.nombres.join(" · ")}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Órdenes en proceso */}
      {ordenesEnProceso.length > 0 && (
        <div>
          <p style={{ fontSize: 10, color: T.muted, fontFamily: T.mono, letterSpacing: "0.1em", marginBottom: 8 }}>ÓRDENES EN PROCESO ({ordenesEnProceso.length})</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {ordenesEnProceso.map(o => {
              const pct = o.cantidadTotal ? Math.round(o.cantidadProducida / o.cantidadTotal * 100) : 0;
              const dias = o.fechaEntrega ? Math.ceil((new Date(o.fechaEntrega + "T12:00:00") - new Date()) / 86400000) : null;
              const sinCob = ordenesSinCobertura.some(x => x.id === o.id);
              return (
                <Glass key={o.id} style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8, cursor: "pointer", borderColor: sinCob ? T.amber + "44" : T.border }} onClick={() => setTab("ordenes")}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <p style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{o.referencia}</p>
                        {sinCob && <span style={{ fontSize: 9, fontFamily: T.mono, color: T.amber, background: T.amber + "20", border: "1px solid " + T.amber + "44", borderRadius: 4, padding: "1px 5px" }}>OPS PENDIENTES</span>}
                      </div>
                      <p style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>{o.cliente}</p>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <p style={{ fontSize: 13, fontWeight: 700, color: T.cyan, fontFamily: T.mono }}>{o.cantidadProducida}/{o.cantidadTotal} uds</p>
                      {dias !== null && (
                        <p style={{ fontSize: 10, color: dias < 0 ? "#ff4444" : dias < 3 ? T.amber : T.muted, fontFamily: T.mono, marginTop: 2 }}>
                          {dias < 0 ? `${Math.abs(dias)}d vencida` : dias === 0 ? "vence hoy" : `${dias}d restantes`}
                        </p>
                      )}
                    </div>
                  </div>
                  <ProgressBar value={pct} />
                  <p style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>{pct}% completado</p>
                </Glass>
              );
            })}
          </div>
        </div>
      )}

      {/* Accesos rápidos */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {CARDS.map(c => (
          <button key={c.id} onClick={() => setTab(c.id)}
            style={{ background: "rgba(255,255,255,0.04)", backdropFilter: "blur(20px)", border: "1px solid " + c.color + "33", borderRadius: 14, padding: "16px 14px", cursor: "pointer", textAlign: "left", display: "flex", flexDirection: "column", gap: 8, transition: "all 0.2s" }}
            onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.08)"}
            onMouseLeave={e => e.currentTarget.style.background = "rgba(255,255,255,0.04)"}>
            <div style={{ background: "rgba(255,255,255,0.06)", border: "1px solid " + c.color + "44", borderRadius: 10, padding: 8, width: "fit-content" }}>
              {c.icon}
            </div>
            <div>
              <p style={{ fontSize: 15, fontWeight: 900, color: c.color, fontFamily: T.font, lineHeight: 1 }}>{c.label}</p>
              <p style={{ fontSize: 10, color: T.muted, marginTop: 4 }}>{c.sub}</p>
              <div style={{ height: 2, background: c.color, marginTop: 6, width: "30%", borderRadius: 2 }} />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

// ─── GESTIÓN DE PEDIDOS (Fase 3) ──────────────────────────────────────────────

const PEDS_PRIORIDADES  = ["Alta", "Media", "Baja"];
const PEDS_ESTADOS      = ["Borrador", "Confirmado", "En producción", "Entregado"];
const PEDS_CONDICIONES  = ["Contado", "Crédito 30", "Crédito 60", "Crédito 90"];
const PEDS_PCOLOR       = { Alta: "#ff4444", Media: "#ffaa00", Baja: "#00ff88" };
const PEDS_ECOLOR       = { Borrador: "#888", Confirmado: "#00eeff", "En producción": "#00ff88", Entregado: "#cc00ff" };
const FORM_PED_INIT     = { id: null, numeroPedido: "", tipo: "Producción", cliente: "", contacto: "", telefono: "", numeroOC: "", direccionEntrega: "", ciudad: "", transportadora: "", condicionesPago: "Contado", anticipoMonto: 0, anticipoEstado: "Pendiente", fechaEntrega: "", fechaInicioRequerida: "", prioridad: "Media", estado: "Borrador", referencias: [], notas: "", fechaCreacion: "", creadoPor: "", ordenProduccionId: null, historial: [] };
const REF_DEV_INIT      = { nombre: "", descripcion: "", tallasActivas: [], tallasQty: {}, precioUnitario: 0, descuento: 0, colores: "", notasRef: "" };

const GestionPedidos = ({ pedidos, setPedidos, catalogo, sesion, ordenes = [], setOrdenes }) => {
  const [vista, setVista]           = useState("lista");
  const [form, setForm]             = useState(FORM_PED_INIT);
  const [modoNuevo, setModoNuevo]   = useState(false);
  const [showAddRef, setShowAddRef] = useState(false);
  const [searchCat, setSearchCat]   = useState("");
  const [confirmDel, setConfirmDel] = useState(null);
  const [ordenesCreadas, setOrdenesCreadas] = useState([]);
  const [error, setError] = useState("");
  const [showAddRefDev, setShowAddRefDev] = useState(false);
  const [refDevForm, setRefDevForm] = useState(REF_DEV_INIT);

  const esComercial = ["COMERCIAL", "ADMIN"].includes(sesion?.rol);
  const esDirector  = ["DIRECTOR_PRODUCCION", "ADMIN"].includes(sesion?.rol);
  const puedeEditar = (modoNuevo || form.estado === "Borrador") && esComercial;

  const ordenesDelPedido = ordenes.filter(o => o.pedidoId === form.id);
  const yaGenerado = ordenesDelPedido.length > 0;

  const generarNumeroPedido = () => {
    const year = new Date().getFullYear();
    const nums = pedidos
      .map(p => p.numeroPedido)
      .filter(n => n && n.startsWith(`PED-${year}-`))
      .map(n => parseInt(n.split("-")[2]) || 0);
    const next = nums.length ? Math.max(...nums) + 1 : 1;
    return `PED-${year}-${String(next).padStart(3, "0")}`;
  };

  const confirmarPedido = () => {
    if (!form.fechaEntrega) { setError("Define la fecha de entrega antes de confirmar."); return; }
    if (!form.referencias.some(r => Object.values(r.tallas).some(q => q > 0))) { setError("Agrega al menos una referencia con cantidades."); return; }
    setError("");
    const entrada = { fecha: new Date().toISOString(), estado: "Confirmado", usuario: sesion?.nombre || "" };
    const updated = { ...form, estado: "Confirmado", historial: [...(form.historial || []), entrada] };
    setForm(updated);
    setPedidos(prev => prev.map(p => p.id === form.id ? updated : p));
  };

  const marcarEntregado = () => {
    const entrada = { fecha: new Date().toISOString(), estado: "Entregado", usuario: sesion?.nombre || "" };
    const updated = { ...form, estado: "Entregado", historial: [...(form.historial || []), entrada] };
    setForm(updated);
    setPedidos(prev => prev.map(p => p.id === form.id ? updated : p));
  };

  const generarOrdenes = () => {
    if (!form.id || form.referencias.length === 0) return;
    const nuevas = form.referencias
      .filter(ref => Object.values(ref.tallas).some(q => q > 0))
      .map(ref => {
        const catItem = (catalogo || []).find(c => c.id === ref.catalogoId);
        const tallasArr = Object.entries(ref.tallas)
          .filter(([, q]) => q > 0)
          .map(([talla, cantidad]) => ({ talla, cantidad, completadasPorOp: {} }));
        const cantidadTotal = tallasArr.reduce((a, t) => a + t.cantidad, 0);
        return {
          id: crypto.randomUUID(),
          referencia: ref.nombre,
          descripcion: ref.descripcion || "",
          cliente: form.cliente,
          fechaEntrega: form.fechaEntrega,
          cantidadTotal,
          cantidadProducida: 0,
          estado: "Pendiente",
          prioridad: form.prioridad,
          tallas: tallasArr,
          secuencia: (catItem?.operaciones || []).map(op => ({
            operacion: op.operacion,
            tiempo: op.sam || 0,
            operario: null,
            piezas: cantidadTotal,
            completadas: 0,
            estado: "Pendiente",
          })),
          pedidoId: form.id,
        };
      });
    if (!nuevas.length) return;
    setOrdenes(prev => [...nuevas, ...prev]);
    const entradaHist = { fecha: new Date().toISOString(), estado: "En producción", usuario: sesion?.nombre || "" };
    const updatedForm = { ...form, estado: "En producción", ordenProduccionId: nuevas[0].id, historial: [...(form.historial || []), entradaHist] };
    setForm(updatedForm);
    setPedidos(prev => prev.map(p => p.id === form.id ? updatedForm : p));
    setOrdenesCreadas(nuevas.map(o => o.referencia));
  };

  const catLiberado = (catalogo || []).filter(c => c.estado === "Liberada");
  const catFiltrado = catLiberado.filter(c =>
    c.nombre.toLowerCase().includes(searchCat.toLowerCase()) ||
    (c.descripcion || "").toLowerCase().includes(searchCat.toLowerCase())
  );

  const totalRef = (ref) => Object.values(ref.tallas || {}).reduce((a, b) => a + (b || 0), 0);
  const totalPed = (p)   => (p.referencias || []).reduce((a, r) => a + totalRef(r), 0);

  const totalPorTalla = () => {
    const tot = {};
    form.referencias.forEach(ref => {
      Object.entries(ref.tallas || {}).forEach(([t, q]) => { tot[t] = (tot[t] || 0) + (q || 0); });
    });
    return tot;
  };

  const subtotalRef = (ref) => totalRef(ref) * (ref.precioUnitario || 0) * (1 - (ref.descuento || 0) / 100);

  const valorTotalPedido = () => form.referencias.reduce((acc, ref) => acc + subtotalRef(ref), 0);

  const calcularEstimado = () => {
    let totalMin = 0;
    form.referencias.forEach(ref => {
      if (!ref.catalogoId) return;
      const cat = (catalogo || []).find(c => c.id === ref.catalogoId);
      if (!cat) return;
      const samRef = (cat.operaciones || []).reduce((a, op) => a + (parseFloat(op.sam) || 0), 0);
      totalMin += samRef * totalRef(ref);
    });
    if (totalMin === 0) return null;
    return { minutos: Math.round(totalMin), dias: Math.ceil(totalMin / 480) };
  };

  const aplicarFechaInicio = () => {
    const est = calcularEstimado();
    if (!est || !form.fechaEntrega) return;
    const d = new Date(form.fechaEntrega + "T12:00:00");
    d.setDate(d.getDate() - est.dias);
    setForm(f => ({ ...f, fechaInicioRequerida: d.toISOString().split("T")[0] }));
  };

  const abrirNuevo = () => {
    setError("");
    setOrdenesCreadas([]);
    setForm({ ...FORM_PED_INIT, id: crypto.randomUUID(), numeroPedido: generarNumeroPedido(), fechaCreacion: new Date().toISOString().split("T")[0], creadoPor: sesion?.nombre || "", historial: [{ fecha: new Date().toISOString(), estado: "Borrador", usuario: sesion?.nombre || "" }] });
    setModoNuevo(true);
    setVista("form");
  };

  const abrirEditar = (p) => {
    setError("");
    setOrdenesCreadas([]);
    setForm({ ...p });
    setModoNuevo(false);
    setVista("form");
  };

  const guardar = () => {
    if (!form.cliente.trim()) { setError("El nombre del cliente es obligatorio."); return; }
    setError("");
    setPedidos(prev => {
      const existe = prev.find(p => p.id === form.id);
      return existe ? prev.map(p => p.id === form.id ? { ...form } : p) : [{ ...form }, ...prev];
    });
    if (modoNuevo) {
      setModoNuevo(false);
    } else {
      setVista("lista");
    }
  };

  const eliminar = async (id) => {
    await supabase.from("pedidos").delete().eq("id", id);
    setPedidos(prev => prev.filter(p => p.id !== id));
    setConfirmDel(null);
  };

  const agregarRef = (cat) => {
    const tallasMap = {};
    (cat.tallas || []).forEach(t => { tallasMap[t] = 0; });
    setForm(f => ({ ...f, referencias: [...f.referencias, { catalogoId: cat.id, nombre: cat.nombre, descripcion: cat.descripcion || "", tallas: tallasMap, precioUnitario: 0, descuento: 0, colores: "", notasRef: "" }] }));
    setShowAddRef(false);
    setSearchCat("");
  };

  const confirmarRefDev = () => {
    if (!refDevForm.nombre.trim()) return;
    if (refDevForm.tallasActivas.length === 0) return;
    const tallasMap = {};
    refDevForm.tallasActivas.forEach(t => { tallasMap[t] = refDevForm.tallasQty[t] || 0; });
    setForm(f => ({ ...f, referencias: [...f.referencias, { catalogoId: null, nombre: refDevForm.nombre.trim(), descripcion: refDevForm.descripcion.trim(), tallas: tallasMap, precioUnitario: refDevForm.precioUnitario, descuento: refDevForm.descuento, colores: refDevForm.colores, notasRef: refDevForm.notasRef }] }));
    setRefDevForm(REF_DEV_INIT);
    setShowAddRefDev(false);
  };

  const toggleTallasDev = (talla) => {
    setRefDevForm(f => {
      const activas = f.tallasActivas.includes(talla)
        ? f.tallasActivas.filter(t => t !== talla)
        : [...f.tallasActivas, talla];
      return { ...f, tallasActivas: activas };
    });
  };

  const quitarRef = (idx) => setForm(f => ({ ...f, referencias: f.referencias.filter((_, i) => i !== idx) }));

  const setTallaQty = (refIdx, talla, val) => {
    setForm(f => {
      const refs = [...f.referencias];
      refs[refIdx] = { ...refs[refIdx], tallas: { ...refs[refIdx].tallas, [talla]: parseInt(val) || 0 } };
      return { ...f, referencias: refs };
    });
  };

  const setRefField = (refIdx, field, val) => {
    setForm(f => {
      const refs = [...f.referencias];
      refs[refIdx] = { ...refs[refIdx], [field]: val };
      return { ...f, referencias: refs };
    });
  };

  const inp = (extra = {}) => ({ background: T.bg, border: "1px solid " + T.border, borderRadius: 6, padding: "6px 10px", color: T.text, fontSize: 13, boxSizing: "border-box", width: "100%", ...extra });

  // ── FORMULARIO / DETALLE ──
  if (vista === "form") {
    const totTalla  = totalPorTalla();
    const totalUds  = Object.values(totTalla).reduce((a, b) => a + b, 0);
    const valTotal  = valorTotalPedido();
    const tienePrecios = form.referencias.some(r => (r.precioUnitario || 0) > 0);

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

        {/* Cabecera */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={() => setVista("lista")} style={{ background: "none", border: "none", color: T.cyan, cursor: "pointer", fontSize: 13 }}>← Volver</button>
            <p style={{ fontSize: 10, color: T.muted, fontFamily: T.mono, letterSpacing: "0.14em" }}>
              {modoNuevo ? "NUEVO PEDIDO" : (form.numeroPedido || `PEDIDO · ${form.cliente.toUpperCase()}`)}
            </p>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <Badge style={{ background: (PEDS_PCOLOR[form.prioridad] || T.muted) + "22", color: PEDS_PCOLOR[form.prioridad] || T.muted, border: "1px solid " + (PEDS_PCOLOR[form.prioridad] || T.muted) + "55" }}>{form.prioridad}</Badge>
            <Badge style={{ background: (PEDS_ECOLOR[form.estado] || T.muted) + "22", color: PEDS_ECOLOR[form.estado] || T.muted, border: "1px solid " + (PEDS_ECOLOR[form.estado] || T.muted) + "55" }}>{form.estado}</Badge>
          </div>
        </div>

        {/* Datos del cliente */}
        <Glass style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          <p style={{ fontSize: 10, color: T.muted, fontFamily: T.mono, letterSpacing: "0.1em" }}>DATOS DEL CLIENTE</p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 200px", display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>CLIENTE *</label>
              <input value={form.cliente} readOnly={!puedeEditar} onChange={e => setForm(f => ({ ...f, cliente: e.target.value }))} style={inp()} />
            </div>
            <div style={{ flex: "1 1 160px", display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>CONTACTO</label>
              <input value={form.contacto} readOnly={!puedeEditar} onChange={e => setForm(f => ({ ...f, contacto: e.target.value }))} style={inp()} />
            </div>
            <div style={{ flex: "1 1 130px", display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>TELÉFONO</label>
              <input value={form.telefono} readOnly={!puedeEditar} onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))} style={inp()} />
            </div>
            <div style={{ flex: "1 1 150px", display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>OC DEL CLIENTE</label>
              {puedeEditar
                ? <input value={form.numeroOC || ""} placeholder="Nº orden de compra" onChange={e => setForm(f => ({ ...f, numeroOC: e.target.value }))} style={inp()} />
                : <span style={{ padding: "6px 0", fontSize: 13, color: form.numeroOC ? T.cyan : T.muted, fontFamily: form.numeroOC ? T.mono : "inherit" }}>{form.numeroOC || "—"}</span>}
            </div>
          </div>
        </Glass>

        {/* Despacho */}
        <Glass style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          <p style={{ fontSize: 10, color: T.muted, fontFamily: T.mono, letterSpacing: "0.1em" }}>DESPACHO</p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: "2 1 240px", display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>DIRECCIÓN DE ENTREGA</label>
              <input value={form.direccionEntrega} readOnly={!puedeEditar} onChange={e => setForm(f => ({ ...f, direccionEntrega: e.target.value }))} style={inp()} />
            </div>
            <div style={{ flex: "1 1 140px", display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>CIUDAD</label>
              <input value={form.ciudad} readOnly={!puedeEditar} onChange={e => setForm(f => ({ ...f, ciudad: e.target.value }))} style={inp()} />
            </div>
            <div style={{ flex: "1 1 160px", display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>TRANSPORTADORA</label>
              <input value={form.transportadora} readOnly={!puedeEditar} onChange={e => setForm(f => ({ ...f, transportadora: e.target.value }))} style={inp()} />
            </div>
          </div>
        </Glass>

        {/* Condiciones */}
        <Glass style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          <p style={{ fontSize: 10, color: T.muted, fontFamily: T.mono, letterSpacing: "0.1em" }}>CONDICIONES</p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 160px", display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>TIPO DE PEDIDO</label>
              {puedeEditar ? (
                <div style={{ display: "flex", gap: 6 }}>
                  {["Producción", "Desarrollo"].map(t => (
                    <button key={t} onClick={() => setForm(f => ({ ...f, tipo: t, referencias: [] }))}
                      style={{ flex: 1, padding: "6px 10px", borderRadius: 6, border: "1px solid " + (form.tipo === t ? (t === "Desarrollo" ? T.amber : T.green) : T.border), background: form.tipo === t ? (t === "Desarrollo" ? T.amber + "20" : T.green + "20") : "transparent", color: form.tipo === t ? (t === "Desarrollo" ? T.amber : T.green) : T.muted, cursor: "pointer", fontSize: 12, fontWeight: form.tipo === t ? 700 : 400 }}>
                      {t}
                    </button>
                  ))}
                </div>
              ) : (
                <span style={{ padding: "6px 0", fontSize: 13, color: form.tipo === "Desarrollo" ? T.amber : T.green, fontWeight: 700 }}>{form.tipo || "Producción"}</span>
              )}
            </div>
            <div style={{ flex: "1 1 160px", display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>FECHA ENTREGA</label>
              <input type="date" value={form.fechaEntrega} readOnly={!puedeEditar} onChange={e => setForm(f => ({ ...f, fechaEntrega: e.target.value }))} style={inp({ colorScheme: "dark" })} />
            </div>
            <div style={{ flex: "1 1 140px", display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>PRIORIDAD</label>
              {puedeEditar
                ? <select value={form.prioridad} onChange={e => setForm(f => ({ ...f, prioridad: e.target.value }))} style={{ ...inp(), color: PEDS_PCOLOR[form.prioridad] }}>{PEDS_PRIORIDADES.map(p => <option key={p} value={p}>{p}</option>)}</select>
                : <span style={{ padding: "6px 0", fontSize: 13, color: PEDS_PCOLOR[form.prioridad] }}>{form.prioridad}</span>}
            </div>
            <div style={{ flex: "1 1 160px", display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>CONDICIONES DE PAGO</label>
              {puedeEditar
                ? <select value={form.condicionesPago} onChange={e => setForm(f => ({ ...f, condicionesPago: e.target.value }))} style={inp()}>{PEDS_CONDICIONES.map(c => <option key={c} value={c}>{c}</option>)}</select>
                : <span style={{ padding: "6px 0", fontSize: 13, color: T.cyan }}>{form.condicionesPago}</span>}
            </div>
          </div>
          {/* Anticipo */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", paddingTop: 4, borderTop: "1px solid " + T.border + "55" }}>
            <div style={{ flex: "1 1 160px", display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>ANTICIPO ($)</label>
              {puedeEditar
                ? <input type="number" min={0} value={form.anticipoMonto || ""} placeholder="0"
                    onChange={e => setForm(f => ({ ...f, anticipoMonto: parseFloat(e.target.value) || 0 }))}
                    style={inp()} />
                : <span style={{ padding: "6px 0", fontSize: 13, color: (form.anticipoMonto || 0) > 0 ? T.text : T.muted }}>
                    {(form.anticipoMonto || 0) > 0 ? `$${form.anticipoMonto.toLocaleString("es-CO")}` : "—"}
                  </span>}
            </div>
            <div style={{ flex: "1 1 160px", display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>ESTADO ANTICIPO</label>
              {puedeEditar ? (
                <div style={{ display: "flex", gap: 6 }}>
                  {["Pendiente", "Recibido"].map(e => (
                    <button key={e} onClick={() => setForm(f => ({ ...f, anticipoEstado: e }))}
                      style={{ flex: 1, padding: "6px 8px", borderRadius: 6, border: "1px solid " + (form.anticipoEstado === e ? (e === "Recibido" ? T.green : T.amber) : T.border), background: form.anticipoEstado === e ? (e === "Recibido" ? T.green + "20" : T.amber + "20") : "transparent", color: form.anticipoEstado === e ? (e === "Recibido" ? T.green : T.amber) : T.muted, cursor: "pointer", fontSize: 11, fontWeight: form.anticipoEstado === e ? 700 : 400 }}>
                      {e}
                    </button>
                  ))}
                </div>
              ) : (
                <span style={{ padding: "6px 0", fontSize: 13, fontWeight: 700, color: form.anticipoEstado === "Recibido" ? T.green : T.amber }}>
                  {form.anticipoEstado || "Pendiente"}
                </span>
              )}
            </div>
            {(form.anticipoMonto > 0 && valorTotalPedido() > 0) && (
              <div style={{ flex: "1 1 120px", display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>% DEL TOTAL</label>
                <span style={{ padding: "6px 0", fontSize: 13, color: T.cyan, fontFamily: T.mono }}>
                  {Math.round(form.anticipoMonto / valorTotalPedido() * 100)}%
                </span>
              </div>
            )}
          </div>

          {/* Planificación */}
          {(() => {
            const est = calcularEstimado();
            return (
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", paddingTop: 4, borderTop: "1px solid " + T.border + "55" }}>
                <div style={{ flex: "1 1 180px", display: "flex", flexDirection: "column", gap: 4 }}>
                  <label style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>FECHA INICIO REQUERIDA</label>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input type="date" value={form.fechaInicioRequerida || ""} readOnly={!puedeEditar}
                      onChange={e => setForm(f => ({ ...f, fechaInicioRequerida: e.target.value }))}
                      style={{ ...inp({ colorScheme: "dark", flex: 1 }) }} />
                    {puedeEditar && est && form.fechaEntrega && (
                      <button onClick={aplicarFechaInicio}
                        title={`Calcular: ${est.dias} días antes de la entrega`}
                        style={{ background: T.cyan + "22", border: "1px solid " + T.cyan + "55", borderRadius: 6, padding: "0 10px", color: T.cyan, cursor: "pointer", fontSize: 11, whiteSpace: "nowrap" }}>
                        Auto
                      </button>
                    )}
                  </div>
                </div>
                {est && (
                  <div style={{ flex: "1 1 160px", display: "flex", flexDirection: "column", gap: 4 }}>
                    <label style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>ESTIMADO DE PRODUCCIÓN</label>
                    <div style={{ padding: "6px 0", display: "flex", gap: 10, alignItems: "center" }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{est.dias} día{est.dias !== 1 ? "s" : ""}</span>
                      <span style={{ fontSize: 11, color: T.muted, fontFamily: T.mono }}>{(est.minutos / 60).toFixed(1)} h·hombre</span>
                    </div>
                  </div>
                )}
                {!est && form.tipo === "Producción" && form.referencias.length > 0 && (
                  <div style={{ flex: "1 1 160px", display: "flex", flexDirection: "column", gap: 4 }}>
                    <label style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>ESTIMADO DE PRODUCCIÓN</label>
                    <span style={{ padding: "6px 0", fontSize: 11, color: T.muted }}>Sin datos SAM en las referencias</span>
                  </div>
                )}
              </div>
            );
          })()}

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>NOTAS</label>
            <textarea value={form.notas} readOnly={!puedeEditar} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} rows={2}
              style={{ background: T.bg, border: "1px solid " + T.border, borderRadius: 6, padding: "6px 10px", color: T.text, fontSize: 12, resize: "vertical", fontFamily: "inherit", colorScheme: "dark", width: "100%", boxSizing: "border-box" }} />
          </div>
        </Glass>

        {/* Referencias */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <p style={{ fontSize: 10, color: T.muted, fontFamily: T.mono, letterSpacing: "0.1em" }}>REFERENCIAS ({form.referencias.length})</p>
          {puedeEditar && form.tipo === "Producción" && (
            <button onClick={() => setShowAddRef(true)} style={{ background: T.purple + "22", border: "1px solid " + T.purple + "66", borderRadius: 6, padding: "5px 12px", color: T.purple, cursor: "pointer", fontSize: 11, fontFamily: T.mono }}>
              + Del catálogo
            </button>
          )}
          {puedeEditar && form.tipo === "Desarrollo" && (
            <button onClick={() => { setRefDevForm(REF_DEV_INIT); setShowAddRefDev(true); }} style={{ background: T.amber + "22", border: "1px solid " + T.amber + "66", borderRadius: 6, padding: "5px 12px", color: T.amber, cursor: "pointer", fontSize: 11, fontFamily: T.mono }}>
              + Nueva referencia
            </button>
          )}
        </div>

        {form.referencias.length === 0 && (
          <Glass style={{ padding: 20, textAlign: "center" }}>
            <p style={{ fontSize: 12, color: T.muted }}>
              {puedeEditar
                ? form.tipo === "Desarrollo"
                  ? "Agrega las referencias a desarrollar (sin necesidad de catálogo)."
                  : "Agrega referencias del catálogo liberado."
                : "Sin referencias."}
            </p>
          </Glass>
        )}

        {form.referencias.map((ref, idx) => (
          <Glass key={idx} style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Encabezado */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <p style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{ref.nombre}</p>
                {ref.descripcion && <p style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>{ref.descripcion}</p>}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 12, color: T.cyan, fontFamily: T.mono }}>{totalRef(ref)} uds</span>
                {puedeEditar && <button onClick={() => quitarRef(idx)} style={{ background: "none", border: "none", color: "#ff4444", cursor: "pointer", fontSize: 18, lineHeight: 1 }}>×</button>}
              </div>
            </div>

            {/* Tallas */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {Object.entries(ref.tallas).map(([talla, qty]) => (
                <div key={talla} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                  <label style={{ fontSize: 9, color: T.muted, fontFamily: T.mono }}>{talla}</label>
                  {puedeEditar
                    ? <input type="number" min={0} value={qty} onChange={e => setTallaQty(idx, talla, e.target.value)} style={{ width: 52, background: T.bg, border: "1px solid " + T.border, borderRadius: 5, padding: "4px 6px", color: T.text, fontSize: 12, textAlign: "center" }} />
                    : <span style={{ width: 52, padding: "4px 0", textAlign: "center", fontSize: 12, color: T.text }}>{qty}</span>}
                </div>
              ))}
            </div>

            {/* Condiciones comerciales */}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", paddingTop: 6, borderTop: "1px solid " + T.border + "44" }}>
              <div style={{ flex: "1 1 100px", display: "flex", flexDirection: "column", gap: 3 }}>
                <label style={{ fontSize: 9, color: T.muted, fontFamily: T.mono }}>PRECIO UNIT. ($)</label>
                {puedeEditar
                  ? <input type="number" min={0} value={ref.precioUnitario || ""} placeholder="0"
                      onChange={e => setRefField(idx, "precioUnitario", parseFloat(e.target.value) || 0)}
                      style={{ background: T.bg, border: "1px solid " + T.border, borderRadius: 5, padding: "4px 8px", color: T.text, fontSize: 12, width: "100%", boxSizing: "border-box" }} />
                  : <span style={{ fontSize: 12, color: T.text, padding: "4px 0" }}>{ref.precioUnitario ? `$${ref.precioUnitario.toLocaleString("es-CO")}` : "—"}</span>}
              </div>
              <div style={{ flex: "1 1 80px", display: "flex", flexDirection: "column", gap: 3 }}>
                <label style={{ fontSize: 9, color: T.muted, fontFamily: T.mono }}>DESCUENTO (%)</label>
                {puedeEditar
                  ? <input type="number" min={0} max={100} value={ref.descuento || ""} placeholder="0"
                      onChange={e => setRefField(idx, "descuento", parseFloat(e.target.value) || 0)}
                      style={{ background: T.bg, border: "1px solid " + T.border, borderRadius: 5, padding: "4px 8px", color: T.text, fontSize: 12, width: "100%", boxSizing: "border-box" }} />
                  : <span style={{ fontSize: 12, color: T.text, padding: "4px 0" }}>{ref.descuento ? `${ref.descuento}%` : "—"}</span>}
              </div>
              <div style={{ flex: "2 1 140px", display: "flex", flexDirection: "column", gap: 3 }}>
                <label style={{ fontSize: 9, color: T.muted, fontFamily: T.mono }}>COLORES</label>
                {puedeEditar
                  ? <input value={ref.colores || ""} placeholder="ej. Negro, Blanco, Rojo"
                      onChange={e => setRefField(idx, "colores", e.target.value)}
                      style={{ background: T.bg, border: "1px solid " + T.border, borderRadius: 5, padding: "4px 8px", color: T.text, fontSize: 12, width: "100%", boxSizing: "border-box" }} />
                  : <span style={{ fontSize: 12, color: T.text, padding: "4px 0" }}>{ref.colores || "—"}</span>}
              </div>
              {(ref.precioUnitario > 0) && (
                <div style={{ flex: "1 1 100px", display: "flex", flexDirection: "column", gap: 3 }}>
                  <label style={{ fontSize: 9, color: T.muted, fontFamily: T.mono }}>SUBTOTAL</label>
                  <span style={{ fontSize: 13, fontWeight: 700, color: T.green, padding: "4px 0" }}>${subtotalRef(ref).toLocaleString("es-CO")}</span>
                </div>
              )}
            </div>

            {/* Notas de referencia */}
            {(puedeEditar || ref.notasRef) && (
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <label style={{ fontSize: 9, color: T.muted, fontFamily: T.mono }}>NOTAS DE REFERENCIA</label>
                {puedeEditar
                  ? <input value={ref.notasRef || ""} placeholder="Indicaciones especiales para esta referencia..."
                      onChange={e => setRefField(idx, "notasRef", e.target.value)}
                      style={{ background: T.bg, border: "1px solid " + T.border, borderRadius: 5, padding: "4px 8px", color: T.text, fontSize: 12, width: "100%", boxSizing: "border-box" }} />
                  : <span style={{ fontSize: 11, color: T.muted, fontStyle: "italic" }}>{ref.notasRef}</span>}
              </div>
            )}
          </Glass>
        ))}

        {/* Totalizador */}
        {form.referencias.length > 0 && (
          <Glass style={{ padding: 16 }}>
            <p style={{ fontSize: 10, color: T.muted, fontFamily: T.mono, letterSpacing: "0.1em", marginBottom: 12 }}>RESUMEN DEL PEDIDO</p>
            {Object.keys(totTalla).length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
                {Object.entries(totTalla).map(([talla, qty]) => (
                  <div key={talla} style={{ textAlign: "center", minWidth: 52, background: T.surface, border: "1px solid " + T.border, borderRadius: 8, padding: "6px 8px" }}>
                    <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono }}>{talla}</p>
                    <p style={{ fontSize: 20, fontWeight: 900, color: T.text, lineHeight: 1.2 }}>{qty}</p>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, color: T.muted }}>Total unidades</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: T.text, fontFamily: T.mono }}>{totalUds}</span>
              </div>
              {tienePrecios && (
                <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid " + T.border, paddingTop: 6 }}>
                  <span style={{ fontSize: 12, color: T.muted }}>Valor total del pedido</span>
                  <span style={{ fontSize: 16, fontWeight: 900, color: T.green }}>${valTotal.toLocaleString("es-CO")}</span>
                </div>
              )}
              {form.condicionesPago && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 12, color: T.muted }}>Condiciones de pago</span>
                  <span style={{ fontSize: 12, color: T.cyan }}>{form.condicionesPago}</span>
                </div>
              )}
            </div>
          </Glass>
        )}

        {/* Progreso de producción */}
        {ordenesDelPedido.length > 0 && (
          <Glass style={{ padding: 16, borderColor: T.green + "44" }}>
            <p style={{ fontSize: 10, color: T.muted, fontFamily: T.mono, letterSpacing: "0.1em", marginBottom: 12 }}>PROGRESO DE PRODUCCIÓN</p>
            {ordenesDelPedido.map(o => {
              const pct = o.cantidadTotal ? Math.round(o.cantidadProducida / o.cantidadTotal * 100) : 0;
              return (
                <div key={o.id} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{o.referencia}</span>
                    <span style={{ fontSize: 11, fontFamily: T.mono, color: T.muted }}>{o.cantidadProducida}/{o.cantidadTotal} uds · {pct}%</span>
                  </div>
                  <ProgressBar value={pct} />
                </div>
              );
            })}
          </Glass>
        )}

        {/* Generar órdenes — Director */}
        {esDirector && !modoNuevo && (
          <Glass style={{ padding: 16, borderColor: yaGenerado ? T.green + "55" : T.cyan + "55" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
              <div>
                <p style={{ fontSize: 12, fontWeight: 700, color: yaGenerado ? T.green : T.cyan }}>
                  {yaGenerado ? `✓ Órdenes de producción generadas (${ordenesDelPedido.length})` : "Generar Órdenes de Producción"}
                </p>
                {yaGenerado
                  ? <p style={{ fontSize: 11, color: T.muted, marginTop: 3 }}>{ordenesDelPedido.map(o => o.referencia).join(" · ")}</p>
                  : <p style={{ fontSize: 11, color: T.muted, marginTop: 3 }}>
                      {form.estado !== "Confirmado"
                        ? "El pedido debe estar en estado Confirmado."
                        : `Se crearán ${form.referencias.filter(r => Object.values(r.tallas).some(q => q > 0)).length} orden(es) de producción.`}
                    </p>}
                {ordenesCreadas.length > 0 && <p style={{ fontSize: 11, color: T.green, marginTop: 4 }}>Órdenes creadas: {ordenesCreadas.join(", ")}</p>}
              </div>
              {!yaGenerado && form.estado === "Confirmado" && form.referencias.some(r => Object.values(r.tallas).some(q => q > 0)) && (
                <button onClick={generarOrdenes}
                  style={{ background: T.cyan, border: "none", borderRadius: 7, padding: "8px 18px", color: "#000", fontWeight: 700, cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" }}>
                  Generar órdenes
                </button>
              )}
            </div>
          </Glass>
        )}

        {/* Historial de estados */}
        {(form.historial || []).length > 0 && (
          <Glass style={{ padding: 16 }}>
            <p style={{ fontSize: 10, color: T.muted, fontFamily: T.mono, letterSpacing: "0.1em", marginBottom: 10 }}>HISTORIAL</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[...(form.historial || [])].reverse().map((h, i, arr) => (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", paddingBottom: i < arr.length - 1 ? 8 : 0, borderBottom: i < arr.length - 1 ? "1px solid " + T.border + "44" : "none" }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: PEDS_ECOLOR[h.estado] || T.muted, marginTop: 5, flexShrink: 0 }} />
                  <div>
                    <span style={{ fontSize: 12, color: T.text, fontWeight: 600 }}>{h.estado}</span>
                    <span style={{ fontSize: 11, color: T.muted }}> — {h.usuario}</span>
                    <p style={{ fontSize: 10, color: T.muted, fontFamily: T.mono, marginTop: 2 }}>
                      {new Date(h.fecha).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </Glass>
        )}

        {/* Mensajes de error */}
        {error && <p style={{ fontSize: 12, color: "#ff4444", textAlign: "right" }}>{error}</p>}

        {/* Acciones */}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap", paddingTop: 4 }}>
          <button onClick={() => setVista("lista")} style={{ background: "none", border: "1px solid " + T.border, borderRadius: 7, padding: "8px 18px", color: T.muted, cursor: "pointer", fontSize: 12 }}>
            {modoNuevo ? "Cancelar" : "← Lista"}
          </button>
          {!modoNuevo && form.estado === "En producción" && (esComercial || esDirector) && (
            <button onClick={marcarEntregado}
              style={{ background: T.purple + "22", border: "1px solid " + T.purple + "66", borderRadius: 7, padding: "8px 18px", color: T.purple, cursor: "pointer", fontSize: 12 }}>
              Marcar entregado
            </button>
          )}
          {!modoNuevo && form.estado === "Borrador" && esComercial && (
            <button onClick={confirmarPedido}
              style={{ background: T.cyan + "22", border: "1px solid " + T.cyan + "66", borderRadius: 7, padding: "8px 18px", color: T.cyan, cursor: "pointer", fontSize: 12 }}>
              Confirmar pedido
            </button>
          )}
          {(puedeEditar || (esDirector && !modoNuevo)) && (
            <button onClick={guardar} style={{ background: T.purple, border: "none", borderRadius: 7, padding: "8px 20px", color: "#000", fontWeight: 700, cursor: "pointer", fontSize: 12 }}>
              {modoNuevo ? "Crear pedido" : "Guardar cambios"}
            </button>
          )}
        </div>

        {/* Modal referencia de desarrollo */}
        {showAddRefDev && (
          <div style={{ position: "fixed", inset: 0, background: "#000b", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Glass style={{ width: 520, maxWidth: "95vw", maxHeight: "85vh", display: "flex", flexDirection: "column", gap: 14, padding: 20, overflowY: "auto" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <p style={{ fontWeight: 700, fontSize: 14, color: T.amber }}>Nueva referencia de desarrollo</p>
                <button onClick={() => setShowAddRefDev(false)} style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: 20 }}>×</button>
              </div>

              <div style={{ display: "flex", gap: 10, flexDirection: "column" }}>
                <div>
                  <label style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>NOMBRE *</label>
                  <input value={refDevForm.nombre} onChange={e => setRefDevForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Nombre de la referencia"
                    style={{ ...inp(), marginTop: 4 }} autoFocus />
                </div>
                <div>
                  <label style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>DESCRIPCIÓN</label>
                  <input value={refDevForm.descripcion} onChange={e => setRefDevForm(f => ({ ...f, descripcion: e.target.value }))} placeholder="Descripción breve"
                    style={{ ...inp(), marginTop: 4 }} />
                </div>
              </div>

              <div>
                <label style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>TALLAS *</label>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                  {TALLAS_DISPONIBLES.map(t => {
                    const activa = refDevForm.tallasActivas.includes(t);
                    return (
                      <button key={t} onClick={() => toggleTallasDev(t)}
                        style={{ padding: "5px 12px", borderRadius: 20, border: "1px solid " + (activa ? T.amber : T.border), background: activa ? T.amber + "20" : "transparent", color: activa ? T.amber : T.muted, fontFamily: T.mono, fontSize: 12, fontWeight: activa ? 700 : 400, cursor: "pointer" }}>
                        {t}
                      </button>
                    );
                  })}
                </div>
                {refDevForm.tallasActivas.length > 0 && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                    {refDevForm.tallasActivas.map(t => (
                      <div key={t} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                        <label style={{ fontSize: 9, color: T.amber, fontFamily: T.mono }}>{t}</label>
                        <input type="number" min={0} value={refDevForm.tallasQty[t] || ""} placeholder="0"
                          onChange={e => setRefDevForm(f => ({ ...f, tallasQty: { ...f.tallasQty, [t]: parseInt(e.target.value) || 0 } }))}
                          style={{ width: 56, background: T.bg, border: "1px solid " + T.amber + "66", borderRadius: 5, padding: "4px 6px", color: T.text, fontSize: 12, textAlign: "center" }} />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", borderTop: "1px solid " + T.border + "55", paddingTop: 10 }}>
                <div style={{ flex: "1 1 110px", display: "flex", flexDirection: "column", gap: 3 }}>
                  <label style={{ fontSize: 9, color: T.muted, fontFamily: T.mono }}>PRECIO UNIT. ($)</label>
                  <input type="number" min={0} value={refDevForm.precioUnitario || ""} placeholder="0"
                    onChange={e => setRefDevForm(f => ({ ...f, precioUnitario: parseFloat(e.target.value) || 0 }))}
                    style={{ background: T.bg, border: "1px solid " + T.border, borderRadius: 5, padding: "4px 8px", color: T.text, fontSize: 12, width: "100%", boxSizing: "border-box" }} />
                </div>
                <div style={{ flex: "1 1 90px", display: "flex", flexDirection: "column", gap: 3 }}>
                  <label style={{ fontSize: 9, color: T.muted, fontFamily: T.mono }}>DESCUENTO (%)</label>
                  <input type="number" min={0} max={100} value={refDevForm.descuento || ""} placeholder="0"
                    onChange={e => setRefDevForm(f => ({ ...f, descuento: parseFloat(e.target.value) || 0 }))}
                    style={{ background: T.bg, border: "1px solid " + T.border, borderRadius: 5, padding: "4px 8px", color: T.text, fontSize: 12, width: "100%", boxSizing: "border-box" }} />
                </div>
                <div style={{ flex: "2 1 140px", display: "flex", flexDirection: "column", gap: 3 }}>
                  <label style={{ fontSize: 9, color: T.muted, fontFamily: T.mono }}>COLORES</label>
                  <input value={refDevForm.colores} placeholder="ej. Negro, Blanco" onChange={e => setRefDevForm(f => ({ ...f, colores: e.target.value }))}
                    style={{ background: T.bg, border: "1px solid " + T.border, borderRadius: 5, padding: "4px 8px", color: T.text, fontSize: 12, width: "100%", boxSizing: "border-box" }} />
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <label style={{ fontSize: 9, color: T.muted, fontFamily: T.mono }}>NOTAS</label>
                <input value={refDevForm.notasRef} placeholder="Indicaciones especiales..." onChange={e => setRefDevForm(f => ({ ...f, notasRef: e.target.value }))}
                  style={{ background: T.bg, border: "1px solid " + T.border, borderRadius: 5, padding: "4px 8px", color: T.text, fontSize: 12, width: "100%", boxSizing: "border-box" }} />
              </div>

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={() => setShowAddRefDev(false)} style={{ background: "none", border: "1px solid " + T.border, borderRadius: 6, padding: "7px 16px", color: T.muted, cursor: "pointer", fontSize: 12 }}>Cancelar</button>
                <button onClick={confirmarRefDev}
                  disabled={!refDevForm.nombre.trim() || refDevForm.tallasActivas.length === 0}
                  style={{ background: refDevForm.nombre.trim() && refDevForm.tallasActivas.length > 0 ? T.amber : T.border, border: "none", borderRadius: 6, padding: "7px 18px", color: "#000", fontWeight: 700, cursor: "pointer", fontSize: 12 }}>
                  Agregar referencia
                </button>
              </div>
            </Glass>
          </div>
        )}

        {/* Modal catálogo */}
        {showAddRef && (
          <div style={{ position: "fixed", inset: 0, background: "#000b", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Glass style={{ width: 480, maxWidth: "95vw", maxHeight: "80vh", display: "flex", flexDirection: "column", gap: 12, padding: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <p style={{ fontWeight: 700, fontSize: 14 }}>Agregar referencia del catálogo</p>
                <button onClick={() => { setShowAddRef(false); setSearchCat(""); }} style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: 20 }}>×</button>
              </div>
              <input placeholder="Buscar referencia..." value={searchCat} onChange={e => setSearchCat(e.target.value)}
                style={{ background: T.bg, border: "1px solid " + T.border, borderRadius: 6, padding: "7px 12px", color: T.text, fontSize: 12, width: "100%", boxSizing: "border-box" }} autoFocus />
              <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
                {catFiltrado.length === 0 && (
                  <p style={{ fontSize: 12, color: T.muted, textAlign: "center", padding: 20 }}>
                    {catLiberado.length === 0 ? "No hay fichas técnicas liberadas en el catálogo." : "Sin coincidencias."}
                  </p>
                )}
                {catFiltrado.map(cat => {
                  const yaAgregada = form.referencias.some(r => r.catalogoId === cat.id);
                  return (
                    <div key={cat.id} onClick={() => !yaAgregada && agregarRef(cat)}
                      style={{ padding: "10px 14px", borderRadius: 7, border: "1px solid " + T.border, cursor: yaAgregada ? "default" : "pointer", opacity: yaAgregada ? 0.4 : 1, background: T.surface, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <p style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{cat.nombre}</p>
                        <p style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>Tallas: {(cat.tallas || []).join(", ") || "—"} · {(cat.operaciones || []).length} operaciones</p>
                      </div>
                      <span style={{ fontSize: 10, fontFamily: T.mono, color: yaAgregada ? T.muted : T.purple }}>
                        {yaAgregada ? "YA AGREGADA" : "SELECCIONAR"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </Glass>
          </div>
        )}
      </div>
    );
  }

  // ── LISTA DE PEDIDOS ──
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <p style={{ fontSize: 10, color: T.muted, fontFamily: T.mono, letterSpacing: "0.14em" }}>ÓRDENES DE PEDIDO</p>
        {esComercial && (
          <button onClick={abrirNuevo} style={{ background: T.purple + "22", border: "1px solid " + T.purple + "66", borderRadius: 7, padding: "7px 16px", color: T.purple, cursor: "pointer", fontSize: 12, fontFamily: T.mono }}>
            + Nuevo pedido
          </button>
        )}
      </div>

      {pedidos.length === 0 && (
        <Glass style={{ padding: 32, textAlign: "center" }}>
          <ShoppingCart size={36} color={T.purple} strokeWidth={1} style={{ margin: "0 auto 12px" }} />
          <p style={{ fontSize: 13, color: T.muted }}>No hay pedidos registrados.</p>
          {esComercial && <p style={{ fontSize: 11, color: T.muted, marginTop: 6 }}>Crea el primer pedido con el botón superior.</p>}
        </Glass>
      )}

      {pedidos.map(p => (
        <Glass key={p.id} style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8, cursor: "pointer" }} onClick={() => abrirEditar(p)}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              {p.numeroPedido && <p style={{ fontSize: 10, color: T.muted, fontFamily: T.mono, marginBottom: 2 }}>{p.numeroPedido}</p>}
              <p style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{p.cliente}</p>
              {p.contacto && <p style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>{p.contacto}{p.telefono ? ` · ${p.telefono}` : ""}</p>}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <Badge style={{ background: (PEDS_PCOLOR[p.prioridad] || T.muted) + "22", color: PEDS_PCOLOR[p.prioridad] || T.muted, border: "1px solid " + (PEDS_PCOLOR[p.prioridad] || T.muted) + "55" }}>{p.prioridad}</Badge>
              <Badge style={{ background: (PEDS_ECOLOR[p.estado] || T.muted) + "22", color: PEDS_ECOLOR[p.estado] || T.muted, border: "1px solid " + (PEDS_ECOLOR[p.estado] || T.muted) + "55" }}>{p.estado}</Badge>
            </div>
          </div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: T.muted, fontFamily: T.mono }}>
              {p.referencias?.length || 0} ref{(p.referencias?.length || 0) !== 1 ? "s" : ""} · {totalPed(p)} uds
            </span>
            {p.numeroOC && <span style={{ fontSize: 11, color: T.cyan, fontFamily: T.mono }}>OC: {p.numeroOC}</span>}
            {p.fechaEntrega && <span style={{ fontSize: 11, color: T.amber, fontFamily: T.mono }}>Entrega: {p.fechaEntrega}</span>}
            {p.fechaInicioRequerida && <span style={{ fontSize: 11, color: T.muted, fontFamily: T.mono }}>Inicio: {p.fechaInicioRequerida}</span>}
            {(p.anticipoMonto > 0) && (
              <span style={{ fontSize: 11, fontFamily: T.mono, color: p.anticipoEstado === "Recibido" ? T.green : T.amber }}>
                Anticipo {p.anticipoEstado === "Recibido" ? "✓" : "⚠"} ${(p.anticipoMonto || 0).toLocaleString("es-CO")}
              </span>
            )}
            {p.condicionesPago && p.condicionesPago !== "Contado" && <span style={{ fontSize: 11, color: T.muted, fontFamily: T.mono }}>{p.condicionesPago}</span>}
            <span style={{ fontSize: 11, color: T.muted, fontFamily: T.mono }}>Creado: {p.fechaCreacion}</span>
            {p.estado === "En producción" && <span style={{ fontSize: 11, color: T.green, fontFamily: T.mono }}>En producción</span>}
            {p.estado === "Entregado" && <span style={{ fontSize: 11, color: T.purple, fontFamily: T.mono }}>✓ Entregado</span>}
          </div>
          {p.notas && <p style={{ fontSize: 11, color: T.muted, fontStyle: "italic" }}>{p.notas}</p>}
          {confirmDel === p.id ? (
            <div onClick={e => e.stopPropagation()} style={{ display: "flex", gap: 8, paddingTop: 8, borderTop: "1px solid " + T.border, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "#ff4444", flex: 1 }}>¿Eliminar este pedido?</span>
              <button onClick={() => eliminar(p.id)} style={{ background: "#ff4444", border: "none", borderRadius: 5, padding: "4px 12px", color: "#fff", cursor: "pointer", fontSize: 11 }}>Eliminar</button>
              <button onClick={() => setConfirmDel(null)} style={{ background: "none", border: "1px solid " + T.border, borderRadius: 5, padding: "4px 10px", color: T.muted, cursor: "pointer", fontSize: 11 }}>Cancelar</button>
            </div>
          ) : (
            esComercial && p.estado === "Borrador" && (
              <button onClick={e => { e.stopPropagation(); setConfirmDel(p.id); }}
                style={{ background: "none", border: "none", color: "#ff444488", cursor: "pointer", fontSize: 11, textAlign: "left", padding: 0, marginTop: 2 }}>
                Eliminar pedido
              </button>
            )
          )}
        </Glass>
      ))}
    </div>
  );
};

// ─── PIPELINE DE PRODUCCIÓN (Fase 4) ──────────────────────────────────────────

const PipelineProduccion = ({ ordenes }) => {
  const etapas = [
    { id: "Pendiente",  label: "Pendientes",  color: T.muted  },
    { id: "En proceso", label: "En proceso",  color: T.cyan   },
    { id: "Completado", label: "Completados", color: T.green  },
  ];
  const FEATURES = [
    "Flujo completo: Pedido → Compra → Corte → Confección → Calidad → Despacho",
    "Timeline por orden con fechas reales vs. planeadas",
    "Alertas de retraso y cuellos de botella",
    "Aprobación de solicitudes de compra pendientes",
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p style={{ fontSize: 10, color: T.muted, fontFamily: T.mono, letterSpacing: "0.14em" }}>PIPELINE DE PRODUCCIÓN</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        {etapas.map(e => {
          const count = ordenes.filter(o => o.estado === e.id).length;
          return (
            <div key={e.id} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid " + e.color + "33", borderRadius: 12, padding: "14px 12px", textAlign: "center" }}>
              <p style={{ fontSize: 28, fontWeight: 900, color: e.color, fontFamily: T.mono, lineHeight: 1 }}>{count}</p>
              <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, marginTop: 4 }}>{e.label.toUpperCase()}</p>
            </div>
          );
        })}
      </div>
      <Glass style={{ padding: 24, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
        <GitBranch size={36} color={T.orange} strokeWidth={1} />
        <div style={{ textAlign: "center" }}>
          <p style={{ fontSize: 14, fontWeight: 800, color: T.text }}>Vista Pipeline Completa</p>
          <p style={{ fontSize: 11, color: T.orange, fontFamily: T.mono, marginTop: 4 }}>FASE 4 — EN CONSTRUCCIÓN</p>
        </div>
        <div style={{ width: "100%", borderTop: "1px solid " + T.border, paddingTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {FEATURES.map(f => (
            <div key={f} style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: T.orange, flexShrink: 0 }} />
              <p style={{ fontSize: 11, color: T.muted, fontFamily: T.mono }}>{f}</p>
            </div>
          ))}
        </div>
      </Glass>
    </div>
  );
};

// ─── GESTIÓN DE INVENTARIO Y COMPRAS (Fase 5) ─────────────────────────────────

const GestionInventario = () => {
  const FEATURES = [
    "Inventario de telas e insumos con stock actual",
    "Cálculo automático de faltantes por orden de producción",
    "Solicitud de compra — aprobación del Director",
    "Registro de entradas a bodega",
    "Alertas de stock mínimo por material",
    "Historial de compras por proveedor",
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p style={{ fontSize: 10, color: T.muted, fontFamily: T.mono, letterSpacing: "0.14em" }}>INVENTARIO Y COMPRAS</p>
      <Glass style={{ padding: 28, display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
        <Package size={44} color={T.cyan} strokeWidth={1} />
        <div style={{ textAlign: "center" }}>
          <p style={{ fontSize: 16, fontWeight: 800, color: T.text }}>Módulo en construcción</p>
          <p style={{ fontSize: 11, color: T.cyan, fontFamily: T.mono, marginTop: 4 }}>FASE 5 · JEFE DE COMPRAS</p>
        </div>
        <div style={{ width: "100%", borderTop: "1px solid " + T.border, paddingTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          {FEATURES.map(f => (
            <div key={f} style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: T.cyan, flexShrink: 0 }} />
              <p style={{ fontSize: 11, color: T.muted, fontFamily: T.mono }}>{f}</p>
            </div>
          ))}
        </div>
      </Glass>
    </div>
  );
};

// ─── GESTIÓN DE CORTE (Fase 6) ────────────────────────────────────────────────

const GestionCorte = () => {
  const FEATURES = [
    "Orden de corte generada desde la orden de producción",
    "Trazo, tendido y marcada de tela",
    "Registro de piezas cortadas por talla",
    "Corte externo a terceros con seguimiento",
    "Piezas cortadas habilitan el inicio de confección",
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p style={{ fontSize: 10, color: T.muted, fontFamily: T.mono, letterSpacing: "0.14em" }}>MÓDULO DE CORTE</p>
      <Glass style={{ padding: 28, display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
        <Scissors size={44} color={T.amber} strokeWidth={1} />
        <div style={{ textAlign: "center" }}>
          <p style={{ fontSize: 16, fontWeight: 800, color: T.text }}>Módulo en construcción</p>
          <p style={{ fontSize: 11, color: T.amber, fontFamily: T.mono, marginTop: 4 }}>FASE 6 · JEFE DE CORTE</p>
        </div>
        <div style={{ width: "100%", borderTop: "1px solid " + T.border, paddingTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          {FEATURES.map(f => (
            <div key={f} style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: T.amber, flexShrink: 0 }} />
              <p style={{ fontSize: 11, color: T.muted, fontFamily: T.mono }}>{f}</p>
            </div>
          ))}
        </div>
      </Glass>
    </div>
  );
};

// ─── GESTIÓN DE FICHAS TÉCNICAS ───────────────────────────────────────────────

const FORM_CAT_INIT = {
  nombre: "", descripcion: "", cliente: "", temporada: "",
  estado: "Borrador", numPrototipo: 0,
  tallas: [], operaciones: [],
  insumos: [],
  corte: { direccion: "Al hilo", tendido: "Simple", consumoPorTalla: {}, notas: "" },
  historial: [],
  fechaCreacion: "", fechaAprobacion: null, fechaLiberacion: null,
};
const UNIDADES_INS  = ["m", "mt", "yds", "kg", "g", "und", "par", "jgo", "rollo"];
const DIRS_CORTE    = ["Al hilo", "Sesgado", "En biés", "A cuadros", "A rayas"];
const TIPOS_TENDIDO = ["Simple", "Doble cara", "Tubular", "En biés"];

const GestionCatalogo = ({ catalogo, setCatalogo, maquinas = [], setMaquinas, sesion }) => {
  const [vista, setVista]             = useState("lista");
  const [tabForm, setTabForm]         = useState("info");
  const [refSel, setRefSel]           = useState(null);
  const [form, setForm]               = useState(FORM_CAT_INIT);
  const [insumoForm, setInsumoForm]   = useState({ material: "", referencia: "", unidad: "m", consumo: "" });
  const [editInsumoIdx, setEditInsumoIdx] = useState(null);
  const [showForm, setShowForm]       = useState(false);
  const [opForm, setOpForm]           = useState({ operacion: "", sam: "", maquina: "" });
  const [nuevaMaquinaInput, setNuevaMaquinaInput] = useState("");
  const [showNuevaMaquina, setShowNuevaMaquina]   = useState(false);
  const [guardandoMaquina, setGuardandoMaquina]   = useState(false);
  const [buscar, setBuscar]           = useState("");
  const [filtroEstado, setFiltroEstado] = useState("Todos");
  const [confirmarEliminarId, setConfirmarEliminarId] = useState(null);
  const [notaProto, setNotaProto]     = useState("");
  const [showProtoModal, setShowProtoModal] = useState(null);

  const INP = { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", padding: "8px 10px", color: T.text, fontSize: 13, outline: "none", fontFamily: T.font, width: "100%", borderRadius: 6, boxSizing: "border-box" };
  const [editandoIdx, setEditandoIdx] = useState(null);
  const [editOpForm, setEditOpForm]   = useState({ operacion: "", sam: "", maquina: "" });
  const [draggingIdx, setDraggingIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const [errForm, setErrForm]         = useState("");

  const eColor = (e) => ({ "Borrador": T.muted, "En Prototipo": T.yellow, "Aprobada": T.blue, "Liberada": T.green }[e] || T.muted);

  const toggleTalla = (t) => setForm(p => ({
    ...p,
    tallas: p.tallas.includes(t) ? p.tallas.filter(x => x !== t) : [...p.tallas, t],
    corte: { ...p.corte, consumoPorTalla: p.tallas.includes(t) ? Object.fromEntries(Object.entries(p.corte.consumoPorTalla).filter(([k]) => k !== t)) : p.corte.consumoPorTalla }
  }));

  const eliminarRef = async (id) => {
    await supabase.from("catalogo").delete().eq("id", id);
    setCatalogo(prev => prev.filter(r => r.id !== id));
    setConfirmarEliminarId(null);
  };

  const editarRef = (ref) => {
    setForm({
      nombre: ref.nombre || "", descripcion: ref.descripcion || "",
      cliente: ref.cliente || "", temporada: ref.temporada || "",
      estado: ref.estado || "Borrador", numPrototipo: ref.numPrototipo || 0,
      tallas: [...(ref.tallas || [])], operaciones: [...(ref.operaciones || [])],
      insumos: [...(ref.insumos || [])],
      corte: { direccion: "Al hilo", tendido: "Simple", consumoPorTalla: {}, notas: "", ...(ref.corte || {}) },
      historial: [...(ref.historial || [])],
      fechaCreacion: ref.fechaCreacion || new Date().toLocaleDateString("es-CO"),
      fechaAprobacion: ref.fechaAprobacion || null, fechaLiberacion: ref.fechaLiberacion || null,
    });
    setRefSel(ref.id); setVista("form"); setTabForm("info"); setErrForm("");
  };

  const nuevaRef = () => {
    setForm({ ...FORM_CAT_INIT, fechaCreacion: new Date().toLocaleDateString("es-CO") });
    setRefSel(null); setVista("form"); setTabForm("info"); setErrForm("");
  };

  const guardar = () => {
    if (!form.nombre.trim()) { setErrForm("Ingresa el código/nombre de la referencia"); setTabForm("info"); return; }
    if (!form.tallas.length) { setErrForm("Selecciona al menos una talla"); setTabForm("info"); return; }
    if (!form.operaciones.length) { setErrForm("Agrega al menos una operación de confección"); setTabForm("operaciones"); return; }
    setErrForm("");
    const entry = { ...form, id: refSel || "CAT-" + Date.now() };
    setCatalogo(prev => refSel ? prev.map(r => r.id === refSel ? entry : r) : [...prev, entry]);
    setVista("lista"); setRefSel(null); setForm(FORM_CAT_INIT);
  };

  // ── Insumos ──
  const agregarInsumo = () => {
    if (!insumoForm.material.trim() || !insumoForm.consumo) return;
    const ins = { id: Date.now(), ...insumoForm, consumo: parseFloat(insumoForm.consumo) };
    if (editInsumoIdx !== null) {
      setForm(p => ({ ...p, insumos: p.insumos.map((x, i) => i === editInsumoIdx ? ins : x) }));
      setEditInsumoIdx(null);
    } else {
      setForm(p => ({ ...p, insumos: [...p.insumos, ins] }));
    }
    setInsumoForm({ material: "", referencia: "", unidad: "m", consumo: "" });
  };

  const editarInsumo = (idx) => {
    const ins = form.insumos[idx];
    setInsumoForm({ material: ins.material, referencia: ins.referencia || "", unidad: ins.unidad, consumo: String(ins.consumo) });
    setEditInsumoIdx(idx);
  };

  // ── Operaciones ──
  const agregarOp = () => {
    if (!opForm.operacion.trim() || !opForm.sam) return;
    setForm(p => ({ ...p, operaciones: [...p.operaciones, { operacion: opForm.operacion.trim(), sam: parseFloat(opForm.sam), maquina: opForm.maquina }] }));
    setOpForm({ operacion: "", sam: "", maquina: "" });
    setShowNuevaMaquina(false); setNuevaMaquinaInput("");
  };

  const guardarNuevaMaquina = async () => {
    const nombre = nuevaMaquinaInput.trim();
    if (!nombre) return;
    setGuardandoMaquina(true);
    const { data, error } = await supabase.from("maquinas").insert({ nombre }).select().single();
    if (!error && data) { setMaquinas(prev => [...prev, { id: data.id, nombre: data.nombre }]); setOpForm(p => ({ ...p, maquina: data.nombre })); }
    setNuevaMaquinaInput(""); setShowNuevaMaquina(false); setGuardandoMaquina(false);
  };

  const handleDrop = (targetIdx) => {
    if (draggingIdx === null || draggingIdx === targetIdx) return;
    setForm(p => { const ops = [...p.operaciones]; const [item] = ops.splice(draggingIdx, 1); ops.splice(targetIdx, 0, item); return { ...p, operaciones: ops }; });
    setDraggingIdx(null); setDragOverIdx(null);
  };
  const iniciarEditOp = (idx) => { const op = form.operaciones[idx]; setEditandoIdx(idx); setEditOpForm({ operacion: op.operacion, sam: String(op.sam), maquina: op.maquina || "" }); };
  const guardarEditOp = (idx) => {
    if (!editOpForm.operacion.trim() || !editOpForm.sam) return;
    setForm(p => { const ops = [...p.operaciones]; ops[idx] = { operacion: editOpForm.operacion.trim(), sam: parseFloat(editOpForm.sam), maquina: editOpForm.maquina }; return { ...p, operaciones: ops }; });
    setEditandoIdx(null);
  };

  // ── Workflow prototipos ──
  const ejecutarProto = () => {
    const fecha = new Date().toLocaleDateString("es-CO");
    let nuevoEstado = form.estado, nuevoNum = form.numPrototipo, histEntry = null;
    if (showProtoModal === "iniciar")  { nuevoEstado = "En Prototipo"; nuevoNum = (form.numPrototipo || 0) + 1; histEntry = { numero: nuevoNum, fecha, observaciones: notaProto || "Inicio de prototipo", aprobado: false }; }
    if (showProtoModal === "aprobar")  { nuevoEstado = "Aprobada"; histEntry = { numero: form.numPrototipo, fecha, observaciones: notaProto || "Prototipo aprobado", aprobado: true }; }
    if (showProtoModal === "rechazar") { nuevoNum = (form.numPrototipo || 0) + 1; histEntry = { numero: form.numPrototipo, fecha, observaciones: notaProto || "Requiere ajustes", aprobado: false }; }
    if (showProtoModal === "liberar")  { nuevoEstado = "Liberada"; }
    setForm(p => ({ ...p, estado: nuevoEstado, numPrototipo: nuevoNum, historial: histEntry ? [...p.historial, histEntry] : p.historial, fechaAprobacion: showProtoModal === "aprobar" ? fecha : p.fechaAprobacion, fechaLiberacion: showProtoModal === "liberar" ? fecha : p.fechaLiberacion }));
    setShowProtoModal(null); setNotaProto("");
  };

  const filtradas = catalogo.filter(r => {
    const q = buscar.toLowerCase();
    return (r.nombre.toLowerCase().includes(q) || (r.descripcion || "").toLowerCase().includes(q)) &&
           (filtroEstado === "Todos" || (r.estado || "Borrador") === filtroEstado);
  });

  const TABS_FORM = [
    { id: "info", label: "Info" }, { id: "insumos", label: "Insumos" },
    { id: "corte", label: "Corte" }, { id: "operaciones", label: "Operaciones" },
    { id: "prototipo", label: "Prototipo" },
  ];

  // ── VISTA LISTA ──
  if (vista === "lista") return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <p style={{ fontSize: 10, color: T.muted, fontFamily: T.mono, letterSpacing: "0.14em" }}>FICHAS TÉCNICAS ({catalogo.length})</p>
        {["ADMIN","DIRECTOR_PRODUCCION","SUPERVISOR"].includes(sesion?.rol) &&
          <button onClick={nuevaRef} style={{ background: T.yellow, color: "#000", fontFamily: T.mono, fontWeight: 900, fontSize: 11, padding: "7px 14px", border: "none", cursor: "pointer", borderRadius: 6 }}>+ NUEVA FICHA</button>}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={buscar} onChange={e => setBuscar(e.target.value)} placeholder="Buscar referencia..." style={{ ...INP, flex: 1, padding: "8px 12px" }} />
        <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)} style={{ ...INP, width: "auto" }}>
          {["Todos","Borrador","En Prototipo","Aprobada","Liberada"].map(e => <option key={e}>{e}</option>)}
        </select>
      </div>
      {filtradas.map(ref => (
        <Glass key={ref.id} style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                <p style={{ fontSize: 16, fontWeight: 900, color: T.text, fontFamily: T.font }}>{ref.nombre}</p>
                <span style={{ fontSize: 9, fontFamily: T.mono, fontWeight: 700, color: eColor(ref.estado || "Borrador"), border: "1px solid " + eColor(ref.estado || "Borrador") + "55", padding: "2px 8px", borderRadius: 10 }}>
                  {ref.estado || "Borrador"}{ref.estado === "En Prototipo" ? " P" + (ref.numPrototipo || 1) : ""}
                </span>
              </div>
              <p style={{ fontSize: 11, color: T.muted, fontFamily: T.mono }}>{ref.descripcion}{ref.cliente ? " · " + ref.cliente : ""}{ref.temporada ? " · " + ref.temporada : ""}</p>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {confirmarEliminarId === ref.id ? (
                <>
                  <span style={{ fontSize: 10, color: T.red, fontFamily: T.mono, alignSelf: "center" }}>¿Eliminar?</span>
                  <button onClick={() => eliminarRef(ref.id)} style={{ background: T.red, color: "#fff", border: "none", fontFamily: T.mono, fontSize: 10, padding: "5px 10px", cursor: "pointer", borderRadius: 6, fontWeight: 900 }}>SÍ</button>
                  <button onClick={() => setConfirmarEliminarId(null)} style={{ background: "transparent", border: "1px solid " + T.border, color: T.muted, fontFamily: T.mono, fontSize: 10, padding: "5px 10px", cursor: "pointer", borderRadius: 6 }}>NO</button>
                </>
              ) : (
                <>
                  <button onClick={() => editarRef(ref)} style={{ background: "transparent", border: "1px solid #4499ff", color: "#4499ff", fontFamily: T.mono, fontSize: 10, padding: "5px 12px", cursor: "pointer", borderRadius: 6 }}>VER / EDITAR</button>
                  {["ADMIN","DIRECTOR_PRODUCCION"].includes(sesion?.rol) && ref.estado !== "Liberada" &&
                    <button onClick={() => setConfirmarEliminarId(ref.id)} style={{ background: "transparent", border: "1px solid rgba(255,0,68,0.4)", color: T.red, fontFamily: T.mono, fontSize: 10, padding: "5px 12px", cursor: "pointer", borderRadius: 6 }}>ELIMINAR</button>}
                </>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(ref.tallas || []).map(t => <Badge key={t} color="gray">{t}</Badge>)}
            {(ref.insumos || []).length > 0 && <Badge color="blue">{ref.insumos.length} insumos</Badge>}
            {(ref.operaciones || []).length > 0 && <Badge color="yellow">SAM {(ref.operaciones || []).reduce((a, o) => a + o.sam, 0).toFixed(1)} min</Badge>}
          </div>
        </Glass>
      ))}
      {filtradas.length === 0 && <Glass style={{ padding: 24, textAlign: "center" }}><p style={{ color: T.muted, fontFamily: T.mono, fontSize: 12 }}>No se encontraron fichas técnicas</p></Glass>}
    </div>
  );

  // ── VISTA FORM ──
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => { setVista("lista"); setRefSel(null); }} style={{ color: T.yellow, fontFamily: T.mono, fontSize: 12, background: "none", border: "none", cursor: "pointer", fontWeight: 700 }}>← VOLVER</button>
          <p style={{ fontSize: 13, fontWeight: 900, color: T.text, fontFamily: T.font }}>{refSel ? (form.nombre || "EDITAR FICHA") : "NUEVA FICHA TÉCNICA"}</p>
        </div>
        {refSel && <span style={{ fontSize: 10, fontFamily: T.mono, fontWeight: 700, color: eColor(form.estado), border: "1px solid " + eColor(form.estado) + "55", padding: "3px 10px", borderRadius: 10 }}>{form.estado}{form.estado === "En Prototipo" ? " P" + form.numPrototipo : ""}</span>}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: 3, overflowX: "auto", gap: 2 }}>
        {TABS_FORM.map(t => (
          <button key={t.id} onClick={() => setTabForm(t.id)}
            style={{ flex: 1, padding: "7px 4px", fontSize: 10, fontWeight: 800, fontFamily: T.mono, background: tabForm === t.id ? "rgba(255,255,255,0.1)" : "transparent", color: tabForm === t.id ? T.yellow : T.muted, border: "none", borderRadius: 8, cursor: "pointer", whiteSpace: "nowrap" }}>
            {t.label.toUpperCase()}
          </button>
        ))}
      </div>

      {/* TAB: Info */}
      {tabForm === "info" && (
        <Glass style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div><p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, marginBottom: 4 }}>CÓDIGO / REFERENCIA *</p><input value={form.nombre} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))} placeholder="Ej: CAMISA-001" style={INP} maxLength={50} /></div>
            <div><p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, marginBottom: 4 }}>DESCRIPCIÓN</p><input value={form.descripcion} onChange={e => setForm(p => ({ ...p, descripcion: e.target.value }))} placeholder="Ej: Camisa manga larga" style={INP} maxLength={100} /></div>
            <div><p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, marginBottom: 4 }}>CLIENTE / DESTINO</p><input value={form.cliente} onChange={e => setForm(p => ({ ...p, cliente: e.target.value }))} placeholder="Ej: Almacenes Éxito" style={INP} maxLength={80} /></div>
            <div><p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, marginBottom: 4 }}>TEMPORADA</p><input value={form.temporada} onChange={e => setForm(p => ({ ...p, temporada: e.target.value }))} placeholder="Ej: 2026-1" style={INP} maxLength={20} /></div>
          </div>
          <div>
            <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, letterSpacing: "0.12em", marginBottom: 6 }}>TALLAS *</p>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {TALLAS_DISPONIBLES.map(t => (
                <button key={t} onClick={() => toggleTalla(t)}
                  style={{ padding: "6px 14px", background: form.tallas.includes(t) ? "rgba(0,255,136,0.15)" : "rgba(255,255,255,0.04)", border: "1px solid " + (form.tallas.includes(t) ? T.green : T.border), borderRadius: 20, color: form.tallas.includes(t) ? T.green : T.muted, fontFamily: T.mono, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          {form.fechaCreacion && <p style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>Creada: {form.fechaCreacion}{form.fechaAprobacion ? " · Aprobada: " + form.fechaAprobacion : ""}{form.fechaLiberacion ? " · Liberada: " + form.fechaLiberacion : ""}</p>}
        </Glass>
      )}

      {/* TAB: Insumos */}
      {tabForm === "insumos" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Glass style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ fontSize: 10, color: T.cyan, fontFamily: T.mono }}>{editInsumoIdx !== null ? "EDITANDO INSUMO" : "AGREGAR INSUMO"}</p>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 2fr 1fr 1fr auto", gap: 6 }}>
              <input value={insumoForm.material} onChange={e => setInsumoForm(p => ({ ...p, material: e.target.value }))} placeholder="Material (Tela, Hilo, Botón...)" style={INP} maxLength={60} />
              <input value={insumoForm.referencia} onChange={e => setInsumoForm(p => ({ ...p, referencia: e.target.value }))} placeholder="Referencia / Color / Tipo" style={INP} maxLength={60} />
              <select value={insumoForm.unidad} onChange={e => setInsumoForm(p => ({ ...p, unidad: e.target.value }))} style={INP}>{UNIDADES_INS.map(u => <option key={u}>{u}</option>)}</select>
              <input type="number" value={insumoForm.consumo} onChange={e => setInsumoForm(p => ({ ...p, consumo: e.target.value }))} placeholder="Consumo" min={0} step={0.01} style={INP} />
              <button onClick={agregarInsumo} style={{ padding: "8px 12px", background: T.cyan, color: "#000", border: "none", borderRadius: 6, fontFamily: T.mono, fontWeight: 900, fontSize: 13, cursor: "pointer" }}>{editInsumoIdx !== null ? "✓" : "+"}</button>
            </div>
            {editInsumoIdx !== null && <button onClick={() => { setEditInsumoIdx(null); setInsumoForm({ material: "", referencia: "", unidad: "m", consumo: "" }); }} style={{ alignSelf: "flex-start", background: "transparent", border: "1px solid " + T.border, color: T.muted, fontFamily: T.mono, fontSize: 10, padding: "4px 10px", cursor: "pointer", borderRadius: 6 }}>CANCELAR</button>}
          </Glass>
          {form.insumos.length === 0
            ? <Glass style={{ padding: 16, textAlign: "center" }}><p style={{ fontSize: 11, color: T.muted, fontFamily: T.mono }}>Sin insumos — agrega telas, hilos, botones, cremalleras, etc.</p></Glass>
            : <Glass style={{ padding: 0, overflow: "hidden" }}>
                <div style={{ display: "grid", gridTemplateColumns: "2fr 2fr 1fr 1fr auto", padding: "8px 14px", background: "rgba(255,255,255,0.03)", borderBottom: "1px solid " + T.border }}>
                  {["MATERIAL","REFERENCIA","UNIDAD","CONSUMO",""].map(h => <p key={h} style={{ fontSize: 9, color: T.muted, fontFamily: T.mono }}>{h}</p>)}
                </div>
                {form.insumos.map((ins, idx) => (
                  <div key={idx} style={{ display: "grid", gridTemplateColumns: "2fr 2fr 1fr 1fr auto", padding: "10px 14px", borderBottom: "1px solid " + T.border, alignItems: "center" }}>
                    <p style={{ fontSize: 12, color: T.text }}>{ins.material}</p>
                    <p style={{ fontSize: 11, color: T.muted, fontFamily: T.mono }}>{ins.referencia || "—"}</p>
                    <p style={{ fontSize: 11, color: T.muted, fontFamily: T.mono }}>{ins.unidad}</p>
                    <p style={{ fontSize: 12, color: T.yellow, fontFamily: T.mono }}>{ins.consumo}</p>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button onClick={() => editarInsumo(idx)} style={{ background: "transparent", border: "1px solid #4499ff", color: "#4499ff", borderRadius: 6, width: 26, height: 26, cursor: "pointer", fontSize: 11 }}>✎</button>
                      <button onClick={() => setForm(p => ({ ...p, insumos: p.insumos.filter((_, i) => i !== idx) }))} style={{ background: "transparent", border: "1px solid rgba(255,0,68,0.3)", color: T.red, borderRadius: 6, width: 26, height: 26, cursor: "pointer", fontSize: 12 }}>✕</button>
                    </div>
                  </div>
                ))}
              </Glass>
          }
        </div>
      )}

      {/* TAB: Corte */}
      {tabForm === "corte" && (
        <Glass style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div><p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, marginBottom: 4 }}>DIRECCIÓN DE CORTE</p><select value={form.corte.direccion} onChange={e => setForm(p => ({ ...p, corte: { ...p.corte, direccion: e.target.value } }))} style={INP}>{DIRS_CORTE.map(d => <option key={d}>{d}</option>)}</select></div>
            <div><p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, marginBottom: 4 }}>TIPO DE TENDIDO</p><select value={form.corte.tendido} onChange={e => setForm(p => ({ ...p, corte: { ...p.corte, tendido: e.target.value } }))} style={INP}>{TIPOS_TENDIDO.map(t => <option key={t}>{t}</option>)}</select></div>
          </div>
          {form.tallas.length > 0 ? (
            <div>
              <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, marginBottom: 8 }}>CONSUMO DE TELA PRINCIPAL POR TALLA (metros)</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(90px,1fr))", gap: 8 }}>
                {form.tallas.map(t => (
                  <div key={t}>
                    <p style={{ fontSize: 9, color: T.amber, fontFamily: T.mono, marginBottom: 3, textAlign: "center" }}>{t}</p>
                    <input type="number" value={form.corte.consumoPorTalla[t] || ""}
                      onChange={e => setForm(p => ({ ...p, corte: { ...p.corte, consumoPorTalla: { ...p.corte.consumoPorTalla, [t]: parseFloat(e.target.value) || 0 } } }))}
                      placeholder="0.00" min={0} step={0.01} style={{ ...INP, textAlign: "center", padding: "8px 4px" }} />
                  </div>
                ))}
              </div>
            </div>
          ) : <p style={{ fontSize: 11, color: T.muted, fontFamily: T.mono }}>Selecciona las tallas en la pestaña Info para configurar consumo por talla.</p>}
          <div>
            <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, marginBottom: 4 }}>NOTAS DE CORTE</p>
            <textarea value={form.corte.notas} onChange={e => setForm(p => ({ ...p, corte: { ...p.corte, notas: e.target.value } }))} placeholder="Instrucciones especiales, tolerancias, marcada, etc." rows={3} style={{ ...INP, resize: "vertical", fontFamily: T.mono, fontSize: 12, lineHeight: 1.5 }} maxLength={500} />
          </div>
        </Glass>
      )}

      {/* TAB: Operaciones */}
      {tabForm === "operaciones" && (
        <Glass style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={{ fontSize: 11, color: T.yellow, fontFamily: T.mono, letterSpacing: "0.12em" }}>SECUENCIA DE OPERACIONES DE CONFECCIÓN</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div style={{ flex: 3, minWidth: 140 }}><p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, marginBottom: 4 }}>OPERACIÓN</p><input value={opForm.operacion} onChange={e => setOpForm(p => ({ ...p, operacion: e.target.value }))} onKeyDown={e => e.key === "Enter" && agregarOp()} placeholder="Ej: Costura de hombros" style={INP} maxLength={80} /></div>
            <div style={{ flex: 1, minWidth: 80 }}><p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, marginBottom: 4 }}>SAM (min)</p><input type="number" value={opForm.sam} onChange={e => setOpForm(p => ({ ...p, sam: e.target.value }))} onKeyDown={e => e.key === "Enter" && agregarOp()} placeholder="0.0" min={0.1} step={0.1} style={INP} /></div>
            <div style={{ flex: 2, minWidth: 120 }}><p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, marginBottom: 4 }}>MÁQUINA</p>
              <select value={opForm.maquina} onChange={e => { if (e.target.value === "__nueva__") setShowNuevaMaquina(true); else { setOpForm(p => ({ ...p, maquina: e.target.value })); setShowNuevaMaquina(false); } }} style={INP}>
                <option value="">— Sin máquina —</option>
                {maquinas.map(m => <option key={m.id} value={m.nombre}>{m.nombre}</option>)}
                <option value="__nueva__">+ Nueva máquina</option>
              </select>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end" }}><button onClick={agregarOp} style={{ padding: "8px 16px", background: T.green, color: "#000", border: "none", borderRadius: 6, fontFamily: T.mono, fontWeight: 900, fontSize: 13, cursor: "pointer" }}>+</button></div>
          </div>
          {showNuevaMaquina && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", background: "rgba(0,255,136,0.05)", border: "1px solid rgba(0,255,136,0.2)", borderRadius: 8, padding: "10px 12px" }}>
              <input value={nuevaMaquinaInput} onChange={e => setNuevaMaquinaInput(e.target.value)} onKeyDown={e => e.key === "Enter" && guardarNuevaMaquina()} placeholder="Nombre de la nueva máquina" style={{ ...INP, flex: 1 }} autoFocus />
              <button onClick={guardarNuevaMaquina} disabled={guardandoMaquina} style={{ padding: "8px 14px", background: T.green, color: "#000", border: "none", borderRadius: 6, fontFamily: T.mono, fontWeight: 900, fontSize: 12, cursor: "pointer" }}>{guardandoMaquina ? "..." : "GUARDAR"}</button>
              <button onClick={() => { setShowNuevaMaquina(false); setNuevaMaquinaInput(""); }} style={{ padding: "8px 12px", background: "transparent", border: "1px solid " + T.border, color: T.muted, borderRadius: 6, fontFamily: T.mono, fontSize: 12, cursor: "pointer" }}>CANCELAR</button>
            </div>
          )}
          {form.operaciones.length === 0
            ? <p style={{ fontSize: 11, color: T.faint, fontFamily: T.mono, textAlign: "center", padding: 12 }}>Sin operaciones — agrega la primera arriba</p>
            : <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {form.operaciones.map((op, idx) => (
                  <div key={idx} draggable={editandoIdx !== idx}
                    onDragStart={() => { setDraggingIdx(idx); setDragOverIdx(null); }}
                    onDragOver={e => { e.preventDefault(); setDragOverIdx(idx); }}
                    onDrop={() => handleDrop(idx)}
                    onDragEnd={() => { setDraggingIdx(null); setDragOverIdx(null); }}
                    style={{ background: dragOverIdx === idx ? "rgba(255,230,0,0.08)" : "rgba(255,255,255,0.03)", border: "1px solid " + (dragOverIdx === idx ? T.yellow : editandoIdx === idx ? T.yellow : T.border), borderRadius: 8, padding: "10px 12px", display: "flex", alignItems: "center", gap: 8, opacity: draggingIdx === idx ? 0.4 : 1, transition: "all 0.15s" }}>
                    <span style={{ fontSize: 14, color: T.faint, cursor: "grab", userSelect: "none" }}>⠿</span>
                    <span style={{ fontSize: 11, color: T.muted, fontFamily: T.mono, width: 20, textAlign: "center" }}>{idx + 1}</span>
                    {editandoIdx === idx ? (
                      <div style={{ flex: 1, display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <input value={editOpForm.operacion} onChange={e => setEditOpForm(p => ({ ...p, operacion: e.target.value }))} onKeyDown={e => e.key === "Enter" && guardarEditOp(idx)} style={{ ...INP, flex: 3, minWidth: 100, padding: "4px 8px", fontSize: 12 }} autoFocus />
                        <input type="number" value={editOpForm.sam} onChange={e => setEditOpForm(p => ({ ...p, sam: e.target.value }))} placeholder="SAM" style={{ ...INP, flex: 1, minWidth: 60, padding: "4px 8px", fontSize: 12 }} />
                        <select value={editOpForm.maquina} onChange={e => setEditOpForm(p => ({ ...p, maquina: e.target.value }))} style={{ ...INP, flex: 2, minWidth: 100, padding: "4px 8px", fontSize: 12 }}>
                          <option value="">— Sin máquina —</option>
                          {maquinas.map(m => <option key={m.id} value={m.nombre}>{m.nombre}</option>)}
                        </select>
                        <button onClick={() => guardarEditOp(idx)} style={{ background: T.green, color: "#000", border: "none", borderRadius: 6, width: 28, height: 28, cursor: "pointer", fontSize: 13, fontWeight: 900 }}>✓</button>
                        <button onClick={() => setEditandoIdx(null)} style={{ background: "transparent", border: "1px solid " + T.border, color: T.muted, borderRadius: 6, width: 28, height: 28, cursor: "pointer", fontSize: 12 }}>✕</button>
                      </div>
                    ) : (
                      <>
                        <div style={{ flex: 1 }}>
                          <p style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{op.operacion}</p>
                          <div style={{ display: "flex", gap: 10 }}>
                            <p style={{ fontSize: 10, color: T.yellow, fontFamily: T.mono }}>SAM: {op.sam} min</p>
                            {op.maquina && <p style={{ fontSize: 10, color: T.cyan, fontFamily: T.mono }}>⚙ {op.maquina}</p>}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button onClick={() => iniciarEditOp(idx)} style={{ background: "transparent", border: "1px solid #4499ff", color: "#4499ff", borderRadius: 6, width: 28, height: 28, cursor: "pointer", fontSize: 11 }}>✎</button>
                          <button onClick={() => setForm(p => ({ ...p, operaciones: p.operaciones.filter((_, i) => i !== idx) }))} style={{ background: "transparent", border: "1px solid rgba(255,0,68,0.3)", color: T.red, borderRadius: 6, width: 28, height: 28, cursor: "pointer", fontSize: 12 }}>✕</button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
                <div style={{ background: "rgba(255,230,0,0.06)", border: "1px solid rgba(255,230,0,0.2)", borderRadius: 8, padding: "8px 12px", display: "flex", justifyContent: "space-between" }}>
                  <p style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>{form.operaciones.length} operaciones</p>
                  <p style={{ fontSize: 10, color: T.yellow, fontFamily: T.mono }}>SAM total: {form.operaciones.reduce((a, o) => a + o.sam, 0).toFixed(1)} min</p>
                </div>
              </div>
          }
        </Glass>
      )}

      {/* TAB: Prototipo */}
      {tabForm === "prototipo" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Glass style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
              <div>
                <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, marginBottom: 4 }}>ESTADO ACTUAL</p>
                <p style={{ fontSize: 18, fontWeight: 900, color: eColor(form.estado), fontFamily: T.font }}>{form.estado}{form.estado === "En Prototipo" ? " · P" + form.numPrototipo : ""}</p>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {form.estado === "Borrador" && refSel && <button onClick={() => setShowProtoModal("iniciar")} style={{ padding: "8px 14px", background: T.yellow, color: "#000", border: "none", borderRadius: 8, fontFamily: T.mono, fontWeight: 900, fontSize: 11, cursor: "pointer" }}>INICIAR PROTOTIPO 1</button>}
                {form.estado === "En Prototipo" && <>
                  <button onClick={() => setShowProtoModal("aprobar")} style={{ padding: "8px 14px", background: T.green, color: "#000", border: "none", borderRadius: 8, fontFamily: T.mono, fontWeight: 900, fontSize: 11, cursor: "pointer" }}>✓ APROBAR P{form.numPrototipo}</button>
                  <button onClick={() => setShowProtoModal("rechazar")} style={{ padding: "8px 14px", background: "transparent", color: T.red, border: "1px solid " + T.red, borderRadius: 8, fontFamily: T.mono, fontWeight: 900, fontSize: 11, cursor: "pointer" }}>✕ NUEVO PROTOTIPO</button>
                </>}
                {form.estado === "Aprobada" && <button onClick={() => setShowProtoModal("liberar")} style={{ padding: "8px 14px", background: T.green, color: "#000", border: "none", borderRadius: 8, fontFamily: T.mono, fontWeight: 900, fontSize: 11, cursor: "pointer" }}>🚀 LIBERAR PARA PRODUCCIÓN</button>}
                {form.estado === "Liberada" && <span style={{ fontSize: 11, color: T.green, fontFamily: T.mono }}>✓ Disponible para órdenes de producción</span>}
              </div>
            </div>
            {!refSel && form.estado === "Borrador" && <p style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>Guarda la ficha primero para poder gestionar prototipos.</p>}
          </Glass>
          {showProtoModal && (
            <Glass style={{ padding: 16, border: "1px solid " + T.yellow + "55", display: "flex", flexDirection: "column", gap: 10 }}>
              <p style={{ fontSize: 12, fontWeight: 800, color: T.yellow, fontFamily: T.mono }}>
                {{ iniciar: "INICIAR PROTOTIPO " + ((form.numPrototipo || 0) + 1), aprobar: "APROBAR PROTOTIPO " + form.numPrototipo, rechazar: "RECHAZAR — NUEVO PROTOTIPO " + ((form.numPrototipo || 0) + 1), liberar: "LIBERAR PARA PRODUCCIÓN" }[showProtoModal]}
              </p>
              {showProtoModal !== "liberar" && <>
                <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono }}>OBSERVACIONES</p>
                <textarea value={notaProto} onChange={e => setNotaProto(e.target.value)} placeholder="Describe cambios, ajustes o razón de la decisión..." rows={2} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", padding: "8px 10px", color: T.text, fontSize: 12, outline: "none", fontFamily: T.mono, width: "100%", borderRadius: 6, resize: "vertical", boxSizing: "border-box" }} />
              </>}
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={ejecutarProto} style={{ flex: 1, padding: "10px 0", background: showProtoModal === "rechazar" ? T.red : T.green, color: "#000", border: "none", fontFamily: T.mono, fontWeight: 900, cursor: "pointer", borderRadius: 8 }}>CONFIRMAR</button>
                <button onClick={() => { setShowProtoModal(null); setNotaProto(""); }} style={{ padding: "10px 16px", background: "transparent", color: T.muted, border: "1px solid " + T.border, fontFamily: T.mono, cursor: "pointer", borderRadius: 8 }}>CANCELAR</button>
              </div>
            </Glass>
          )}
          <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, letterSpacing: "0.12em" }}>HISTORIAL</p>
          {form.historial.length === 0
            ? <Glass style={{ padding: 16, textAlign: "center" }}><p style={{ fontSize: 11, color: T.muted, fontFamily: T.mono }}>Sin prototipos registrados aún</p></Glass>
            : [...form.historial].reverse().map((h, idx) => (
                <Glass key={idx} style={{ padding: "12px 16px", borderLeft: "3px solid " + (h.aprobado ? T.green : T.red) }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <p style={{ fontSize: 12, fontWeight: 800, color: h.aprobado ? T.green : T.red, fontFamily: T.mono }}>{h.aprobado ? "✓ APROBADO" : "✕ NO APROBADO"} — Prototipo {h.numero}</p>
                    <p style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>{h.fecha}</p>
                  </div>
                  <p style={{ fontSize: 11, color: T.muted, fontFamily: T.mono }}>{h.observaciones}</p>
                </Glass>
              ))
          }
        </div>
      )}

      {errForm && <p style={{ color: T.red, fontSize: 12, fontFamily: T.mono, textAlign: "center" }}>⚠ {errForm}</p>}

      <button onClick={guardar} disabled={form.estado === "Liberada"}
        style={{ padding: "14px 0", background: form.estado === "Liberada" ? "rgba(255,255,255,0.06)" : T.green, color: form.estado === "Liberada" ? T.muted : "#000", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 900, fontFamily: T.font, cursor: form.estado === "Liberada" ? "not-allowed" : "pointer" }}>
        {form.estado === "Liberada" ? "FICHA LIBERADA — SOLO LECTURA" : refSel ? "GUARDAR CAMBIOS" : "CREAR FICHA TÉCNICA"}
      </button>
    </div>
  );
};

// ─── GESTIÓN DE USUARIOS ──────────────────────────────────────────────────────

const GestionUsuarios = ({ usuarios, setUsuarios, sesion }) => {
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ nombre: "", usuario: "", clave: "", rol: "OPERARIO", modulo: "" });
  const [err, setErr] = useState("");
  const [resetandoClave, setResetandoClave] = useState(null);
  const [nuevaClave, setNuevaClave] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetErr, setResetErr] = useState("");
  const [confirmEliminar, setConfirmEliminar] = useState(null);

  const eliminar = async (id) => {
    const { error } = await supabase.from("usuarios").delete().eq("id", id);
    if (!error) setUsuarios(prev => prev.filter(u => u.id !== id));
    setConfirmEliminar(null);
  };

  const abrir = (u = null) => {
    setForm(u ? { nombre: u.nombre, usuario: u.usuario, clave: "", rol: u.rol, modulo: u.modulo || "" } : { nombre: "", usuario: "", clave: "", rol: "OPERARIO", modulo: "" });
    setEditId(u ? u.id : null);
    setErr("");
    setShowForm(true);
  };

  const guardar = async () => {
    if (!form.nombre.trim()) { setErr("Nombre requerido"); return; }
    if (!form.usuario.trim()) { setErr("Usuario requerido"); return; }
    if (!editId && (!form.clave.trim() || form.clave.length < 4)) { setErr("Clave mínimo 4 caracteres"); return; }
    if (editId && form.clave.trim() && form.clave.length < 4) { setErr("Clave mínimo 4 caracteres"); return; }
    const u = sanitizar(form.usuario).toLowerCase();
    if (!editId && usuarios.find(x => x.usuario === u)) { setErr("Usuario ya existe"); return; }
    if (editId) {
      const usuarioActual = usuarios.find(x => x.id === editId);
      const nuevaClaveHash = form.clave.trim() ? await hashClave(sanitizar(form.clave), u) : usuarioActual?.clave;
      const campos = { nombre: sanitizar(form.nombre), usuario: u, clave: nuevaClaveHash, rol: form.rol, modulo: form.modulo };
      const { error } = await supabase.from("usuarios").update(campos).eq("id", editId);
      if (error) { setErr("Error al guardar: " + error.message); return; }
      setUsuarios(prev => prev.map(x => x.id !== editId ? x : { ...x, ...campos, hashPendiente: false }));
    } else {
      const hash = await hashClave(sanitizar(form.clave), u);
      const id = "U" + Date.now();
      const nuevoUsuario = { id, nombre: sanitizar(form.nombre), usuario: u, clave: hash, rol: form.rol, modulo: form.modulo, activo: true, hashPendiente: false };
      const { error } = await supabase.from("usuarios").insert({ id, nombre: nuevoUsuario.nombre, usuario: u, clave: hash, rol: form.rol, modulo: form.modulo, activo: true });
      if (error) { setErr("Error al guardar: " + error.message); return; }
      setUsuarios(prev => [...prev, nuevoUsuario]);
    }
    setShowForm(false);
  };

  const resetClave = async () => {
    if (!nuevaClave.trim() || nuevaClave.length < 4) return;
    const u = usuarios.find(x => x.id === resetandoClave);
    if (!u) return;
    setResetErr("");
    const hash = await hashClave(sanitizar(nuevaClave), u.usuario);
    const { error } = await supabase.from("usuarios").update({ clave: hash }).eq("id", u.id);
    if (error) { setResetErr("Error: " + error.message); return; }
    setUsuarios(prev => prev.map(x => x.id !== resetandoClave ? x : { ...x, clave: hash }));
    setResetandoClave(null);
    setNuevaClave("");
    setResetErr("");
    setConfirmReset(true);
    setTimeout(() => setConfirmReset(false), 3000);
  };

  const INP = { background: "rgba(255,255,255,0.05)", border: "1px solid " + T.border, padding: "10px 12px", color: T.text, fontSize: 13, outline: "none", fontFamily: T.font, width: "100%", borderRadius: 6 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <p style={{ fontSize: 10, color: T.muted, fontFamily: T.mono, letterSpacing: "0.14em" }}>GESTIÓN DE USUARIOS</p>
        <button onClick={() => abrir()} style={{ background: T.yellow, color: "#000", fontFamily: T.mono, fontWeight: 900, fontSize: 11, padding: "7px 14px", border: "none", cursor: "pointer" }}>+ NUEVO</button>
      </div>

      {confirmReset && (
        <div style={{ background: "rgba(0,255,136,0.1)", border: "1px solid " + T.green, borderRadius: 8, padding: "10px 14px" }}>
          <p style={{ fontSize: 12, color: T.green, fontFamily: T.mono }}>✓ Clave actualizada correctamente</p>
        </div>
      )}

      {showForm && (
        <Glass style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={{ fontSize: 11, color: T.yellow, fontFamily: T.mono }}>{editId ? "EDITAR USUARIO" : "NUEVO USUARIO"}</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <input placeholder="Nombre" value={form.nombre} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))} style={INP} maxLength={60} />
            <input placeholder="Usuario" value={form.usuario} onChange={e => setForm(p => ({ ...p, usuario: e.target.value }))} style={INP} maxLength={30} />
            <input type="password" placeholder={editId ? "Nueva clave (opcional)" : "Clave"} value={form.clave} onChange={e => setForm(p => ({ ...p, clave: e.target.value }))} style={INP} />
            <select value={form.rol} onChange={e => setForm(p => ({ ...p, rol: e.target.value }))} style={INP}>
              {Object.keys(ROLES).map(r => <option key={r} value={r}>{ROLES[r].label}</option>)}
            </select>
            <select value={form.modulo} onChange={e => setForm(p => ({ ...p, modulo: e.target.value }))} style={{ ...INP, gridColumn: "1 / -1" }}>
              <option value="">Sin módulo</option>
              {MODULOS.map(m => <option key={m}>{m}</option>)}
            </select>
          </div>
          {editId && <p style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>💡 Deja la clave vacía para mantener la actual</p>}
          {err && <p style={{ color: T.red, fontSize: 12, fontFamily: T.mono }}>⚠ {err}</p>}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={guardar} style={{ flex: 1, padding: "10px 0", background: T.green, color: "#000", border: "none", fontFamily: T.mono, fontWeight: 900, cursor: "pointer" }}>GUARDAR</button>
            <button onClick={() => setShowForm(false)} style={{ padding: "10px 16px", background: "transparent", color: T.muted, border: "1px solid " + T.border, fontFamily: T.mono, cursor: "pointer" }}>CANCELAR</button>
          </div>
        </Glass>
      )}

      {/* Modal reset clave */}
      {resetandoClave && (
        <Glass style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10, border: "1px solid " + T.yellow }}>
          <p style={{ fontSize: 11, color: T.yellow, fontFamily: T.mono }}>🔑 RESETEAR CLAVE — {usuarios.find(u => u.id === resetandoClave)?.nombre}</p>
          <input type="password" placeholder="Nueva clave (mínimo 4 caracteres)" value={nuevaClave} onChange={e => { setNuevaClave(e.target.value); setResetErr(""); }}
            onKeyDown={e => e.key === "Enter" && resetClave()} style={INP} autoFocus />
          {resetErr && <p style={{ color: T.red, fontSize: 11, fontFamily: T.mono }}>⚠ {resetErr}</p>}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={resetClave} disabled={nuevaClave.length < 4}
              style={{ flex: 1, padding: "10px 0", background: nuevaClave.length >= 4 ? T.yellow : "rgba(255,255,255,0.05)", color: nuevaClave.length >= 4 ? "#000" : T.muted, border: "none", fontFamily: T.mono, fontWeight: 900, cursor: "pointer" }}>
              CONFIRMAR RESET
            </button>
            <button onClick={() => { setResetandoClave(null); setNuevaClave(""); setResetErr(""); }}
              style={{ padding: "10px 16px", background: "transparent", color: T.muted, border: "1px solid " + T.border, fontFamily: T.mono, cursor: "pointer" }}>
              CANCELAR
            </button>
          </div>
        </Glass>
      )}

      {usuarios.map(u => (
        <Glass key={u.id} style={{ padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: ROLES[u.rol]?.color + "33", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 900, color: ROLES[u.rol]?.color }}>
              {u.nombre.charAt(0)}
            </div>
            <div>
              <p style={{ fontSize: 13, fontWeight: 700, color: u.activo ? T.text : T.muted, fontFamily: T.font }}>{u.nombre}</p>
              <p style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>{u.usuario} · {ROLES[u.rol]?.label} {u.modulo ? "· " + u.modulo : ""}</p>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
            <Badge color={u.activo ? "green" : "gray"}>{u.activo ? "Activo" : "Inactivo"}</Badge>
            {sesion?.id !== u.id && sesion?.rol === "ADMIN" && (
              <button onClick={() => { setResetandoClave(u.id); setShowForm(false); }}
                style={{ background: "transparent", border: "1px solid " + T.yellow, color: T.yellow, fontFamily: T.mono, fontSize: 10, padding: "4px 8px", cursor: "pointer" }}>
                🔑 Clave
              </button>
            )}
            {sesion?.id !== u.id && (
              <button onClick={async () => {
                const nuevoActivo = !u.activo;
                setUsuarios(prev => prev.map(x => x.id !== u.id ? x : { ...x, activo: nuevoActivo }));
                await supabase.from("usuarios").update({ activo: nuevoActivo }).eq("id", u.id);
                if (u.auth_id) {
                  const { data: { session } } = await supabase.auth.getSession();
                  await fetch("https://vsdlmymzrerhmitbjyki.supabase.co/functions/v1/admin-usuarios", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + session?.access_token },
                    body: JSON.stringify({ accion: "toggle_activo", auth_id: u.auth_id, activo: nuevoActivo })
                  });
                }
              }}
                style={{ background: "transparent", border: "1px solid " + T.border, color: T.muted, fontFamily: T.mono, fontSize: 10, padding: "4px 8px", cursor: "pointer" }}>
                {u.activo ? "Desactivar" : "Activar"}
              </button>
            )}
            <button onClick={() => { abrir(u); setResetandoClave(null); }}
              style={{ background: "transparent", border: "1px solid " + T.border, color: T.muted, fontFamily: T.mono, fontSize: 10, padding: "4px 8px", cursor: "pointer" }}>
              Editar
            </button>
            {sesion?.id !== u.id && sesion?.rol === "ADMIN" && (
              confirmEliminar === u.id ? (
                <div style={{ display: "flex", gap: 4 }}>
                  <button onClick={() => eliminar(u.id)}
                    style={{ background: T.red, border: "none", color: "#fff", fontFamily: T.mono, fontSize: 10, padding: "4px 8px", cursor: "pointer", borderRadius: 4 }}>
                    ¿Confirmar?
                  </button>
                  <button onClick={() => setConfirmEliminar(null)}
                    style={{ background: "transparent", border: "1px solid " + T.border, color: T.muted, fontFamily: T.mono, fontSize: 10, padding: "4px 8px", cursor: "pointer" }}>
                    No
                  </button>
                </div>
              ) : (
                <button onClick={() => setConfirmEliminar(u.id)}
                  style={{ background: "transparent", border: "1px solid " + T.red, color: T.red, fontFamily: T.mono, fontSize: 10, padding: "4px 8px", cursor: "pointer" }}>
                  Eliminar
                </button>
              )
            )}
          </div>
        </Glass>
      ))}
    </div>
  );
};

// ─── REPORTE DIARIO ───────────────────────────────────────────────────────────

const ReporteDiario = ({ registrosGlobales = [], usuarios = [], ordenes = [], asignaciones = [] }) => {
  const fecha = new Date().toLocaleDateString("es-CO", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  // Producción por operaria
  const statsOperarias = usuarios.filter(u => u.rol === "OPERARIO" && u.activo).map(u => {
    const regs = registrosGlobales.filter(r => r.usuarioId === u.id && !r.esParada && !r.esDefecto);
    const paradas = registrosGlobales.filter(r => r.usuarioId === u.id && r.esParada);
    const defectos = registrosGlobales.filter(r => r.usuarioId === u.id && r.esDefecto);
    const regsValidos = regs.filter(r => r.tiempoReal !== null && r.sam !== null);
    const eficiencia = regsValidos.length > 0
      ? Math.round((regsValidos.reduce((a, r) => a + (r.sam / r.tiempoReal), 0) / regsValidos.length) * 100)
      : null;
    const minParadas = paradas.filter(r => r.duracionMin).reduce((a, r) => a + r.duracionMin, 0);
    return { ...u, uds: regs.length, paradas: paradas.length, defectos: defectos.length, eficiencia, minParadas };
  });

  // Producción por módulo
  const statsModulos = MODULOS.map(mod => {
    const ops = statsOperarias.filter(u => u.modulo === mod);
    const totalUds = ops.reduce((a, u) => a + u.uds, 0);
    const totalParadas = ops.reduce((a, u) => a + u.paradas, 0);
    const totalDefectos = ops.reduce((a, u) => a + u.defectos, 0);
    const efProm = ops.filter(u => u.eficiencia !== null).length > 0
      ? Math.round(ops.filter(u => u.eficiencia !== null).reduce((a, u) => a + u.eficiencia, 0) / ops.filter(u => u.eficiencia !== null).length)
      : null;
    return { modulo: mod, uds: totalUds, paradas: totalParadas, defectos: totalDefectos, eficiencia: efProm, operarias: ops.length };
  }).filter(m => m.uds > 0 || m.operarias > 0);

  const totalPlanta = registrosGlobales.filter(r => !r.esParada && !r.esDefecto).length;
  const totalDefectosPlanta = registrosGlobales.filter(r => r.esDefecto).length;
  const efPlanta = statsOperarias.filter(u => u.eficiencia !== null).length > 0
    ? Math.round(statsOperarias.filter(u => u.eficiencia !== null).reduce((a, u) => a + u.eficiencia, 0) / statsOperarias.filter(u => u.eficiencia !== null).length)
    : null;

  const exportarReporte = () => {
    const lineas = [
      "REPORTE DIARIO DE PRODUCCIÓN — ORIGENTEX",
      "==========================================",
      fecha,
      "",
      "RESUMEN PLANTA",
      "--------------",
      "Total producido: " + totalPlanta + " uds",
      "Defectos: " + totalDefectosPlanta + " uds",
      "Eficiencia promedio: " + (efPlanta ? efPlanta + "%" : "—"),
      "",
      "POR MÓDULO",
      "----------",
      ...statsModulos.map(m => m.modulo + ": " + m.uds + " uds · Ef: " + (m.eficiencia ? m.eficiencia + "%" : "—") + " · Defectos: " + m.defectos),
      "",
      "POR OPERARIA",
      "------------",
      ...statsOperarias.map(u => u.nombre + " (" + u.modulo + "): " + u.uds + " uds · Ef: " + (u.eficiencia ? u.eficiencia + "%" : "—") + " · Paradas: " + u.minParadas + "min · Defectos: " + u.defectos),
    ].join("\n");
    const blob = new Blob([lineas], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "reporte_diario_" + new Date().toLocaleDateString("es-CO").replace(/\//g, "-") + ".txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <p style={{ fontSize: 10, color: T.muted, fontFamily: T.mono, letterSpacing: "0.14em" }}>REPORTE DIARIO</p>
          <p style={{ fontSize: 12, color: T.muted, fontFamily: T.mono }}>{fecha}</p>
        </div>
        <button onClick={exportarReporte} style={{ background: T.yellow, color: "#000", fontFamily: T.mono, fontWeight: 900, fontSize: 11, padding: "7px 14px", border: "none", cursor: "pointer" }}>↓ EXPORTAR</button>
      </div>

      {/* KPIs planta */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        <KPI label="Total Producido" value={totalPlanta} sub="unidades hoy" color="green" />
        <KPI label="Eficiencia Planta" value={efPlanta ? efPlanta + "%" : "—"} sub="promedio operarias" color={efPlanta ? (efPlanta >= 90 ? "green" : efPlanta >= 80 ? "yellow" : "red") : "gray"} />
        <KPI label="Defectos" value={totalDefectosPlanta} sub="unidades" color={totalDefectosPlanta > 0 ? "red" : "green"} />
      </div>

      {/* Por módulo */}
      <Glass style={{ overflow: "hidden" }}>
        <div style={{ padding: "10px 14px", borderBottom: "1px solid " + T.border }}>
          <p style={{ fontSize: 10, color: T.yellow, fontFamily: T.mono, letterSpacing: "0.14em" }}>PRODUCCIÓN POR MÓDULO</p>
        </div>
        {statsModulos.length === 0 ? (
          <p style={{ fontSize: 12, color: T.muted, fontFamily: T.mono, textAlign: "center", padding: 24 }}>Sin datos del turno actual</p>
        ) : statsModulos.map(m => (
          <div key={m.modulo} style={{ padding: "10px 14px", borderBottom: "1px solid " + T.faint }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div>
                <p style={{ fontSize: 14, fontWeight: 900, color: T.text, fontFamily: T.font }}>{m.modulo}</p>
                <div style={{ display: "flex", gap: 10, marginTop: 2 }}>
                  <span style={{ fontSize: 10, color: T.green, fontFamily: T.mono }}>{m.uds} uds</span>
                  {m.defectos > 0 && <span style={{ fontSize: 10, color: T.red, fontFamily: T.mono }}>{m.defectos} defectos</span>}
                  <span style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>{m.paradas} paradas</span>
                  <span style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>{m.operarias} op.</span>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <p style={{ fontSize: 24, fontWeight: 900, color: m.eficiencia ? efColor(m.eficiencia) : T.muted, fontFamily: T.mono, lineHeight: 1 }}>
                  {m.eficiencia ? m.eficiencia + "%" : "—"}
                </p>
                <p style={{ fontSize: 8, color: T.muted, fontFamily: T.mono }}>EFICIENCIA</p>
              </div>
            </div>
            {m.eficiencia && <ProgressBar value={m.eficiencia} />}
          </div>
        ))}
      </Glass>

      {/* Por operaria */}
      <Glass style={{ overflow: "hidden" }}>
        <div style={{ padding: "10px 14px", borderBottom: "1px solid " + T.border }}>
          <p style={{ fontSize: 10, color: "#4499ff", fontFamily: T.mono, letterSpacing: "0.14em" }}>RANKING OPERARIAS</p>
        </div>
        {[...statsOperarias].sort((a, b) => (b.eficiencia || 0) - (a.eficiencia || 0)).map((u, i) => (
          <div key={u.id} style={{ padding: "10px 14px", borderBottom: "1px solid " + T.faint, display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 16, fontWeight: 900, fontFamily: T.mono, color: i === 0 ? T.yellow : i === 1 ? "#aaa" : i === 2 ? T.orange : T.muted, width: 22, textAlign: "center" }}>{i + 1}</span>
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg," + T.green + "," + T.cyan + ")", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 900, color: "#000", flexShrink: 0 }}>
              {u.nombre.charAt(0)}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: T.text, fontFamily: T.font }}>{u.nombre}</span>
                  <span style={{ fontSize: 10, color: T.muted, fontFamily: T.mono, marginLeft: 8 }}>{u.modulo}</span>
                </div>
                <span style={{ fontSize: 14, fontFamily: T.mono, fontWeight: 900, color: u.eficiencia ? efColor(u.eficiencia) : T.muted }}>{u.eficiencia ? u.eficiencia + "%" : "—"}</span>
              </div>
              {u.eficiencia && <ProgressBar value={u.eficiencia} />}
              <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                <span style={{ fontSize: 9, color: T.green, fontFamily: T.mono }}>{u.uds} uds</span>
                {u.minParadas > 0 && <span style={{ fontSize: 9, color: T.orange, fontFamily: T.mono }}>{u.minParadas}min paradas</span>}
                {u.defectos > 0 && <span style={{ fontSize: 9, color: T.red, fontFamily: T.mono }}>{u.defectos} defectos</span>}
              </div>
            </div>
          </div>
        ))}
      </Glass>
    </div>
  );
};

// ─── LOG ──────────────────────────────────────────────────────────────────────

const Log = ({ logActividad, setLogActividad }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <p style={{ fontSize: 10, color: T.muted, fontFamily: T.mono, letterSpacing: "0.14em" }}>REGISTRO DE ACTIVIDAD</p>
      <button onClick={() => setLogActividad([])} style={{ background: "transparent", border: "1px solid " + T.red, color: T.red, fontFamily: T.mono, fontSize: 10, padding: "5px 12px", cursor: "pointer" }}>LIMPIAR LOG</button>
    </div>
    {logActividad.length === 0 ? (
      <Glass style={{ padding: 24, textAlign: "center" }}>
        <p style={{ color: T.muted, fontFamily: T.mono, fontSize: 12 }}>Sin actividad registrada</p>
      </Glass>
    ) : (
      <Glass style={{ overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid " + T.border }}>
                {["Hora", "Usuario", "Rol", "Acción", "Hash"].map(h => (
                  <th key={h} style={{ padding: "8px 12px", textAlign: "left", color: T.muted, fontFamily: T.mono, fontSize: 9, letterSpacing: "0.1em" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logActividad.map((l, i) => (
                <tr key={i} style={{ borderBottom: "1px solid " + T.faint }}>
                  <td style={{ padding: "8px 12px", color: T.muted, fontFamily: T.mono }}>{l.ts}</td>
                  <td style={{ padding: "8px 12px", color: T.text, fontFamily: T.font, fontWeight: 600 }}>{l.nombre}</td>
                  <td style={{ padding: "8px 12px" }}><Badge color={l.rol === "ADMIN" ? "yellow" : l.rol === "SUPERVISOR" ? "blue" : "green"}>{l.rol}</Badge></td>
                  <td style={{ padding: "8px 12px", color: T.muted, fontFamily: T.mono, fontSize: 10 }}>{l.accion}</td>
                  <td style={{ padding: "8px 12px", color: "rgba(255,255,255,0.2)", fontFamily: T.mono, fontSize: 9 }}>{l.hash || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Glass>
    )}
  </div>
);

// ─── TABLET OPERARIO ──────────────────────────────────────────────────────────

const TabletOperario = ({ ordenes, setOrdenes, sesion, asignaciones, mensajes, setMensajes, registrosGlobales, setRegistrosGlobales, cerrarSesion, horarios, usuarios = [] }) => {
  const moduloSel = sesion?.modulo || MODULOS[0];
  const asig = asignaciones?.find(a => a.usuarioId === sesion?.id);
  const ordenSel = asig?.ordenId || "";
  const operacionesAsig = asig?.operaciones || [];
  const misMensajes = mensajes.filter(m => m.destino === "todos" || (m.destino === "modulo" && m.moduloDest === moduloSel) || (m.destino === "operario" && m.usuarioDest === sesion?.id));
  const noLeidas = misMensajes.filter(m => !m.leidoPor?.includes(sesion?.id)).length;

  // Estado del turno
  const [operacionActiva, setOperacionActiva] = useState("");
  const [registros, setRegistros] = useState([]);
  const [inicioTurno] = useState(Date.now());
  const [horaInicioTurnoReal] = useState(() => {
    // Hora programada del turno
    if (!horarios) return null;
    const inicioMin = horaAMin(horarios.turno.inicio);
    const ahora = new Date();
    const ahoraMin = ahora.getHours() * 60 + ahora.getMinutes();
    const tardanzaMin = ahoraMin - inicioMin;
    return tardanzaMin > 0 ? tardanzaMin : 0;
  });
  const [hora, setHora] = useState(new Date().toLocaleTimeString("es-CO"));
  const [cronSeg, setCronSeg] = useState(0);
  const [cronTotal, setCronTotal] = useState(0);
  const [cronIniciado, setCronIniciado] = useState(false);
  const [tallaActiva, setTallaActiva] = useState("");
  const [flash, setFlash] = useState(false);
  const [efAcumulada, setEfAcumulada] = useState(null);
  const [tallaCelebracion, setTallaCelebracion] = useState("");
  const [resumenOp, setResumenOp] = useState(null);
  const [record, setRecord] = useState(null);
  const [alertaRitmo, setAlertaRitmo] = useState(false);
  const [historialTurnos, setHistorialTurnos] = useState([]);

  // Modales
  const [verMensajes, setVerMensajes] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [showParada, setShowParada] = useState(false);
  const [showCalidad, setShowCalidad] = useState(false);
  const [showAyuda, setShowAyuda] = useState(false);
  const [showResumen, setShowResumen] = useState(false);
  const [motivoParada, setMotivoParada] = useState("");
  const [mensajeAyuda, setMensajeAyuda] = useState("");
  const [modoFocus, setModoFocus] = useState(false);

  // Config
  const [configVibracion, setConfigVibracion] = useState(true);
  const [configSonido, setConfigSonido] = useState(true);

  // Descansos
  const [estadoDescanso, setEstadoDescanso] = useState(null); // null | "aviso" | "pausado"
  const [descansoActual, setDescansoActual] = useState(null);
  const [segsDescanso, setSegsDescanso] = useState(0);
  const [descansoCompletadoInicio, setDescansoCompletadoInicio] = useState(null);
  const [confirmarVolver, setConfirmarVolver] = useState(false);

  // Derivados
  const operacionSel = operacionActiva || "";
  const unidadesHoy = registros.filter(r => !r.esParada && !r.esDefecto && r.operacion === operacionSel).length;
  const totalTurno = registros.filter(r => !r.esParada && !r.esDefecto).length;
  const paradaActiva = registros.find(r => r.esParada && r.activa) || null;
  const minutosCron = cronTotal / 60;
  const velocidad = minutosCron >= 2 ? Math.round((unidadesHoy / minutosCron) * 60) : 0;

  const samActual = ordenes.flatMap(o => o.secuencia).find(s => s.operacion === operacionSel)?.tiempo || null;
  const meta = samActual ? Math.floor(480 / samActual) : 0;
  const pctMeta = meta > 0 ? Math.min(Math.round((unidadesHoy / meta) * 100), 100) : 0;

  const ordenActualObj = ordenes.find(o => o.id === ordenSel);
  const tallaActivaObj = ordenActualObj?.tallas?.find(t => t.talla === tallaActiva) || null;
  const tallaActivaComp = tallaActivaObj ? getCompletadas(tallaActivaObj, operacionSel) : 0;
  const tallaCompleta = tallaActivaObj ? tallaActivaComp >= tallaActivaObj.cantidad : false;

  // Racha
  const rachaActual = (() => {
    if (!samActual) return 0;
    const regs = registros.filter(r => !r.esParada && !r.esDefecto && r.operacion === operacionSel && r.tiempoReal !== null);
    let count = 0;
    for (const r of regs) { if (r.tiempoReal <= samActual) count++; else break; }
    return count;
  })();

  // Promedio última hora
  const promUltimaHora = (() => {
    const hace1h = Date.now() - 3600000;
    const regs = registros.filter(r => !r.esParada && !r.esDefecto && r.operacion === operacionSel && r.tiempoReal !== null && r.id > hace1h);
    if (regs.length < 3) return null;
    const prom = regs.reduce((a, r) => a + r.tiempoReal, 0) / regs.length;
    const ef = samActual ? Math.round((samActual / prom) * 100) : null;
    return { ef, count: regs.length };
  })();

  // Proyección
  const proyeccion = (() => {
    if (!meta || !cronIniciado || velocidad === 0) return null;
    const minRestantes = 480 - Math.round((Date.now() - inicioTurno) / 60000);
    const proyectadas = unidadesHoy + Math.round((velocidad / 60) * minRestantes);
    return { proyectadas, pct: Math.min(Math.round((proyectadas / meta) * 100), 150) };
  })();

  // Color botón
  const colorBoton = (() => {
    if (!ordenSel || !operacionSel) return T.faint;
    const regs = registros.filter(r => !r.esParada && r.operacion === operacionSel && r.tiempoReal !== null);
    if (!regs.length) return tallaActiva ? T.green : T.yellow;
    const prom = regs.reduce((a, r) => a + r.tiempoReal, 0) / regs.length;
    if (!samActual) return T.green;
    const ef = Math.round((samActual / prom) * 100);
    return ef >= 90 ? T.green : ef >= 80 ? T.yellow : T.red;
  })();

  // Efectos
  useEffect(() => {
    const t = setInterval(() => {
      setHora(new Date().toLocaleTimeString("es-CO"));
      if (cronIniciado) { setCronSeg(s => s + 1); setCronTotal(s => s + 1); }
    }, 1000);
    return () => clearInterval(t);
  }, [cronIniciado]);

  const [tickEfReal, setTickEfReal] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTickEfReal(v => v + 1), 300000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!horarios) return;
    const check = () => {
      const desc = detectarDescanso(horarios, moduloSel);
      if (!desc) {
        // Fuera de ventana de descanso — limpiar todo
        if (estadoDescanso === "aviso") { setEstadoDescanso(null); setDescansoActual(null); }
        if (descansoCompletadoInicio !== null) setDescansoCompletadoInicio(null);
        return;
      }
      // Ignorar el break que el operario ya completó/saltó
      if (desc.inicio === descansoCompletadoInicio) return;

      if (desc.estado === "aviso" && estadoDescanso !== "aviso" && estadoDescanso !== "pausado") {
        setEstadoDescanso("aviso");
        setDescansoActual(desc);
        vibrar([100, 50, 100]);
      } else if (desc.estado === "activo" && estadoDescanso !== "pausado") {
        setEstadoDescanso("pausado");
        setDescansoActual(desc);
        setCronIniciado(false);
        setCronSeg(0);
        setSegsDescanso(desc.duracion * 60);
        vibrar([200, 100, 200]);
        const reg = { id: Date.now(), ts: new Date().toLocaleTimeString("es-CO"), motivo: desc.nombre, esParada: true, afectaEf: false, activa: false, tsFin: Date.now(), duracionMin: desc.duracion, usuarioId: sesion?.id, nombre: sesion?.nombre, modulo: sesion?.modulo };
        setRegistros(prev => [reg, ...prev]);
        if (setRegistrosGlobales) setRegistrosGlobales(prev => [reg, ...prev.slice(0, 499)]);
      }
    };
    check();
    const t = setInterval(check, 30000);
    return () => clearInterval(t);
  }, [horarios, moduloSel, estadoDescanso, descansoCompletadoInicio]);

  // Cuenta regresiva del descanso
  useEffect(() => {
    if (estadoDescanso !== "pausado") return;
    if (segsDescanso <= 0) return;
    const t = setInterval(() => setSegsDescanso(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [estadoDescanso, segsDescanso]);

  useEffect(() => {
    if (!samActual) { setAlertaRitmo(false); return; }
    const regs = registros.filter(r => !r.esParada && r.operacion === operacionSel && r.tiempoReal !== null).slice(0, 3);
    setAlertaRitmo(regs.length >= 3 && regs.every(r => r.tiempoReal > samActual));
  }, [registros, operacionSel, samActual]);

  // Funciones
  const tocarSonido = (tipo) => {
    if (!configSonido) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      if (tipo === "registro") {
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.05);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.15);
      } else {
        osc.frequency.setValueAtTime(523, ctx.currentTime);
        osc.frequency.setValueAtTime(659, ctx.currentTime + 0.1);
        osc.frequency.setValueAtTime(784, ctx.currentTime + 0.2);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.4);
      }
    } catch (e) {}
  };

  const vibrar = (pattern) => { if (configVibracion && navigator.vibrate) navigator.vibrate(pattern); };

  const cambiarOperacion = (op) => {
    if (operacionSel && unidadesHoy > 0) {
      setResumenOp({ operacion: operacionSel, unidades: unidadesHoy, ef: efAcumulada?.ef || null });
      setTimeout(() => setResumenOp(null), 4000);
    }
    setOperacionActiva(op);
    setCronIniciado(false); setCronSeg(0); setCronTotal(0);
    setEfAcumulada(null); setTallaCelebracion("");
  };

  const registrarUnidad = () => {
    if (!ordenSel || !operacionSel) return;
    const ordenObj = ordenes.find(o => o.id === ordenSel);
    if (ordenObj?.tallas?.length > 0 && !tallaActiva) return;
    if (tallaCompleta) return;

    vibrar(80);
    tocarSonido("registro");
    const ts = new Date().toLocaleTimeString("es-CO");
    const ahora = Date.now();

    // Tiempo real de la pieza
    const tiempoReal = cronIniciado && cronSeg > 0 ? Math.round(cronSeg / 60 * 100) / 100 : null;

    // Si el tiempo supera 3x el SAM, se descarta del cálculo de eficiencia
    const tiempoValido = tiempoReal !== null && samActual ? tiempoReal <= samActual * 3 : true;
    const tiempoParaEf = tiempoValido ? tiempoReal : null;

    setCronSeg(0);

    if (samActual && unidadesHoy >= 1) {
      const minTotales = cronTotal / 60;
      // Restar tiempo de paradas que NO afectan eficiencia
      const minParadasNoEf = registros
        .filter(r => r.esParada && !r.afectaEf && r.duracionMin)
        .reduce((a, r) => a + r.duracionMin, 0);
      const minEfectivos = Math.max(minTotales - minParadasNoEf, 0.1);
      const esperadas = minEfectivos / samActual;
      const ef = Math.round(((unidadesHoy + 1) / esperadas) * 100);
      setEfAcumulada({ ef: Math.min(ef, 200), reales: unidadesHoy + 1, esperadas: Math.round(esperadas * 10) / 10 });
    }

    const nuevasUds = unidadesHoy + 1;
    if (nuevasUds > 0 && nuevasUds % 10 === 0) { setRecord("🏆 " + nuevasUds + " unidades"); setTimeout(() => setRecord(null), 4000); }
    if (meta > 0 && nuevasUds === meta) { setRecord("🎉 META ALCANZADA"); vibrar([100,50,100,50,200]); setTimeout(() => setRecord(null), 5000); }

    const nuevoReg = { id: ahora, ts, orden: ordenSel, operacion: operacionSel, talla: tallaActiva, esParada: false, tiempoReal: tiempoParaEf, tiempoRealBruto: tiempoReal, descartado: !tiempoValido, sam: samActual, usuarioId: sesion?.id, nombre: sesion?.nombre, modulo: sesion?.modulo };
    setRegistros(prev => [nuevoReg, ...prev]);
    if (setRegistrosGlobales) setRegistrosGlobales(prev => [nuevoReg, ...prev.slice(0, 499)]);

    // Guardar en Supabase
    supabase.from("registros").insert({ id: ahora, ts, orden: ordenSel, operacion: operacionSel, talla: tallaActiva, es_parada: false, es_defecto: false, tiempo_real: tiempoParaEf, sam: samActual, usuario_id: sesion?.id, nombre: sesion?.nombre, modulo: sesion?.modulo }).then(({ error }) => { if (error) console.error("Error guardando registro:", error); });

    setOrdenes(prev => prev.map(o => {
      if (o.id !== ordenSel) return o;
      const sec = o.secuencia.map(s => {
        if (s.operacion !== operacionSel) return s;
        const nuevas = Math.min(s.completadas + 1, s.piezas);
        return { ...s, completadas: nuevas, estado: nuevas >= s.piezas ? "Completado" : "En proceso" };
      });
      const tallas = (o.tallas || []).map(t => {
        if (t.talla !== tallaActiva) return t;
        const porOp = t.completadasPorOp || {};
        const actual = porOp[operacionSel] || 0;
        const nuevas = Math.min(actual + 1, t.cantidad);
        if (nuevas >= t.cantidad && actual < t.cantidad) {
          setTimeout(() => {
            const todasCompletas = (o.tallas || []).every(tx => {
              const c = tx.completadasPorOp || {};
              return (tx.talla === t.talla ? nuevas : (c[operacionSel] || 0)) >= tx.cantidad;
            });
            if (!todasCompletas) { setTallaCelebracion(t.talla); vibrar([100,50,100,50,200]); tocarSonido("celebracion"); }
            else { setTallaCelebracion(""); vibrar([100,50,100,50,300,50,300]); tocarSonido("celebracion"); }
          }, 300);
        }
        return { ...t, completadasPorOp: { ...porOp, [operacionSel]: nuevas } };
      });
      return { ...o, secuencia: sec, tallas };
    }));

    setFlash(true);
    setTimeout(() => setFlash(false), 400);
  };

  const reanudarTurno = () => {
    const tsFin = Date.now();
    setRegistros(prev => prev.map(r =>
      r.esParada && r.activa
        ? { ...r, activa: false, tsFin, duracionMin: Math.round((tsFin - r.tsInicio) / 60000) }
        : r
    ));
    if (setRegistrosGlobales) setRegistrosGlobales(prev => prev.map(r =>
      r.esParada && r.activa && r.usuarioId === sesion?.id
        ? { ...r, activa: false, tsFin, duracionMin: Math.round((tsFin - r.tsInicio) / 60000) }
        : r
    ));
    // Actualizar parada en Supabase
    const paradaActiva = registros.find(r => r.esParada && r.activa);
    if (paradaActiva) {
      supabase.from("registros").update({ activa: false, duracion_min: Math.round((tsFin - paradaActiva.tsInicio) / 60000) }).eq("id", paradaActiva.id).then(({ error }) => { if (error) console.error("Error cerrando parada:", error); });
    }
    setCronIniciado(true);
  };

  const deshacerUltimo = () => {
    if (!registros.length) return;
    const ultimo = registros[0];
    if (!ultimo.esParada && !ultimo.esDefecto && ultimo.talla) {
      setOrdenes(prev => prev.map(o => {
        if (o.id !== ultimo.orden) return o;
        const tallas = (o.tallas || []).map(t => {
          if (t.talla !== ultimo.talla) return t;
          const porOp = t.completadasPorOp || {};
          return { ...t, completadasPorOp: { ...porOp, [ultimo.operacion]: Math.max(0, (porOp[ultimo.operacion] || 0) - 1) } };
        });
        const sec = o.secuencia.map(s => {
          if (s.operacion !== ultimo.operacion) return s;
          const n = Math.max(0, s.completadas - 1);
          return { ...s, completadas: n, estado: n >= s.piezas ? "Completado" : n > 0 ? "En proceso" : "Pendiente" };
        });
        return { ...o, tallas, secuencia: sec };
      }));
    }
    setRegistros(prev => prev.slice(1));
    vibrar([30, 20, 30]);
  };

  const registrarParada = () => {
    if (!motivoParada) return;
    const motivoObj = MOTIVOS_PARADA.find(m => m.motivo === motivoParada);
    const tsInicio = new Date().toLocaleTimeString("es-CO");
    const reg = {
      id: Date.now(),
      ts: tsInicio,
      tsInicio: Date.now(),
      tsFin: null,
      motivo: motivoParada,
      afectaEf: motivoObj?.afectaEf || false,
      esParada: true,
      activa: true,
      usuarioId: sesion?.id,
      nombre: sesion?.nombre,
      modulo: sesion?.modulo,
      orden: ordenSel,
      operacion: operacionSel,
    };
    setRegistros(prev => [reg, ...prev]);
    if (setRegistrosGlobales) setRegistrosGlobales(prev => [reg, ...prev.slice(0, 499)]);
    // Guardar parada en Supabase
    supabase.from("registros").insert({ id: reg.id, ts: reg.ts, orden: ordenSel, operacion: operacionSel, es_parada: true, es_defecto: false, motivo: motivoParada, afecta_ef: motivoObj?.afectaEf || false, activa: true, usuario_id: sesion?.id, nombre: sesion?.nombre, modulo: sesion?.modulo }).then(({ error }) => { if (error) console.error("Error guardando parada:", error); });
    setCronIniciado(false);
    setMotivoParada("");
    setShowParada(false);
  };

  const enviarAyuda = () => {
    if (!mensajeAyuda.trim()) return;
    setMensajes(prev => [{ id: Date.now(), texto: sesion?.nombre + " necesita ayuda: " + mensajeAyuda, destino: "supervisor", de: sesion?.nombre, leidoPor: [], ts: new Date().toLocaleTimeString("es-CO") }, ...prev]);
    vibrar(200);
    setMensajeAyuda(""); setShowAyuda(false);
  };

  const guardarTurno = () => {
    setHistorialTurnos(prev => [{ fecha: new Date().toLocaleDateString("es-CO"), unidades: totalTurno, ef: efAcumulada?.ef || null, operacion: operacionSel }, ...prev].slice(0, 30));
  };

  const fmtCron = (s) => String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");

  const loteCompleto = (() => {
    const orden = ordenes.find(o => o.id === ordenSel);
    if (!orden?.tallas?.length) return false;
    return orden.tallas.every(t => getCompletadas(t, operacionSel) >= t.cantidad);
  })();

  const MODAL_STYLE = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", backdropFilter: "blur(10px)", zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 16 };
  const PANEL_STYLE = { background: "#0d1117", border: "1px solid " + T.border, borderRadius: "20px 20px 16px 16px", padding: 24, width: "100%", maxWidth: 440, display: "flex", flexDirection: "column", gap: 14 };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #0a0a0f 0%, #0d0d1a 50%, #0a0f0a 100%)", display: "flex", flexDirection: "column", color: T.text, fontFamily: T.font, position: "relative" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800;900&family=Share+Tech+Mono&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        .btn-circulo { border-radius: 50% !important; }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.2} }
        @keyframes pop { 0%{transform:scale(1)} 50%{transform:scale(1.25)} 100%{transform:scale(1)} }
        @keyframes pulso-rojo { 0%,100%{box-shadow:0 0 40px #ff333399} 50%{box-shadow:0 0 60px #ff3333ff} }
        .blink { animation: blink 1.4s infinite; }
        .pop { animation: pop 0.4s ease; }
        .pulso-rojo { animation: pulso-rojo 0.8s infinite; }
      `}</style>

      {/* Header */}
      <div style={{ background: "rgba(10,10,20,0.9)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(0,255,136,0.2)", padding: "8px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, position: "sticky", top: 0, zIndex: 50 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ background: "linear-gradient(135deg, " + T.green + ", " + T.cyan + ")", width: 32, height: 32, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 900, color: "#000" }}>
            {sesion?.nombre?.charAt(0) || "?"}
          </div>
          <div>
            <p style={{ fontSize: 13, fontWeight: 900, color: T.text, lineHeight: 1.1 }}>{sesion?.nombre}</p>
            <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono }}>{moduloSel}</p>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button onClick={() => { setShowConfig(false); setVerMensajes(v => !v); }} className={noLeidas > 0 ? "blink" : ""} style={{ position: "relative", background: "transparent", border: "1px solid " + (noLeidas > 0 ? T.yellow : "#4499ff"), borderRadius: 8, padding: "7px 10px", cursor: "pointer" }}>
            <Bell size={16} color={noLeidas > 0 ? T.yellow : "#4499ff"} strokeWidth={1.5} />
            {noLeidas > 0 && <span style={{ position: "absolute", top: -4, right: -4, background: T.red, color: "#fff", fontSize: 9, fontWeight: 900, width: 16, height: 16, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: T.mono }}>{noLeidas}</span>}
          </button>
          <button onClick={() => setModoFocus(v => !v)} style={{ background: modoFocus ? "rgba(0,255,136,0.15)" : "transparent", border: "1px solid " + (modoFocus ? T.green : "#4499ff"), borderRadius: 8, padding: "7px 10px", cursor: "pointer" }}>
            <Target size={16} color={modoFocus ? T.green : "#4499ff"} strokeWidth={1.5} />
          </button>
          <button onClick={() => { setVerMensajes(false); setShowConfig(v => !v); }} style={{ background: showConfig ? "rgba(68,153,255,0.1)" : "transparent", border: "1px solid #4499ff", borderRadius: 8, padding: "7px 10px", cursor: "pointer" }}>
            <Settings size={16} color="#4499ff" strokeWidth={1.5} />
          </button>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: T.green, fontFamily: T.mono }}>{hora}</span>
            <span style={{ fontSize: 8, color: T.muted, fontFamily: T.mono }}>{Math.round((Date.now() - inicioTurno) / 60000)}min turno</span>
          </div>
          <button onClick={() => setShowResumen(true)} style={{ background: "transparent", border: "1px solid #4499ff", borderRadius: 8, color: "#4499ff", fontFamily: T.mono, fontSize: 10, padding: "6px 10px", cursor: "pointer" }}>FIN</button>
        </div>
      </div>

      {/* Aviso 2 minutos antes del descanso */}
      {estadoDescanso === "aviso" && descansoActual && (
        <div style={{ background: "rgba(255,230,0,0.08)", border: "2px solid " + T.yellow, margin: "0 14px", borderRadius: 14, padding: "16px", textAlign: "center", display: "flex", flexDirection: "column", gap: 8 }}>
          <p style={{ fontSize: 18, fontWeight: 900, color: T.yellow, fontFamily: T.font }}>
            {descansoActual.nombre === "Desayuno" ? "☕" : descansoActual.nombre === "Almuerzo" ? "🍽" : "🧘"} PRÓXIMO DESCANSO
          </p>
          <p style={{ fontSize: 14, color: T.text, fontFamily: T.font }}>
            En {descansoActual.minAntes} min — <strong>{descansoActual.nombre}</strong> ({descansoActual.duracion} min)
          </p>
          <p style={{ fontSize: 11, color: T.muted, fontFamily: T.mono }}>Termina tu pieza actual antes de que inicie</p>
        </div>
      )}

      {/* Descanso automático con cuenta regresiva */}
      {estadoDescanso === "pausado" && descansoActual && (
        <div style={{ background: "rgba(0,238,255,0.08)", border: "2px solid " + T.cyan, margin: "0 14px", borderRadius: 14, padding: "20px 16px", textAlign: "center", display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={{ fontSize: 20, fontWeight: 900, color: T.cyan, fontFamily: T.font }}>
            {descansoActual.nombre === "Desayuno" ? "☕" : descansoActual.nombre === "Almuerzo" ? "🍽" : "🧘"} {descansoActual.nombre.toUpperCase()}
          </p>
          {cronSeg > 0 && cronIniciado === false && (
            <div style={{ background: "rgba(255,230,0,0.08)", border: "1px solid rgba(255,230,0,0.3)", borderRadius: 8, padding: "8px 12px" }}>
              <p style={{ fontSize: 11, color: T.yellow, fontFamily: T.mono }}>⚠ Tenías una pieza en proceso — el tiempo se reiniciará al volver</p>
            </div>
          )}
          <p style={{ fontSize: 52, fontWeight: 900, color: segsDescanso > 60 ? T.cyan : T.red, fontFamily: T.mono, lineHeight: 1 }}>
            {String(Math.floor(segsDescanso / 60)).padStart(2, "0")}:{String(segsDescanso % 60).padStart(2, "0")}
          </p>
          <p style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>{segsDescanso <= 0 ? "Tiempo completado" : "Tiempo restante de descanso"}</p>
          {confirmarVolver ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <p style={{ fontSize: 13, color: T.yellow, fontFamily: T.mono, textAlign: "center" }}>¿Confirmas que vas a volver al turno?</p>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => {
                  const tardanza = segsDescanso < 0 ? Math.abs(Math.round(segsDescanso / 60)) : 0;
                  if (tardanza > 0) {
                    const reg = { id: Date.now(), ts: new Date().toLocaleTimeString("es-CO"), motivo: "Retorno tarde de " + descansoActual.nombre + " (" + tardanza + "min)", esParada: true, afectaEf: true, activa: false, tsFin: Date.now(), duracionMin: tardanza, usuarioId: sesion?.id, nombre: sesion?.nombre, modulo: sesion?.modulo };
                    setRegistros(prev => [reg, ...prev]);
                    if (setRegistrosGlobales) setRegistrosGlobales(prev => [reg, ...prev.slice(0, 499)]);
                  }
                  setDescansoCompletadoInicio(descansoActual.inicio);
                  setEstadoDescanso(null);
                  setDescansoActual(null);
                  setCronIniciado(false);
                  setCronSeg(0);
                  setConfirmarVolver(false);
                }} style={{ flex: 1, background: T.green, color: "#000", border: "none", borderRadius: 10, padding: "14px 0", fontSize: 15, fontWeight: 900, fontFamily: T.font, cursor: "pointer" }}>
                  SÍ, VOLVER
                </button>
                <button onClick={() => setConfirmarVolver(false)}
                  style={{ flex: 1, background: "rgba(255,255,255,0.06)", color: T.text, border: "1px solid " + T.border, borderRadius: 10, padding: "14px 0", fontSize: 15, fontWeight: 900, fontFamily: T.font, cursor: "pointer" }}>
                  CANCELAR
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setConfirmarVolver(true)}
              style={{ background: segsDescanso <= 0 ? T.green : "rgba(255,255,255,0.08)", color: segsDescanso <= 0 ? "#000" : T.text, border: "1px solid " + (segsDescanso <= 0 ? T.green : T.border), borderRadius: 10, padding: "14px 0", fontSize: 15, fontWeight: 900, fontFamily: T.font, cursor: "pointer" }}>
              VOLVER AL TURNO
            </button>
          )}
        </div>
      )}

      {/* Mensajes */}
      {verMensajes && (
        <div style={{ background: "#0d1117", border: "1px solid " + T.yellow, margin: "0 14px", padding: 14, borderRadius: "0 0 12px 12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <p style={{ fontSize: 11, fontFamily: T.mono, color: T.yellow, letterSpacing: "0.14em" }}>MENSAJES DEL SUPERVISOR</p>
            <button onClick={() => setVerMensajes(false)} style={{ background: "none", border: "none", color: T.muted, fontSize: 16, cursor: "pointer" }}>✕</button>
          </div>
          {misMensajes.length === 0
            ? <p style={{ fontSize: 12, color: T.muted, fontFamily: T.mono }}>Sin mensajes nuevos.</p>
            : misMensajes.map(m => (
              <div key={m.id} style={{ background: m.leidoPor?.includes(sesion?.id) ? "rgba(255,255,255,0.03)" : "rgba(255,230,0,0.06)", border: "1px solid " + (m.leidoPor?.includes(sesion?.id) ? T.border : T.yellow), borderRadius: 8, padding: "10px 12px", marginBottom: 8 }}>
                <p style={{ fontSize: 12, color: T.text, fontFamily: T.font }}>{m.texto}</p>
                <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, marginTop: 4 }}>{m.de} · {m.ts}</p>
                {!m.leidoPor?.includes(sesion?.id) && (
                  <button onClick={() => setMensajes(prev => prev.map(x => x.id === m.id ? { ...x, leidoPor: [...(x.leidoPor || []), sesion?.id] } : x))}
                    style={{ marginTop: 6, background: T.yellow, color: "#000", border: "none", padding: "4px 10px", fontSize: 10, fontFamily: T.mono, fontWeight: 900, cursor: "pointer", borderRadius: 4 }}>
                    ✓ LEÍDO
                  </button>
                )}
              </div>
            ))
          }
        </div>
      )}

      {/* Config */}
      {showConfig && (
        <div style={{ background: "rgba(10,10,20,0.95)", backdropFilter: "blur(20px)", border: "1px solid #4499ff44", padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={{ fontSize: 10, color: "#4499ff", fontFamily: T.mono, letterSpacing: "0.14em" }}>CONFIGURACION</p>
          {[["Vibracion al registrar", configVibracion, setConfigVibracion], ["Sonido al registrar", configSonido, setConfigSonido]].map(([label, val, set]) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 13, color: T.text, fontFamily: T.font }}>{label}</span>
              <button onClick={() => set(v => !v)} style={{ background: val ? T.green : "rgba(255,255,255,0.08)", border: "none", borderRadius: 20, width: 44, height: 24, cursor: "pointer", position: "relative" }}>
                <div style={{ width: 18, height: 18, background: "#fff", borderRadius: "50%", position: "absolute", top: 3, left: val ? 23 : 3, transition: "left 0.2s" }} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Contenido principal */}
      <div style={{ flex: 1, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 12 }}>

        {/* Indicador modo focus */}
        {modoFocus && operacionSel && (
          <div style={{ background: "rgba(0,255,136,0.08)", border: "1px solid rgba(0,255,136,0.3)", borderRadius: 10, padding: "6px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <p style={{ fontSize: 10, color: T.green, fontFamily: T.mono, letterSpacing: "0.12em" }}>🎯 FOCUS · {operacionSel}</p>
            <p style={{ fontSize: 11, fontWeight: 900, color: T.yellow, fontFamily: T.mono }}>{unidadesHoy} uds</p>
          </div>
        )}

        {/* KPI eficiencia real del módulo — actualiza cada 5min */}
        {(() => {
          void tickEfReal;
          const efMod = horarios ? calcEficienciaRealModulo(registrosGlobales || [], asignaciones || [], [sesion, ...usuarios], ordenes, horarios, moduloSel) : null;
          if (!efMod || !efMod.meta) return null;
          return (
            <div style={{ background: "rgba(0,255,136,0.06)", border: "1px solid rgba(0,255,136,0.2)", borderRadius: 12, padding: "8px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <p style={{ fontSize: 9, color: T.green, fontFamily: T.mono, letterSpacing: "0.12em" }}>FACTURABLES DEL MÓDULO</p>
                <div style={{ display: "flex", gap: 10, marginTop: 2, alignItems: "center" }}>
                  <p style={{ fontSize: 20, fontWeight: 900, color: T.green, fontFamily: T.mono, lineHeight: 1 }}>{efMod.facturables}</p>
                  {efMod.defectos > 0 && <span style={{ fontSize: 10, color: T.red, fontFamily: T.mono }}>-{efMod.defectos} def.</span>}
                  <span style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>/ {efMod.meta} meta</span>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <p style={{ fontSize: 22, fontWeight: 900, color: efMod.eficiencia ? efColor(efMod.eficiencia) : T.muted, fontFamily: T.mono, lineHeight: 1 }}>
                  {efMod.eficiencia ? efMod.eficiencia + "%" : "—"}
                </p>
                <p style={{ fontSize: 8, color: T.muted, fontFamily: T.mono }}>EF. REAL</p>
              </div>
            </div>
          );
        })()}

        {/* Banner módulo */}
        {!modoFocus && (
          <div style={{ background: "rgba(0,255,136,0.06)", border: "1px solid rgba(0,255,136,0.2)", borderRadius: 14, padding: "12px 16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <p style={{ fontSize: 9, color: T.green, fontFamily: T.mono, letterSpacing: "0.16em", marginBottom: 2 }}>MÓDULO ASIGNADO</p>
                <p style={{ fontSize: 24, fontWeight: 900, color: T.green, fontFamily: T.font, lineHeight: 1 }}>{moduloSel}</p>
              </div>
              <div style={{ textAlign: "right" }}>
                <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, marginBottom: 2 }}>REFERENCIA</p>
                <p style={{ fontSize: 14, fontWeight: 900, color: T.yellow, fontFamily: T.mono }}>{ordenActualObj?.referencia || "—"}</p>
              </div>
            </div>
            {ordenActualObj && (
              <div style={{ borderTop: "1px solid rgba(0,255,136,0.1)", paddingTop: 8, marginTop: 8, display: "flex", justifyContent: "space-between" }}>
                <p style={{ fontSize: 11, color: T.muted, fontFamily: T.font }}>{ordenActualObj.cliente} · {ordenActualObj.descripcion}</p>
                <p style={{ fontSize: 11, fontWeight: 900, fontFamily: T.mono, color: (() => { const d = Math.ceil((new Date(ordenActualObj.fechaEntrega) - new Date()) / 86400000); return d <= 7 ? T.red : d <= 14 ? T.yellow : T.green; })() }}>
                  {Math.ceil((new Date(ordenActualObj.fechaEntrega) - new Date()) / 86400000)}d
                </p>
              </div>
            )}
          </div>
        )}

        {/* Selección operación */}
        {!modoFocus && (
          operacionesAsig.length === 0 ? (
            <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid " + T.border, borderRadius: 16, padding: "32px 20px", textAlign: "center" }}>
              <p style={{ fontSize: 40 }}>⏳</p>
              <p style={{ fontSize: 18, fontWeight: 800, color: T.muted, fontFamily: T.font, marginTop: 8 }}>SIN ASIGNACIÓN</p>
              <p style={{ fontSize: 11, color: T.muted, fontFamily: T.mono, marginTop: 4 }}>Espera a que el supervisor te asigne una operación</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ background: "rgba(0,255,136,0.05)", border: "1px solid rgba(0,255,136,0.2)", borderRadius: 10, padding: "6px 12px", display: "flex", justifyContent: "space-between" }}>
                <p style={{ fontSize: 9, color: T.green, fontFamily: T.mono, letterSpacing: "0.14em" }}>ORDEN ASIGNADA</p>
                <span style={{ fontSize: 12, fontWeight: 900, color: T.yellow, fontFamily: T.mono }}>{ordenSel}</span>
              </div>
              <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, letterSpacing: "0.12em" }}>SELECCIONA OPERACIÓN:</p>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {operacionesAsig.map((op, i) => {
                  const activa = operacionSel === op;
                  const sam = ordenes.flatMap(o => o.secuencia).find(s => s.operacion === op)?.tiempo;
                  return (
                    <button key={i} onClick={() => cambiarOperacion(op)}
                      style={{ padding: "6px 14px", background: activa ? "rgba(0,255,136,0.12)" : "rgba(255,255,255,0.04)", border: "1px solid " + (activa ? T.green : "#4499ff"), borderRadius: 20, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, boxShadow: activa ? "0 0 14px rgba(0,255,136,0.3)" : "none" }}>
                      <span style={{ fontSize: 13, fontWeight: 900, color: activa ? T.green : "#4499ff", fontFamily: T.font }}>{op}</span>
                      {sam && <span style={{ fontSize: 10, color: activa ? T.green : "#4499ff", fontFamily: T.mono }}>{sam}min</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )
        )}

        {/* Panel de tallas */}
        {ordenSel && (() => {
          const orden = ordenes.find(o => o.id === ordenSel);
          const tallas = orden?.tallas || [];
          if (!tallas.length) return null;
          const tObj = tallas.find(t => t.talla === tallaActiva);
          const tComp = tObj ? getCompletadas(tObj, operacionSel) : 0;
          const pctActiva = tObj ? Math.round((tComp / tObj.cantidad) * 100) : 0;
          return (
            <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid " + T.border, borderRadius: 14, padding: "10px 14px" }}>
              <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, letterSpacing: "0.12em", marginBottom: 8 }}>AVANCE EN {operacionSel ? operacionSel.toUpperCase() : "ESTA OPERACIÓN"}</p>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {tallas.map(t => {
                  const comp = getCompletadas(t, operacionSel);
                  const pct = Math.round((comp / t.cantidad) * 100);
                  const activa = tallaActiva === t.talla;
                  return (
                    <div key={t.talla}>
                      {activa ? (
                        <div style={{ background: pct >= 100 ? "rgba(0,255,136,0.1)" : "rgba(255,255,255,0.06)", border: "1px solid " + (pct >= 100 ? T.green : T.green), borderRadius: 10, padding: "10px 14px", minWidth: 90 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                            <span style={{ fontSize: 22, fontWeight: 900, color: T.green, fontFamily: T.font }}>{t.talla}</span>
                            <span style={{ fontSize: 10, color: T.green, fontFamily: T.mono, background: "rgba(0,255,136,0.15)", padding: "1px 6px", borderRadius: 4 }}>ACTIVA</span>
                          </div>
                          <ProgressBar value={pctActiva} />
                          <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, marginTop: 4 }}>Faltan {tObj ? tObj.cantidad - tComp : 0} uds</p>
                          <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono }}>{tComp}/{tObj?.cantidad} uds</p>
                        </div>
                      ) : (
                        <button onClick={() => { setTallaActiva(t.talla); setTallaCelebracion(""); setCronSeg(0); }}
                          style={{ background: pct >= 100 ? "rgba(0,255,136,0.08)" : "rgba(255,255,255,0.04)", border: "1px solid " + (pct >= 100 ? T.green : "#4499ff"), borderRadius: 20, padding: "6px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 15, fontWeight: 900, color: pct >= 100 ? T.green : "#4499ff", fontFamily: T.font }}>{t.talla}</span>
                          <span style={{ fontSize: 10, color: pct >= 100 ? T.green : "#4499ff", fontFamily: T.mono }}>{pct}%</span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Features: racha, promedio hora, proyección */}
        {operacionSel && cronIniciado && (rachaActual >= 3 || promUltimaHora || proyeccion) && (
          <div style={{ display: "flex", gap: 8 }}>
            {rachaActual >= 3 && (
              <div style={{ flex: 1, background: "rgba(0,255,136,0.08)", border: "1px solid rgba(0,255,136,0.3)", borderRadius: 12, padding: "10px 12px", textAlign: "center" }}>
                <p style={{ fontSize: 22, fontWeight: 900, color: T.green, fontFamily: T.mono, lineHeight: 1 }}>🔥{rachaActual}</p>
                <p style={{ fontSize: 8, color: T.muted, fontFamily: T.mono, marginTop: 3 }}>RACHA</p>
              </div>
            )}
            {promUltimaHora && (
              <div style={{ flex: 1, background: "rgba(255,255,255,0.04)", border: "1px solid " + T.border, borderRadius: 12, padding: "10px 12px", textAlign: "center" }}>
                <p style={{ fontSize: 22, fontWeight: 900, fontFamily: T.mono, lineHeight: 1, color: promUltimaHora.ef ? efColor(promUltimaHora.ef) : T.muted }}>
                  {promUltimaHora.ef ? promUltimaHora.ef + "%" : "—"}
                </p>
                <p style={{ fontSize: 8, color: T.muted, fontFamily: T.mono, marginTop: 3 }}>ULT. HORA ({promUltimaHora.count})</p>
              </div>
            )}
            {proyeccion && (
              <div style={{ flex: 1, background: proyeccion.pct >= 100 ? "rgba(0,255,136,0.08)" : "rgba(255,255,255,0.04)", border: "1px solid " + (proyeccion.pct >= 100 ? "rgba(0,255,136,0.3)" : T.border), borderRadius: 12, padding: "10px 12px", textAlign: "center" }}>
                <p style={{ fontSize: 22, fontWeight: 900, fontFamily: T.mono, lineHeight: 1, color: proyeccion.pct >= 100 ? T.green : proyeccion.pct >= 80 ? T.yellow : T.red }}>{proyeccion.proyectadas}</p>
                <p style={{ fontSize: 8, color: T.muted, fontFamily: T.mono, marginTop: 3 }}>PROYECCIÓN</p>
              </div>
            )}
          </div>
        )}

        {/* Resumen al cambiar operación */}
        {resumenOp && (
          <div style={{ background: "rgba(255,230,0,0.08)", border: "1px solid rgba(255,230,0,0.3)", borderRadius: 12, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <p style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>RESUMEN — {resumenOp.operacion}</p>
              <p style={{ fontSize: 16, fontWeight: 900, color: T.yellow, fontFamily: T.font }}>{resumenOp.unidades} unidades{resumenOp.ef ? " · " + resumenOp.ef + "% ef." : ""}</p>
            </div>
            <Check size={20} color={T.yellow} strokeWidth={2} />
          </div>
        )}

        {/* Record */}
        {record && (
          <div style={{ background: "rgba(255,230,0,0.1)", border: "2px solid " + T.yellow, borderRadius: 12, padding: "12px 14px", textAlign: "center" }}>
            <p style={{ fontSize: 16, color: T.yellow, fontFamily: T.font, fontWeight: 900 }}>{record}</p>
          </div>
        )}

        {/* Botón principal */}
        <div style={{ display: "flex", justifyContent: "center", padding: "10px 0" }}>
          <button onClick={() => {
            if (estadoDescanso === "activo" || estadoDescanso === "pausado") return;
            if (!operacionSel || (!tallaActiva && ordenActualObj?.tallas?.length > 0)) return;
            if (!cronIniciado) { setCronIniciado(true); setCronSeg(0); return; }
            registrarUnidad();
          }}
            disabled={!ordenSel || !operacionSel || estadoDescanso === "activo" || estadoDescanso === "pausado" || !!paradaActiva}
            className={"btn-circulo" + (alertaRitmo && ordenSel && operacionSel ? " pulso-rojo" : "") + (flash ? " pop" : "")}
            style={{
              width: 200, height: 200,
              background: "#000",
              color: (estadoDescanso === "pausado" || paradaActiva) ? T.muted : !operacionSel ? "#4499ff" : !tallaActiva && ordenActualObj?.tallas?.length > 0 ? "#4499ff" : tallaCompleta ? T.muted : colorBoton,
              border: "4px solid " + ((estadoDescanso === "pausado" || paradaActiva) ? T.muted : !operacionSel ? "#4499ff" : !tallaActiva && ordenActualObj?.tallas?.length > 0 ? "#4499ff" : tallaCompleta ? T.muted : colorBoton),
              cursor: (!ordenSel || !operacionSel) ? "default" : "pointer",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6,
              fontFamily: T.font, fontWeight: 900, letterSpacing: "0.05em",
              boxShadow: !operacionSel || !tallaActiva ? "none" : colorBoton === T.green ? "0 0 40px rgba(0,255,136,0.5)" : colorBoton === T.yellow ? "0 0 40px rgba(255,230,0,0.5)" : "0 0 40px rgba(255,0,68,0.5)",
              transition: "border-color 0.3s, color 0.3s, box-shadow 0.3s",
            }}>
            <span style={{ fontSize: 26, textAlign: "center", lineHeight: 1.2, whiteSpace: "pre-line" }}>
              {(estadoDescanso === "activo" || estadoDescanso === "pausado") ? "EN\nDESCANSO" : paradaActiva ? "EN\nPARADA" : flash ? "REGISTRADO" : !operacionSel ? "SELECCIONA\nOPERACIÓN" : (!tallaActiva && ordenActualObj?.tallas?.length > 0) ? "SELECCIONA\nTALLA" : tallaCompleta ? "TALLA\nCOMPLETA" : !cronIniciado ? "INICIAR" : "T/" + tallaActiva}
            </span>
            {operacionSel && tallaActiva && cronIniciado && !flash && !tallaCompleta && (
              <span style={{ fontSize: 20, fontFamily: T.mono, fontWeight: 900, color: colorBoton }}>
                {tallaActivaComp}/{tallaActivaObj?.cantidad || 0}
              </span>
            )}
            {operacionSel && tallaActiva && cronIniciado && !flash && !tallaCompleta && (
              <span style={{ fontSize: 32, fontFamily: T.mono, fontWeight: 900, color: colorBoton }}>
                {fmtCron(cronSeg)}
              </span>
            )}
          </button>
        </div>

        {/* KPIs */}
        {operacionSel && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid " + T.border, borderRadius: 12, padding: "10px 12px", textAlign: "center" }}>
              <p style={{ fontSize: 24, fontWeight: 900, color: T.yellow, fontFamily: T.mono, lineHeight: 1 }}>{unidadesHoy}</p>
              <p style={{ fontSize: 8, color: T.muted, fontFamily: T.mono, marginTop: 3 }}>UDS. OPERACIÓN</p>
            </div>
            <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid " + T.border, borderRadius: 12, padding: "10px 12px", textAlign: "center" }}>
              <p style={{ fontSize: 24, fontWeight: 900, color: velocidad > 0 ? efColor(Math.round((velocidad / (samActual ? 60 / samActual : 1)) * 100)) : T.muted, fontFamily: T.mono, lineHeight: 1 }}>{velocidad > 0 ? velocidad + "/h" : "—"}</p>
              <p style={{ fontSize: 8, color: T.muted, fontFamily: T.mono, marginTop: 3 }}>VEL. ACTUAL</p>
            </div>
            <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid " + T.border, borderRadius: 12, padding: "10px 12px", textAlign: "center" }}>
              <p style={{ fontSize: 24, fontWeight: 900, color: T.muted, fontFamily: T.mono, lineHeight: 1 }}>{totalTurno}</p>
              <p style={{ fontSize: 8, color: T.muted, fontFamily: T.mono, marginTop: 3 }}>TOTAL TURNO</p>
            </div>
          </div>
        )}

        {/* Eficiencia acumulada + última prenda */}
        {operacionSel && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid " + T.border, borderRadius: 14, padding: "10px 12px", textAlign: "center" }}>
              {!efAcumulada ? (
                <div>
                  <p style={{ fontSize: 24, fontWeight: 900, fontFamily: T.mono, color: T.muted, lineHeight: 1 }}>—</p>
                  <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, letterSpacing: "0.1em", marginTop: 3 }}>EF. ACUMULADA</p>
                </div>
              ) : (
                <div>
                  <p style={{ fontSize: 24, fontWeight: 900, fontFamily: T.mono, color: efColor(efAcumulada.ef), lineHeight: 1 }}>{efAcumulada.ef}%</p>
                  <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, letterSpacing: "0.1em", marginTop: 3 }}>EF. ACUMULADA</p>
                  <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, marginTop: 2 }}>{efAcumulada.reales} / {efAcumulada.esperadas} esp.</p>
                  {(() => {
                    const compas = (registrosGlobales || []).filter(r => r.modulo === sesion?.modulo && r.usuarioId !== sesion?.id && !r.esParada && r.tiempoReal !== null && r.sam !== null);
                    if (compas.length < 3) return null;
                    const efMap = {};
                    compas.forEach(r => { if (!efMap[r.usuarioId]) efMap[r.usuarioId] = []; efMap[r.usuarioId].push(Math.round((r.sam / r.tiempoReal) * 100)); });
                    const promedios = Object.values(efMap).map(arr => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length));
                    const pos = promedios.filter(e => e < efAcumulada.ef).length + 1;
                    return <p style={{ fontSize: 9, color: pos <= 2 ? T.green : T.muted, fontFamily: T.mono, marginTop: 4 }}>{pos <= 2 ? "🏆" : "📊"} #{pos} de {promedios.length + 1}</p>;
                  })()}
                </div>
              )}
            </div>
            <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid " + T.border, borderRadius: 14, padding: "10px 12px", textAlign: "center" }}>
              {(() => {
                const ultimo = registros.find(r => !r.esParada && !r.esDefecto && r.operacion === operacionSel && r.tiempoReal !== null);
                if (!ultimo || !samActual) return (
                  <div>
                    <p style={{ fontSize: 24, fontWeight: 900, fontFamily: T.mono, color: T.muted, lineHeight: 1 }}>—</p>
                    <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, letterSpacing: "0.1em", marginTop: 3 }}>EF. ÚLTIMA PRENDA</p>
                  </div>
                );
                const ef = Math.round((samActual / ultimo.tiempoReal) * 100);
                return (
                  <div>
                    <p style={{ fontSize: 24, fontWeight: 900, fontFamily: T.mono, color: efColor(ef), lineHeight: 1 }}>{ef}%</p>
                    <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, letterSpacing: "0.1em", marginTop: 3 }}>EF. ÚLTIMA PRENDA</p>
                    <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, marginTop: 2 }}>{ultimo.tiempoReal}min / SAM {samActual}</p>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* Banner parada activa */}
        {paradaActiva && (
          <div style={{ background: "rgba(255,102,0,0.12)", border: "2px solid " + T.orange, borderRadius: 14, padding: "16px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <AlertTriangle size={20} color={T.orange} />
                <div>
                  <p style={{ fontSize: 14, fontWeight: 900, color: T.orange, fontFamily: T.font }}>PARADA ACTIVA</p>
                  <p style={{ fontSize: 11, color: T.muted, fontFamily: T.mono }}>{paradaActiva.motivo} · desde {paradaActiva.ts}</p>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono }}>AFECTA EF.</p>
                <p style={{ fontSize: 12, fontWeight: 900, fontFamily: T.mono, color: paradaActiva.afectaEf ? T.red : T.green }}>{paradaActiva.afectaEf ? "SÍ" : "NO"}</p>
              </div>
            </div>
            <button onClick={reanudarTurno} style={{ background: T.green, color: "#000", border: "none", borderRadius: 10, padding: "12px 0", fontSize: 15, fontWeight: 900, fontFamily: T.font, cursor: "pointer" }}>
              ▶ REANUDAR TURNO
            </button>
          </div>
        )}

        {/* Lote completado */}
        {loteCompleto && (() => {
          const orden = ordenes.find(o => o.id === ordenSel);
          const ops = asig?.operaciones || [];
          const idx = ops.indexOf(operacionSel);
          const sigOp = idx >= 0 && idx < ops.length - 1 ? ops[idx + 1] : null;
          return (
            <div style={{ background: "linear-gradient(135deg, rgba(0,255,136,0.15), rgba(0,238,255,0.08))", border: "2px solid " + T.green, borderRadius: 16, padding: "20px 16px", textAlign: "center", display: "flex", flexDirection: "column", gap: 10 }}>
              <p style={{ fontSize: 28, fontWeight: 900, color: T.green, fontFamily: T.font, lineHeight: 1 }}>🎉 OPERACIÓN COMPLETADA</p>
              <p style={{ fontSize: 13, color: T.green, fontFamily: T.mono, opacity: 0.85 }}>{orden?.referencia} · Todas las tallas en {operacionSel}</p>
              {sigOp ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ background: "rgba(0,255,136,0.08)", border: "1px solid rgba(0,255,136,0.2)", borderRadius: 10, padding: "10px 14px" }}>
                    <p style={{ fontSize: 11, color: T.muted, fontFamily: T.mono, marginBottom: 4 }}>SIGUIENTE OPERACIÓN</p>
                    <p style={{ fontSize: 16, fontWeight: 900, color: T.text, fontFamily: T.font }}>{sigOp}</p>
                  </div>
                  <button onClick={() => cambiarOperacion(sigOp)} style={{ background: T.green, color: "#000", border: "none", borderRadius: 10, padding: "12px 0", fontSize: 14, fontWeight: 900, fontFamily: T.font, cursor: "pointer" }}>
                    PASAR A {sigOp.toUpperCase()} →
                  </button>
                </div>
              ) : (
                <div style={{ background: "rgba(0,255,136,0.08)", border: "1px solid rgba(0,255,136,0.2)", borderRadius: 10, padding: "10px 14px" }}>
                  <p style={{ fontSize: 12, color: T.text, fontFamily: T.font, fontWeight: 700 }}>Pide la asignacion del nuevo lote a tu supervisor</p>
                </div>
              )}
            </div>
          );
        })()}

        {/* Celebración talla */}
        {tallaCelebracion && (
          <div style={{ background: "linear-gradient(135deg, rgba(0,255,136,0.2), rgba(0,238,255,0.1))", border: "2px solid " + T.green, borderRadius: 16, padding: "16px 20px", textAlign: "center" }}>
            <p style={{ fontSize: 28, fontWeight: 900, color: T.green, fontFamily: T.font, lineHeight: 1 }}>🎉 TALLA {tallaCelebracion} COMPLETA</p>
            <p style={{ fontSize: 12, color: T.green, fontFamily: T.mono, marginTop: 6, opacity: 0.8 }}>Cambia a la siguiente talla o selecciona otra operación</p>
          </div>
        )}

        {/* Botones acción */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
          <button onClick={() => setShowParada(true)} style={{ padding: "10px 0", background: "transparent", color: T.yellow, border: "1px solid " + T.yellow, fontSize: 11, fontWeight: 700, fontFamily: T.font, cursor: "pointer", borderRadius: 8, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <AlertTriangle size={16} color={T.yellow} strokeWidth={1.5} />
            PARADA
          </button>
          <button onClick={() => setShowCalidad(true)} style={{ padding: "10px 0", background: "transparent", color: T.red, border: "1px solid " + T.red, fontSize: 11, fontWeight: 700, fontFamily: T.font, cursor: "pointer", borderRadius: 8, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <AlertCircle size={16} color={T.red} strokeWidth={1.5} />
            DEFECTO
          </button>
          <button onClick={() => setShowAyuda(true)} style={{ padding: "10px 0", background: "transparent", color: "#4499ff", border: "1px solid #4499ff", fontSize: 11, fontWeight: 700, fontFamily: T.font, cursor: "pointer", borderRadius: 8, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <LifeBuoy size={16} color="#4499ff" strokeWidth={1.5} />
            AYUDA
          </button>
        </div>

        {/* Deshacer */}
        {registros.length > 0 && (
          <div style={{ display: "flex", justifyContent: "center" }}>
            <button onClick={deshacerUltimo} style={{ background: "transparent", border: "1px solid #4499ff", color: "#4499ff", fontFamily: T.mono, fontSize: 11, padding: "8px 24px", cursor: "pointer", borderRadius: 8, display: "flex", alignItems: "center", gap: 6 }}>
              <Undo2 size={14} color="#4499ff" strokeWidth={1.5} /> DESHACER
            </button>
          </div>
        )}

        {/* Historial */}
        {registros.length > 0 && (
          <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid " + T.border, borderRadius: 12, overflow: "hidden" }}>
            <div style={{ padding: "8px 14px", borderBottom: "1px solid " + T.faint, display: "flex", justifyContent: "space-between" }}>
              <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, letterSpacing: "0.14em" }}>ÚLTIMOS REGISTROS</p>
              <p style={{ fontSize: 10, color: T.yellow, fontFamily: T.mono }}>{registros.filter(r => !r.esParada).length} uds · {registros.filter(r => r.esParada).length} paradas</p>
            </div>
            {registros.slice(0, 15).map((r, i) => (
              <div key={r.id} style={{ padding: "8px 14px", borderBottom: i < 14 ? "1px solid " + T.faint : "none", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 14, color: r.esParada ? T.orange : r.esDefecto ? T.red : T.green }}>{r.esParada ? "⚠" : r.esDefecto ? "✗" : "✓"}</span>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 12, color: r.esParada ? T.orange : T.text, fontFamily: T.font, fontWeight: 600 }}>{r.esParada ? r.motivo : r.operacion}</span>
                      {!r.esParada && r.talla && (
                        <span style={{ fontSize: 9, background: "rgba(0,255,136,0.1)", border: "1px solid rgba(0,255,136,0.3)", borderRadius: 4, padding: "1px 5px", color: T.green, fontFamily: T.mono }}>T/{r.talla}</span>
                      )}
                    </div>
                    {!r.esParada && r.sam && <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono }}>SAM: {r.sam}min</p>}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <p style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>{r.ts}</p>
                  {r.tiempoReal && (
                    <p style={{ fontSize: 11, fontWeight: 700, fontFamily: T.mono, color: r.sam ? efColor(Math.round((r.sam / r.tiempoReal) * 100)) : T.muted }}>
                      {r.tiempoReal}min {r.tiempoReal < (r.sam || 999) ? "▼" : "▲"}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal: Parada */}
      {showParada && (
        <div style={MODAL_STYLE} onClick={() => setShowParada(false)}>
          <div style={PANEL_STYLE} onClick={e => e.stopPropagation()}>
            <p style={{ fontSize: 14, color: T.yellow, fontFamily: T.mono, letterSpacing: "0.14em" }}>⚠ REGISTRAR PARADA</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {MOTIVOS_PARADA.map(m => (
                <button key={m.motivo} onClick={() => setMotivoParada(m.motivo)}
                  style={{ padding: "12px 14px", background: motivoParada === m.motivo ? "rgba(255,230,0,0.15)" : "rgba(255,255,255,0.04)", border: "1px solid " + (motivoParada === m.motivo ? T.yellow : T.border), borderRadius: 8, color: motivoParada === m.motivo ? T.yellow : T.text, fontFamily: T.font, fontSize: 13, cursor: "pointer", textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>{m.motivo}</span>
                  {m.afectaEf && <span style={{ fontSize: 9, color: T.red, fontFamily: T.mono, background: "rgba(255,0,68,0.1)", border: "1px solid rgba(255,0,68,0.3)", padding: "2px 6px", borderRadius: 4 }}>AFECTA EF.</span>}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={registrarParada} disabled={!motivoParada}
                style={{ flex: 1, padding: "14px 0", background: motivoParada ? T.yellow : "rgba(255,255,255,0.05)", color: motivoParada ? "#000" : T.muted, border: "none", fontFamily: T.mono, fontWeight: 900, fontSize: 13, cursor: motivoParada ? "pointer" : "default", borderRadius: 8 }}>
                REGISTRAR PARADA
              </button>
              <button onClick={() => setShowParada(false)} style={{ padding: "14px 20px", background: "transparent", color: T.muted, border: "1px solid " + T.border, fontFamily: T.mono, cursor: "pointer", borderRadius: 8 }}>CANCELAR</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Defecto */}
      {showCalidad && (
        <div style={MODAL_STYLE} onClick={() => setShowCalidad(false)}>
          <div style={PANEL_STYLE} onClick={e => e.stopPropagation()}>
            <p style={{ fontSize: 14, color: T.red, fontFamily: T.mono, letterSpacing: "0.14em" }}>✗ REGISTRAR DEFECTO</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {TIPOS_DEFECTO.map(d => (
                <button key={d} onClick={() => {
                  const ts = new Date().toLocaleTimeString("es-CO");
                  setRegistros(prev => [{ id: Date.now(), ts, motivo: "Defecto: " + d, esParada: false, esDefecto: true, operacion: operacionSel, talla: tallaActiva, orden: ordenSel }, ...prev]);
                  vibrar([50, 30, 50]);
                  setShowCalidad(false);
                }} style={{ padding: "12px 14px", background: "rgba(255,255,255,0.04)", border: "1px solid " + T.border, borderRadius: 8, color: T.text, fontFamily: T.font, fontSize: 13, cursor: "pointer", textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>{d}</span>
                  {tallaActiva && <Badge color="gray">T/{tallaActiva}</Badge>}
                </button>
              ))}
              <button onClick={() => setShowCalidad(false)} style={{ padding: "12px 0", background: "transparent", color: T.muted, border: "1px solid " + T.border, fontFamily: T.mono, cursor: "pointer", borderRadius: 8 }}>CANCELAR</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Ayuda */}
      {showAyuda && (
        <div style={MODAL_STYLE} onClick={() => setShowAyuda(false)}>
          <div style={PANEL_STYLE} onClick={e => e.stopPropagation()}>
            <p style={{ fontSize: 14, color: "#4499ff", fontFamily: T.mono, letterSpacing: "0.14em" }}>🆘 PEDIR AYUDA</p>
            <textarea value={mensajeAyuda} onChange={e => setMensajeAyuda(e.target.value)} placeholder="Describe lo que necesitas..." rows={4}
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid " + T.border, padding: "10px", color: T.text, fontSize: 13, fontFamily: T.font, resize: "none", outline: "none", borderRadius: 8 }} />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={enviarAyuda} disabled={!mensajeAyuda.trim()}
                style={{ flex: 1, padding: "14px 0", background: mensajeAyuda.trim() ? "#4499ff" : "rgba(255,255,255,0.05)", color: mensajeAyuda.trim() ? "#fff" : T.muted, border: "none", fontFamily: T.mono, fontWeight: 900, fontSize: 13, cursor: mensajeAyuda.trim() ? "pointer" : "default", borderRadius: 8 }}>
                ENVIAR
              </button>
              <button onClick={() => setShowAyuda(false)} style={{ padding: "14px 20px", background: "transparent", color: T.muted, border: "1px solid " + T.border, fontFamily: T.mono, cursor: "pointer", borderRadius: 8 }}>CANCELAR</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Resumen turno */}
      {showResumen && (
        <div style={MODAL_STYLE}>
          <div style={{ ...PANEL_STYLE, maxHeight: "85vh", overflowY: "auto" }}>
            <p style={{ fontSize: 14, color: T.green, fontFamily: T.mono, letterSpacing: "0.14em" }}>RESUMEN DE TURNO</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[
                { label: "Total turno", value: totalTurno, color: T.yellow },
                { label: "Paradas", value: registros.filter(r => r.esParada).length, color: T.red },
                { label: "Eficiencia", value: (efAcumulada?.ef || "—") + (efAcumulada ? "%" : ""), color: efAcumulada ? efColor(efAcumulada.ef) : T.muted },
                { label: "Velocidad", value: velocidad > 0 ? velocidad + "/h" : "—", color: T.blue },
                { label: "Duracion",    value: Math.round((Date.now() - inicioTurno) / 60000) + "min", color: T.muted },
                { label: "Meta turno",  value: meta || "—", color: T.muted },
                { label: "Puntualidad", value: horaInicioTurnoReal > 0 ? "-" + horaInicioTurnoReal + "min" : "A tiempo", color: horaInicioTurnoReal > 0 ? T.red : T.green },
              ].map(k => (
                <div key={k.label} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid " + T.border, borderRadius: 10, padding: "10px 12px" }}>
                  <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, letterSpacing: "0.1em", marginBottom: 4 }}>{k.label.toUpperCase()}</p>
                  <p style={{ fontSize: 22, fontWeight: 900, color: k.color, fontFamily: T.mono, lineHeight: 1 }}>{k.value}</p>
                </div>
              ))}
            </div>

            {/* Desglose de paradas */}
            {registros.filter(r => r.esParada && r.duracionMin).length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, letterSpacing: "0.14em" }}>DESGLOSE DE PARADAS</p>
                {registros.filter(r => r.esParada && r.duracionMin).map(r => (
                  <div key={r.id} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid " + T.faint, borderRadius: 8, padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <p style={{ fontSize: 12, color: T.text, fontFamily: T.font, fontWeight: 600 }}>{r.motivo}</p>
                      <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono }}>{r.ts}</p>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {r.afectaEf && <span style={{ fontSize: 9, color: T.red, fontFamily: T.mono }}>AFECTA EF.</span>}
                      <span style={{ fontSize: 13, fontWeight: 900, color: T.orange, fontFamily: T.mono }}>{r.duracionMin}min</span>
                    </div>
                  </div>
                ))}
                <div style={{ background: "rgba(255,102,0,0.08)", border: "1px solid rgba(255,102,0,0.2)", borderRadius: 8, padding: "8px 12px", display: "flex", justifyContent: "space-between" }}>
                  <p style={{ fontSize: 11, color: T.orange, fontFamily: T.mono, fontWeight: 700 }}>TIEMPO TOTAL EN PARADAS</p>
                  <p style={{ fontSize: 13, fontWeight: 900, color: T.orange, fontFamily: T.mono }}>{registros.filter(r => r.esParada && r.duracionMin).reduce((a, r) => a + r.duracionMin, 0)}min</p>
                </div>
              </div>
            )}

            {historialTurnos.length > 0 && (
              <div>
                <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, letterSpacing: "0.14em", marginBottom: 8 }}>HISTORIAL DE TURNOS</p>
                {historialTurnos.slice(0, 5).map((t, i) => (
                  <div key={i} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid " + T.faint, borderRadius: 8, padding: "8px 12px", marginBottom: 6, display: "flex", justifyContent: "space-between" }}>
                    <p style={{ fontSize: 11, color: T.muted, fontFamily: T.mono }}>{t.fecha}</p>
                    <p style={{ fontSize: 11, fontWeight: 700, color: T.text, fontFamily: T.mono }}>{t.unidades} uds {t.ef ? "· " + t.ef + "%" : ""}</p>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => { guardarTurno(); setShowResumen(false); cerrarSesion(); }}
                style={{ flex: 1, padding: "14px 0", background: "transparent", color: "#4499ff", border: "1px solid #4499ff", fontFamily: T.mono, fontWeight: 900, fontSize: 13, cursor: "pointer", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                <LogOut size={16} color="#4499ff" /> CERRAR TURNO
              </button>
              <button onClick={() => setShowResumen(false)} style={{ padding: "14px 20px", background: "transparent", color: T.muted, border: "1px solid " + T.border, fontFamily: T.mono, cursor: "pointer", borderRadius: 8 }}>VOLVER</button>
            </div>
            <p style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, textAlign: "center" }}>⚠ Los datos del turno se guardan en el resumen pero se reinician al cerrar</p>

            {/* Exportar reporte */}
            <button onClick={() => {
              const lineas = [
                "REPORTE DE TURNO — ORIGENTEX",
                "=============================",
                "Operaria: " + sesion?.nombre,
                "Módulo: " + moduloSel,
                "Fecha: " + new Date().toLocaleDateString("es-CO"),
                "Hora: " + new Date().toLocaleTimeString("es-CO"),
                "",
                "PRODUCCIÓN",
                "-----------",
                "Total turno: " + totalTurno + " uds",
                "Eficiencia acumulada: " + (efAcumulada?.ef || "—") + "%",
                "Velocidad: " + (velocidad > 0 ? velocidad + " uds/h" : "—"),
                "Meta turno: " + (meta || "—"),
                "Puntualidad: " + (horaInicioTurnoReal > 0 ? "-" + horaInicioTurnoReal + " min" : "A tiempo"),
                "",
                "PARADAS",
                "--------",
                ...registros.filter(r => r.esParada && r.duracionMin).map(r => "- " + r.motivo + " · " + r.duracionMin + "min · " + (r.afectaEf ? "Afecta ef." : "No afecta")),
                "Total en paradas: " + registros.filter(r => r.esParada && r.duracionMin).reduce((a, r) => a + r.duracionMin, 0) + " min",
                "",
                "DEFECTOS",
                "---------",
                ...registros.filter(r => r.esDefecto).map(r => "- " + r.motivo + " · T/" + (r.talla || "—") + " · " + r.ts),
              ].join("\n");

              const blob = new Blob([lineas], { type: "text/plain" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "reporte_" + sesion?.nombre?.replace(" ", "_") + "_" + new Date().toLocaleDateString("es-CO").replace(/\//g, "-") + ".txt";
              a.click();
              URL.revokeObjectURL(url);
            }} style={{ padding: "12px 0", background: "rgba(255,255,255,0.04)", color: T.muted, border: "1px solid " + T.border, fontFamily: T.mono, fontWeight: 900, fontSize: 12, cursor: "pointer", borderRadius: 8 }}>
              📄 EXPORTAR REPORTE TXT
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── APP PRINCIPAL ────────────────────────────────────────────────────────────

export default function App() {
  const [sesion, setSesion] = useState(null);
  const [tab, setTab] = useState("dashboard");
  const [ordenes, setOrdenes] = useState([]);
  const [operarios, setOperarios] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [asignaciones, setAsignaciones] = useState([]);
  const [mensajes, setMensajes] = useState([]);
  const [logActividad, setLogActividad] = useState([]);
  const [registrosGlobales, setRegistrosGlobales] = useState([]);
  const [horarios, setHorarios] = useState(HORARIOS_INIT);
  const [catalogo, setCatalogo] = useState([]);
  const [pedidos, setPedidos]   = useState([]);
  const [maquinas, setMaquinas] = useState([]);
  const [dbListo, setDbListo] = useState(false);

  // ─── CARGA INICIAL DESDE SUPABASE ─────────────────────────────────────────
  useEffect(() => {
    const cargarDatos = async () => {
      try {
        // Usuarios
        const { data: uData } = await supabase.from("usuarios").select("*");
        if (uData?.length) setUsuarios(uData.map(u => ({ id: u.id, nombre: u.nombre, usuario: u.usuario, clave: u.clave, rol: u.rol, modulo: u.modulo || "", activo: u.activo, hashPendiente: false, auth_id: u.auth_id || null })));

        // Órdenes
        const { data: oData } = await supabase.from("ordenes").select("*");
        if (oData?.length) setOrdenes(oData.map(o => ({ id: o.id, referencia: o.referencia, descripcion: o.descripcion, cliente: o.cliente, cantidadTotal: o.cantidad_total, cantidadProducida: o.cantidad_producida, fechaEntrega: o.fecha_entrega, estado: o.estado, prioridad: o.prioridad, tallas: o.tallas || [], secuencia: o.secuencia || [], pedidoId: o.pedido_id || null })));

        // Catálogo
        const { data: cData } = await supabase.from("catalogo").select("*");
        if (cData?.length) setCatalogo(cData.map(c => ({ id: c.id, nombre: c.nombre, descripcion: c.descripcion, tallas: c.tallas || [], operaciones: c.operaciones || [], cliente: c.cliente || "", temporada: c.temporada || "", estado: c.estado || "Borrador", numPrototipo: c.num_prototipo || 0, insumos: c.insumos || [], corte: c.corte_specs || { direccion: "Al hilo", tendido: "Simple", consumoPorTalla: {}, notas: "" }, historial: c.historial || [], fechaCreacion: c.fecha_creacion || "", fechaAprobacion: c.fecha_aprobacion || null, fechaLiberacion: c.fecha_liberacion || null })));

        // Máquinas
        const { data: mData } = await supabase.from("maquinas").select("*").order("id");
        if (mData?.length) setMaquinas(mData.map(m => ({ id: m.id, nombre: m.nombre })));

        // Asignaciones
        const { data: aData } = await supabase.from("asignaciones").select("*");
        if (aData?.length) setAsignaciones(aData.map(a => ({ usuarioId: a.usuario_id, ordenId: a.orden_id, operaciones: a.operaciones || [] })));

        // Horarios
        const { data: hData } = await supabase.from("horarios").select("*").order("id", { ascending: false }).limit(1);
        if (hData?.length) setHorarios(hData[0].config);

        // Registros del turno actual (últimas 12h)
        const hace12h = new Date(Date.now() - 12 * 3600000).toISOString();
        const { data: rData } = await supabase.from("registros").select("*").gte("created_at", hace12h);
        if (rData?.length) setRegistrosGlobales(rData.map(r => ({ id: r.id, ts: r.ts, orden: r.orden, operacion: r.operacion, talla: r.talla, esParada: r.es_parada, esDefecto: r.es_defecto, tiempoReal: r.tiempo_real, sam: r.sam, usuarioId: r.usuario_id, nombre: r.nombre, modulo: r.modulo, motivo: r.motivo, afectaEf: r.afecta_ef, activa: r.activa, duracionMin: r.duracion_min })));

        // Pedidos
        const { data: pData } = await supabase.from("pedidos").select("*").order("created_at", { ascending: false });
        if (pData?.length) setPedidos(pData.map(p => ({ id: p.id, numeroPedido: p.numero_pedido || "", tipo: p.tipo || "Producción", cliente: p.cliente, contacto: p.contacto || "", telefono: p.telefono || "", numeroOC: p.numero_oc || "", direccionEntrega: p.direccion_entrega || "", ciudad: p.ciudad || "", transportadora: p.transportadora || "", condicionesPago: p.condiciones_pago || "Contado", anticipoMonto: p.anticipo_monto || 0, anticipoEstado: p.anticipo_estado || "Pendiente", fechaEntrega: p.fecha_entrega || "", fechaInicioRequerida: p.fecha_inicio_requerida || "", prioridad: p.prioridad || "Media", estado: p.estado || "Borrador", referencias: p.referencias || [], notas: p.notas || "", fechaCreacion: p.fecha_creacion || "", creadoPor: p.creado_por || "", ordenProduccionId: p.orden_produccion_id || null, historial: p.historial || [] })));

        setDbListo(true);
        setListoParaUsar(true);
      } catch (e) {
        console.error("Error cargando datos:", e);
        setDbListo(true);
        setListoParaUsar(true);
      }
    };
    cargarDatos();
  }, []);

  // ─── SINCRONIZACIÓN EN TIEMPO REAL ────────────────────────────────────────
  useEffect(() => {
    if (!dbListo) return;
    const canal = supabase
      .channel("cambios_produccion")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "registros" }, payload => {
        const r = payload.new;
        setRegistrosGlobales(prev => [{ id: r.id, ts: r.ts, orden: r.orden, operacion: r.operacion, talla: r.talla, esParada: r.es_parada, esDefecto: r.es_defecto, tiempoReal: r.tiempo_real, sam: r.sam, usuarioId: r.usuario_id, nombre: r.nombre, modulo: r.modulo, motivo: r.motivo, afectaEf: r.afecta_ef, activa: r.activa, duracionMin: r.duracion_min }, ...prev.slice(0, 499)]);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "registros" }, payload => {
        const r = payload.new;
        setRegistrosGlobales(prev => prev.map(x => x.id === r.id ? { ...x, activa: r.activa, duracionMin: r.duracion_min } : x));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "usuarios" }, payload => {
        if (payload.eventType === "DELETE") {
          setUsuarios(prev => prev.filter(u => u.id !== payload.old.id));
        } else {
          const u = payload.new;
          const usr = { id: u.id, nombre: u.nombre, usuario: u.usuario, clave: u.clave, rol: u.rol, modulo: u.modulo || "", activo: u.activo, hashPendiente: false };
          setUsuarios(prev => prev.some(x => x.id === usr.id) ? prev.map(x => x.id === usr.id ? usr : x) : [...prev, usr]);
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "asignaciones" }, payload => {
        if (payload.eventType === "DELETE") {
          setAsignaciones(prev => prev.filter(a => a.usuarioId !== payload.old.usuario_id));
        } else {
          const a = payload.new;
          const asig = { usuarioId: a.usuario_id, ordenId: a.orden_id, operaciones: a.operaciones || [] };
          setAsignaciones(prev => prev.some(x => x.usuarioId === asig.usuarioId) ? prev.map(x => x.usuarioId === asig.usuarioId ? asig : x) : [...prev, asig]);
        }
      })
      .subscribe();
    return () => supabase.removeChannel(canal);
  }, [dbListo]);
  const [listoParaUsar, setListoParaUsar] = useState(false);
  const [hora, setHora] = useState(new Date().toLocaleTimeString("es-CO"));
  const [ultimaActividad, setUltimaActividad] = useState(Date.now());

  // Hash inicial de claves


  useEffect(() => {
    const t = setInterval(() => setHora(new Date().toLocaleTimeString("es-CO")), 1000);
    return () => clearInterval(t);
  }, []);

  // Expiración de sesión por inactividad
  useEffect(() => {
    if (!sesion) return;
    const check = setInterval(() => {
      const inactivo = Date.now() - ultimaActividad > INACTIVIDAD_MS;
      const expirado = Date.now() - (sesion.loginTs || Date.now()) > SESION_MS;
      if (inactivo || expirado) {
        registrarLog("SESIÓN EXPIRADA POR " + (inactivo ? "INACTIVIDAD" : "TIEMPO"), sesion);
        cerrarSesion();
      }
    }, 60000); // revisa cada minuto
    return () => clearInterval(check);
  }, [sesion, ultimaActividad]);

  useEffect(() => {
    const actualizar = () => setUltimaActividad(Date.now());
    window.addEventListener("click", actualizar);
    window.addEventListener("touchstart", actualizar);
    return () => { window.removeEventListener("click", actualizar); window.removeEventListener("touchstart", actualizar); };
  }, []);

  const setOrdenesSync = useCallback((updater) => {
    setOrdenes(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      // Sincronizar cada orden modificada
      next.forEach(o => {
        supabase.from("ordenes").upsert({ id: o.id, referencia: o.referencia, descripcion: o.descripcion, cliente: o.cliente, cantidad_total: o.cantidadTotal, cantidad_producida: o.cantidadProducida, fecha_entrega: o.fechaEntrega, estado: o.estado, prioridad: o.prioridad, tallas: o.tallas, secuencia: o.secuencia, pedido_id: o.pedidoId || null }).then(({ error }) => { if (error) console.error("Error sync orden:", error); });
      });
      return next;
    });
  }, []);

  const setCatalogoSync = useCallback((updater) => {
    setCatalogo(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      next.forEach(c => {
        supabase.from("catalogo").upsert({ id: c.id, nombre: c.nombre, descripcion: c.descripcion, tallas: c.tallas, operaciones: c.operaciones, cliente: c.cliente || "", temporada: c.temporada || "", estado: c.estado || "Borrador", num_prototipo: c.numPrototipo || 0, insumos: c.insumos || [], corte_specs: c.corte || {}, historial: c.historial || [], fecha_creacion: c.fechaCreacion || null, fecha_aprobacion: c.fechaAprobacion || null, fecha_liberacion: c.fechaLiberacion || null }).then(({ error }) => { if (error) console.error("Error sync catalogo:", error); });
      });
      return next;
    });
  }, []);

  const setAsignacionesSync = useCallback((updater) => {
    setAsignaciones(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      // Borrar y reinsertar asignaciones
      supabase.from("asignaciones").delete().neq("id", 0).then(() => {
        next.forEach(a => {
          supabase.from("asignaciones").insert({ usuario_id: a.usuarioId, orden_id: a.ordenId, operaciones: a.operaciones }).then(({ error }) => { if (error) console.error("Error sync asignacion:", error); });
        });
      });
      return next;
    });
  }, []);

  const setHorariosSync = useCallback((updater) => {
    setHorarios(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      supabase.from("horarios").upsert({ id: 1, config: next }).then(({ error }) => { if (error) console.error("Error sync horarios:", error); });
      return next;
    });
  }, []);

  const setPedidosSync = useCallback((updater) => {
    setPedidos(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      next.forEach(p => {
        supabase.from("pedidos").upsert({
          id: p.id, numero_pedido: p.numeroPedido || null, tipo: p.tipo || "Producción",
          cliente: p.cliente, contacto: p.contacto || "", telefono: p.telefono || "",
          numero_oc: p.numeroOC || null,
          direccion_entrega: p.direccionEntrega || "", ciudad: p.ciudad || "",
          transportadora: p.transportadora || "", condiciones_pago: p.condicionesPago || "Contado",
          anticipo_monto: p.anticipoMonto || 0, anticipo_estado: p.anticipoEstado || "Pendiente",
          fecha_entrega: p.fechaEntrega || null, fecha_inicio_requerida: p.fechaInicioRequerida || null,
          prioridad: p.prioridad || "Media", estado: p.estado || "Borrador",
          referencias: p.referencias || [], notas: p.notas || "",
          fecha_creacion: p.fechaCreacion || null, creado_por: p.creadoPor || "",
          orden_produccion_id: p.ordenProduccionId || null, historial: p.historial || []
        }).then(({ error }) => { if (error) console.error("Error sync pedido:", error); });
      });
      return next;
    });
  }, []);

  const registrarLog = async (accion, u) => {
    if (!u) return;
    const entrada = { ts: new Date().toLocaleTimeString("es-CO"), nombre: u.nombre, rol: u.rol, accion, epoch: Date.now() };
    // Hash simple de integridad
    try {
      const str = JSON.stringify(entrada);
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
      entrada.hash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("").slice(0,12);
    } catch {}
    setLogActividad(prev => [entrada, ...prev.slice(0, 99)]);
  };

  const onLogin = (u) => {
    setSesion({ ...u, loginTs: Date.now() });
    setTab(ROLES[u.rol]?.permisos[0] || "dashboard");
    registrarLog("INICIO DE SESIÓN", u);
  };

  const cerrarSesion = () => {
    if (sesion) registrarLog("CIERRE DE SESIÓN", sesion);
    setSesion(null);
    setTab("dashboard");
  };

  if (!listoParaUsar) return (
    <div style={{ minHeight: "100vh", background: "#0a0a0f", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
      <div style={{ background: "linear-gradient(135deg, #00ff88, #00eeff)", padding: "8px 24px", borderRadius: 8 }}>
        <span style={{ fontSize: 28, fontWeight: 900, color: "#000", fontFamily: "'Barlow Condensed', Arial" }}>ORIGENTEX</span>
      </div>
      <p style={{ color: "#666", fontFamily: "monospace", fontSize: 11, letterSpacing: "0.14em" }}>INICIANDO SISTEMA SEGURO...</p>
    </div>
  );

  if (!sesion) return <Login usuarios={usuarios} onLogin={onLogin} />;

  const rol = ROLES[sesion.rol];
  const permisos = rol.permisos;

  const TABS_ALL = [
    { id: "inicio",     label: "Inicio",     icon: <LayoutDashboard size={18} strokeWidth={1.5} /> },
    { id: "pipeline",   label: "Pipeline",   icon: <GitBranch       size={18} strokeWidth={1.5} /> },
    { id: "pedidos",    label: "Pedidos",    icon: <ShoppingCart    size={18} strokeWidth={1.5} /> },
    { id: "dashboard",  label: "Dashboard",  icon: <Activity        size={18} strokeWidth={1.5} /> },
    { id: "ordenes",    label: "Ordenes",    icon: <ClipboardList   size={18} strokeWidth={1.5} /> },
    { id: "catalogo",   label: "Catalogo",   icon: <FolderOpen      size={18} strokeWidth={1.5} /> },
    { id: "inventario", label: "Compras",    icon: <Package         size={18} strokeWidth={1.5} /> },
    { id: "corte",      label: "Corte",      icon: <Scissors        size={18} strokeWidth={1.5} /> },
    { id: "operarios",  label: "Operarios",  icon: <Users           size={18} strokeWidth={1.5} /> },
    { id: "eficiencia", label: "Eficiencia", icon: <TrendingUp      size={18} strokeWidth={1.5} /> },
    { id: "horarios",   label: "Horarios",   icon: <Clock           size={18} strokeWidth={1.5} /> },
    { id: "reporte",    label: "Reporte",    icon: <ClipboardList   size={18} strokeWidth={1.5} /> },
    { id: "usuarios",   label: "Usuarios",   icon: <KeyRound        size={18} strokeWidth={1.5} /> },
    { id: "log",        label: "Log",        icon: <Shield          size={18} strokeWidth={1.5} /> },
  ];
  const TABS = TABS_ALL.filter(t => permisos.includes(t.id));

  // Tablet tiene su propio layout
  if (sesion.rol === "OPERARIO" || tab === "tablet") {
    return (
      <TabletOperario
        ordenes={ordenes} setOrdenes={setOrdenesSync}
        sesion={sesion} asignaciones={asignaciones}
        mensajes={mensajes} setMensajes={setMensajes}
        registrosGlobales={registrosGlobales} setRegistrosGlobales={setRegistrosGlobales}
        cerrarSesion={cerrarSesion}
        horarios={horarios}
        usuarios={usuarios}
      />
    );
  }

  return (
    <div style={{ fontFamily: T.font, background: "linear-gradient(135deg, #0a0a0f 0%, #0d0d1a 50%, #0a0f0a 100%)", minHeight: "100vh", color: T.text }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800;900&family=Share+Tech+Mono&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        button { font-family: inherit; }
        input, select { font-family: inherit; border-radius: 6px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #fff; }
        ::-webkit-scrollbar { width: 3px; } ::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }
        select option { background: #1c1c1c; color: #f0f0f0; }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.2} }
        .blink { animation: blink 1.4s infinite; }
        .hide-mobile { display: flex; }
        .nav-label { display: inline; }
        @media (max-width: 640px) {
          .hide-mobile { display: none; }
          .nav-label { display: none; }
          .main-content { padding-bottom: 72px !important; }
          .desktop-nav { position: fixed !important; top: auto !important; bottom: 0 !important; left: 0; right: 0; border-bottom: none !important; border-top: 2px solid #4499ff !important; z-index: 200; justify-content: space-around; background: rgba(10,10,20,0.95) !important; }
        }
      `}</style>

      {/* Header */}
      <header style={{ background: "rgba(10,10,20,0.85)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(0,255,136,0.15)", padding: "0 14px", height: 44, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ background: "linear-gradient(135deg, " + T.green + ", " + T.cyan + ")", width: 28, height: 28, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 12px rgba(0,255,136,0.4)" }}>
            <Scissors size={16} color="#000" strokeWidth={2} />
          </div>
          <div>
            <p style={{ fontSize: 18, fontWeight: 900, color: T.text, letterSpacing: "0.08em", lineHeight: 1 }}>ORIGENTEX</p>
            <p style={{ fontSize: 8, color: T.muted, letterSpacing: "0.14em", fontFamily: T.mono }}>CONTROL DE PISO</p>
          </div>
          <div className="hide-mobile" style={{ alignItems: "center", gap: 6, marginLeft: 8 }}>
            <span className="blink" style={{ width: 6, height: 6, borderRadius: "50%", background: dbListo ? T.green : T.yellow, display: "inline-block" }} />
            <span style={{ fontSize: 9, color: dbListo ? T.green : T.yellow, fontFamily: T.mono }}>{dbListo ? "CONECTADO" : "SINCRONIZANDO..."}</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: T.green, fontFamily: T.mono }}>{hora}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.04)", border: "1px solid " + rol.color + "33", borderLeft: "3px solid " + rol.color, padding: "4px 10px", borderRadius: 8 }}>
            <span>{rol.icon}</span>
            <div className="hide-mobile">
              <p style={{ fontSize: 11, fontWeight: 700, color: T.text, lineHeight: 1 }}>{sesion.nombre}</p>
              <p style={{ fontSize: 9, color: rol.color, fontFamily: T.mono }}>{rol.label}</p>
            </div>
          </div>
          <button onClick={cerrarSesion} style={{ background: "transparent", border: "1px solid #4499ff", color: "#4499ff", fontFamily: T.mono, fontSize: 10, padding: "5px 10px", cursor: "pointer", borderRadius: 6 }}>SALIR</button>
        </div>
      </header>
      {/* Aviso de inactividad */}
      {sesion && Date.now() - ultimaActividad > INACTIVIDAD_MS * 0.8 && (
        <div style={{ background: "rgba(255,230,0,0.1)", borderBottom: "1px solid " + T.yellow, padding: "6px 16px", textAlign: "center" }}>
          <p style={{ fontSize: 10, color: T.yellow, fontFamily: T.mono }}>⚠ Sesión por expirar por inactividad — toca cualquier parte para continuar</p>
        </div>
      )}

      {/* Nav */}
      <nav className="desktop-nav" style={{ background: "rgba(10,10,20,0.85)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", overflowX: "auto", position: "sticky", top: 44, zIndex: 99 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ flex: 1, minWidth: 0, padding: "9px 8px 8px", fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", background: "transparent", color: tab === t.id ? "#4499ff" : T.muted, border: "none", borderBottom: tab === t.id ? "2px solid #4499ff" : "2px solid transparent", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            <span style={{ fontSize: 18, lineHeight: 1 }}>{t.icon}</span>
            <span className="nav-label" style={{ fontSize: 9, letterSpacing: "0.06em" }}>{t.label}</span>
          </button>
        ))}
      </nav>

      {/* Content */}
      <main className="main-content" style={{ maxWidth: 1280, margin: "0 auto", padding: "14px 12px" }}>
        {tab === "inicio" && (
          sesion.rol === "DIRECTOR_PRODUCCION" ? <HomeDirector setTab={setTab} ordenes={ordenes} usuarios={usuarios} registrosGlobales={registrosGlobales} /> :
          sesion.rol === "COMERCIAL"           ? <HomeComercial setTab={setTab} /> :
          sesion.rol === "JEFE_COMPRAS"        ? <HomeJefeCompras setTab={setTab} /> :
          sesion.rol === "JEFE_CORTE"          ? <HomeJefeCorte setTab={setTab} /> :
          sesion.rol === "SUPERVISOR"          ? <HomeSupervisor setTab={setTab} ordenes={ordenes} operarios={operarios} usuarios={usuarios} registrosGlobales={registrosGlobales} asignaciones={asignaciones} /> :
          <AdminHome setTab={setTab} ordenes={ordenes} operarios={operarios} usuarios={usuarios} registrosGlobales={registrosGlobales} logActividad={logActividad} sesion={sesion} />
        )}
        {tab === "pipeline"   && <PipelineProduccion ordenes={ordenes} />}
        {tab === "pedidos"    && <GestionPedidos pedidos={pedidos} setPedidos={setPedidosSync} catalogo={catalogo} sesion={sesion} ordenes={ordenes} setOrdenes={setOrdenesSync} />}
        {tab === "inventario" && <GestionInventario />}
        {tab === "corte"      && <GestionCorte />}
        {tab === "dashboard"  && <Dashboard ordenes={ordenes} operarios={operarios} registrosGlobales={registrosGlobales} usuarios={usuarios} asignaciones={asignaciones} horarios={horarios} />}
        {tab === "ordenes"    && <GestionOrdenes ordenes={ordenes} setOrdenes={setOrdenesSync} operarios={operarios} catalogo={catalogo} />}
        {tab === "catalogo"   && <GestionCatalogo catalogo={catalogo} setCatalogo={setCatalogoSync} maquinas={maquinas} setMaquinas={setMaquinas} sesion={sesion} />}
        {tab === "operarios"  && <GestionOperarios operarios={operarios} setOperarios={setOperarios} ordenes={ordenes} usuarios={usuarios} asignaciones={asignaciones} setAsignaciones={setAsignacionesSync} mensajes={mensajes} setMensajes={setMensajes} sesion={sesion} registrosGlobales={registrosGlobales} horarios={horarios} setHorarios={setHorariosSync} />}
        {tab === "eficiencia" && <Eficiencia ordenes={ordenes} operarios={operarios} registrosGlobales={registrosGlobales} usuarios={usuarios} />}
        {tab === "horarios"   && <ConfigHorarios horarios={horarios} setHorarios={setHorariosSync} sesion={sesion} />}
        {tab === "reporte"    && <ReporteDiario registrosGlobales={registrosGlobales} usuarios={usuarios} ordenes={ordenes} asignaciones={asignaciones} />}
        {tab === "usuarios"   && <GestionUsuarios usuarios={usuarios} setUsuarios={setUsuarios} sesion={sesion} />}
        {tab === "log"        && <Log logActividad={logActividad} setLogActividad={setLogActividad} />}
      </main>
    </div>
  );
}
