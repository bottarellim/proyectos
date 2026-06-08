// ============================================================
// CONFIGURACIÓN SUPABASE
// ============================================================
const SUPABASE_URL = 'https://ftpcqmzgpvzhwrckqlii.supabase.co';
const SUPABASE_KEY = 'sb_publishable_wNpK1pS7uhnHKp9AOEzskA_5j8U9dD6';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================================
// CONSTANTES
// ============================================================
const ESTADOS_CLIENTE = ['Activo', 'Potencial', 'Inactivo', 'Suspendido'];
const EC_CLASS = { Activo: 'ec-Activo', Potencial: 'ec-Potencial', Inactivo: 'ec-Inactivo', Suspendido: 'ec-Suspendido' };
const GRUPOS_TRABAJO = [
  { g: '— Común —', e: ['Sin Iniciar', 'En Relevamiento'] },
  { g: '— Camino 1: Con Presupuesto —', e: ['Presupuestado', 'Esperando Aprobación', 'En Ejecución', 'Avanzado', 'Terminado', 'Facturar', 'Cobrado'] },
  { g: '— Camino 2: De Palabra —', e: ['Aprobado de Palabra', 'En Ejecución sin Presupuesto', 'Avanzado sin Presupuesto', 'Terminado sin Presupuesto', 'Presupuestar', 'Aprobar', 'Facturar', 'Cobrado'] }
];
const ESTADOS_TRABAJO = [...new Set(GRUPOS_TRABAJO.flatMap(g => g.e))];
const ET_CLASS = {
  'Sin Iniciar': 'etj-SinIniciar', 'En Relevamiento': 'etj-Gris',
  'Presupuestado': 'etj-Presupuestado', 'Esperando Aprobación': 'etj-IniciadoSinAprobar',
  'En Ejecución': 'etj-Iniciado', 'Avanzado': 'etj-AvanzadoFaltaTerminar',
  'Terminado': 'etj-Terminado', 'Facturar': 'etj-Cobrado', 'Cobrado': 'etj-Cobrado',
  'Aprobado de Palabra': 'etj-IniciadoSinAprobar', 'En Ejecución sin Presupuesto': 'etj-AvanzadoFaltaTerminar',
  'Avanzado sin Presupuesto': 'etj-AvanzadoFaltaTerminar', 'Terminado sin Presupuesto': 'etj-Terminado',
  'Presupuestar': 'etj-Presupuestado', 'Aprobar': 'etj-Aprobado'
};
const COLOR_HEX = {
  amarillo: '#f59e0b', rojo: '#dc2626', verde: '#10b981', violeta: '#7c3aed',
  gris: '#475569', celeste: '#0ea5e9', naranja: '#f97316', turquesa: '#0d9488', esmeralda: '#059669'
};
const ET_COLOR = {
  'Sin Iniciar': null, 'En Relevamiento': 'gris', 'Presupuestado': 'violeta',
  'Esperando Aprobación': 'amarillo', 'En Ejecución': 'celeste', 'Avanzado': 'naranja',
  'Terminado': 'verde', 'Facturar': 'turquesa', 'Cobrado': 'turquesa',
  'Aprobado de Palabra': 'amarillo', 'En Ejecución sin Presupuesto': 'rojo',
  'Avanzado sin Presupuesto': 'naranja', 'Terminado sin Presupuesto': 'esmeralda',
  'Presupuestar': 'violeta', 'Aprobar': 'esmeralda'
};
const OPCIONES_ABONO = ['Sin Abono', 'Abono'];
const ESTADOS = ['Pendiente', 'En proceso', 'Terminado'];
const PRIORIDADES = ['', 'Alta', 'Media', 'Baja'];

// ============================================================
// ESTADO GLOBAL
// ============================================================
let clientes = [];
let vistaActual = 'clientes';
let clienteActual = null;
let _saving = false;
let _pendingSave = false;
let _confirmedJson = null;
const _ownTimestamps = new Set();
const _selected = new Set();
const _history = [];
const expandedKeys = new Set();

// ============================================================
// AUTH
// ============================================================
// Supabase JS v2 fires INITIAL_SESSION on page load (if cached session exists),
// and SIGNED_IN on explicit login. Both must trigger initData.
sb.auth.onAuthStateChange(async (event, session) => {
  if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session) {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    document.getElementById('user-email').textContent = session.user.email;
    subscribeRealtime();
    await initData();
  }
  if (event === 'SIGNED_OUT') {
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
    document.getElementById('l-btn').textContent = 'Ingresar';
    document.getElementById('l-btn').disabled = false;
  }
});

async function doLogin() {
  const btn = document.getElementById('l-btn');
  const err = document.getElementById('l-err');
  const email = document.getElementById('l-email').value.trim();
  const pass = document.getElementById('l-pass').value;
  if (!email || !pass) { err.textContent = 'Completá email y contraseña.'; return; }
  btn.textContent = 'Ingresando...';
  btn.disabled = true;
  err.textContent = '';
  const { error } = await sb.auth.signInWithPassword({ email, password: pass });
  if (error) {
    err.textContent = error.message.includes('Invalid') ? 'Email o contraseña incorrectos' : error.message;
    btn.textContent = 'Ingresar';
    btn.disabled = false;
  }
}

async function doLogout() {
  document.getElementById('l-err').textContent = '';
  forceRelogin();
}

function forceRelogin() {
  clearTimeout(window._it);  // CRÍTICO: cancelar timer de guardado pendiente
  _saving = false;
  _pendingSave = false;
  sb.auth.signOut().catch(() => {});
  localStorage.removeItem('ciaber_v2');
  clientes = [];
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
  document.getElementById('l-btn').textContent = 'Ingresar';
  document.getElementById('l-btn').disabled = false;
  document.getElementById('l-email').value = '';
  document.getElementById('l-pass').value = '';
  document.getElementById('l-err').textContent = 'Tu sesión expiró. Volvé a ingresar.';
}

// ============================================================
// DATOS — HELPERS
// ============================================================
function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function fixClientes(arr) {
  if (!Array.isArray(arr)) return [];
  arr.forEach(c => {
    if (!c.id) c.id = newId();
    if (!c.estado) c.estado = 'Activo';
    if (!c.proyectos) c.proyectos = [];
    c.proyectos.forEach(p => {
      if (!p.id) p.id = newId();
      if (!p.adjuntos) p.adjuntos = [];
      if (!p.tareas) p.tareas = [];
      if (!p.subpuntos) p.subpuntos = [];
      if (p.fechaEstimada == null) p.fechaEstimada = '';
      if (p.nroTicket == null) p.nroTicket = '';
      p.tareas.forEach(t => {
        if (!t.adjuntos) t.adjuntos = [];
        if (!t.subtareas) t.subtareas = [];
        if (t.fechaEstimada == null) t.fechaEstimada = '';
        if (t.nroTicket == null) t.nroTicket = '';
        t.subtareas.forEach(st => {
          if (!st.adjuntos) st.adjuntos = [];
          if (st.fechaEstimada == null) st.fechaEstimada = '';
          if (st.nroTicket == null) st.nroTicket = '';
        });
      });
      p.subpuntos.forEach(s => {
        if (!s.id) s.id = newId();
        if (!s.tareas) s.tareas = [];
        if (s.fechaEstimada == null) s.fechaEstimada = '';
        s.tareas.forEach(t => {
          if (!t.adjuntos) t.adjuntos = [];
          if (!t.subtareas) t.subtareas = [];
          if (t.fechaEstimada == null) t.fechaEstimada = '';
          if (t.nroTicket == null) t.nroTicket = '';
          t.subtareas.forEach(st => {
            if (!st.adjuntos) st.adjuntos = [];
            if (st.fechaEstimada == null) st.fechaEstimada = '';
            if (st.nroTicket == null) st.nroTicket = '';
          });
        });
      });
    });
  });
  return arr;
}

function migrarDesdeFormatoViejo(viejos) {
  const c = { id: newId(), nombre: 'Ciaber', estado: 'Activo', nota: '', color: null, proyectos: [] };
  c.proyectos = viejos.map(p => ({
    id: newId(), nombre: p.nombre || '', estadoTrabajo: p.estadoTrabajo || 'Sin Iniciar',
    abono: p.abono || 'Sin Abono', color: p.color || null, nota: p.nota || '',
    adjuntos: [], fechaTerminado: p.fechaTerminado || null, fechaEstimada: '', nroTicket: '',
    tareas: (p.tareas || []).map(t => ({
      id: t.id, tarea: t.tarea || '', estado: t.estado || 'Pendiente', prioridad: t.prioridad || '',
      fechaEstimada: '', nroTicket: '', adjuntos: [],
      subtareas: (t.subtareas || []).map(st => ({
        id: st.id, tarea: st.tarea || '', estado: st.estado || 'Pendiente', prioridad: st.prioridad || '',
        fechaEstimada: '', nroTicket: '', adjuntos: []
      }))
    })),
    subpuntos: (p.subpuntos || []).map(s => ({
      id: newId(), nombre: s.nombre || '', desc: s.desc || '', fechaEstimada: '',
      tareas: (s.tareas || []).map(t => ({
        id: t.id, tarea: t.tarea || '', estado: t.estado || 'Pendiente', prioridad: t.prioridad || '',
        fechaEstimada: '', nroTicket: '', adjuntos: [],
        subtareas: (t.subtareas || []).map(st => ({
          id: st.id, tarea: st.tarea || '', estado: st.estado || 'Pendiente', prioridad: st.prioridad || '',
          fechaEstimada: '', nroTicket: '', adjuntos: []
        }))
      }))
    }))
  }));
  return [c];
}

// ============================================================
// CARGAR DATOS
// ============================================================
async function initData(retryN = 0) {
  // Mostrar datos locales inmediatamente para que la UI no quede en blanco
  if (retryN === 0) {
    const local = localStorage.getItem('ciaber_v2');
    if (local) {
      try {
        const d = JSON.parse(local);
        if (d.clientes?.length) { clientes = fixClientes(d.clientes); renderVista(); }
      } catch (e) {}
    }
    setSyncDot(false, 'Conectando...');
  }
  try {
    const { data: row, error } = await sb.from('app_data').select('clientes').eq('id', 1).single();
    if (error) throw error;
    if (row?.clientes && row.clientes.length > 0) {
      clientes = fixClientes(row.clientes);
    } else {
      // Supabase vacío — intentar migrar desde localStorage o formato viejo
      const localV2 = localStorage.getItem('ciaber_v2');
      const localViejo = localStorage.getItem('ciaber_puntos_v3');
      if (localV2) {
        try { const d = JSON.parse(localV2); if (d.clientes?.length) clientes = fixClientes(d.clientes); } catch (e) {}
      } else if (localViejo) {
        try { clientes = migrarDesdeFormatoViejo(JSON.parse(localViejo)); } catch (e) {}
      }
      if (!clientes.length) {
        clientes = [{ id: newId(), nombre: 'Ciaber', estado: 'Activo', nota: '', color: null, proyectos: [] }];
      }
      await saveToSupabase(); // Solo guardar si es realmente primera vez
    }
    localStorage.setItem('ciaber_v2', JSON.stringify({ clientes }));
    _confirmedJson = JSON.stringify(clientes);
    setSyncDot(true);
    renderVista();
  } catch (e) {
    console.error('Error cargando datos:', e);
    if (retryN < 5) {
      setSyncDot(false, 'Reintentando (' + (retryN + 1) + '/5)...');
      setTimeout(() => initData(retryN + 1), Math.min((retryN + 1) * 2000, 10000));
    } else {
      setSyncDot(false, 'Sin conexión');
      showSaved('⚠ Sin conexión — datos locales');
    }
  }
}

async function recuperarDatos() {
  setSyncDot(false, 'Recuperando...');
  showSaved('⏳ Recuperando...');
  try {
    const { data: row, error } = await sb.from('app_data').select('clientes').eq('id', 1).single();
    if (error) throw error;
    if (row?.clientes && row.clientes.length > 0) {
      clientes = fixClientes(row.clientes);
      localStorage.setItem('ciaber_v2', JSON.stringify({ clientes }));
      _confirmedJson = JSON.stringify(clientes);
      setSyncDot(true);
      renderVista();
      showSaved('✓ Datos recuperados');
    } else {
      showSaved('⚠ Sin datos en servidor');
      setSyncDot(false, 'Sin datos');
    }
  } catch (e) {
    console.error('Error recuperando:', e);
    showSaved('⚠ Error al recuperar');
    setSyncDot(false, 'Error');
  }
}

// ============================================================
// GUARDAR DATOS — VERSIÓN SEGURA
// Nunca guarda clientes vacío. No llama forceRelogin desde aquí.
// ============================================================
async function saveToSupabase() {
  // CRÍTICO: nunca guardar array vacío — protege contra borrado accidental
  if (!clientes || !clientes.length) {
    console.warn('saveToSupabase abortado: clientes vacío');
    return false;
  }
  if (_saving) { _pendingSave = true; return false; }
  _saving = true;
  const ts = new Date().toISOString();
  _ownTimestamps.add(ts);
  let ok = false;
  try {
    const { error } = await sb.from('app_data').upsert({ id: 1, clientes, updated_at: ts });
    if (error) throw error;
    localStorage.setItem('ciaber_v2', JSON.stringify({ clientes }));
    _confirmedJson = JSON.stringify(clientes);
    ok = true;
  } catch (e) {
    console.error('Error guardando:', e);
    _ownTimestamps.delete(ts);
    showSaved('⚠ Error al guardar — sin conexión');
    setSyncDot(false, 'Error al guardar');
  }
  _saving = false;
  if (_pendingSave) { _pendingSave = false; saveToSupabase(); }
  return ok;
}

function save() {
  showSaved('⏳ Guardando...');
  saveToSupabase().then(ok => {
    if (ok) showSaved('✓ Guardado ' + new Date().toLocaleTimeString());
  });
}

// ============================================================
// UI HELPERS
// ============================================================
function showSaved(msg) {
  const s = document.getElementById('saved');
  if (!s) return;
  s.textContent = msg;
  clearTimeout(window._st);
  if (!msg.startsWith('⏳')) window._st = setTimeout(() => s.textContent = '', 2500);
}

function setSyncDot(on, msg) {
  const d = document.getElementById('sync-dot');
  const l = document.getElementById('sync-label');
  if (d) d.className = 'sync-dot' + (on ? '' : ' off');
  if (l) { l.textContent = msg || (on ? '' : 'Sin conexión'); l.className = 'sync-label' + (on ? '' : ' err'); }
}

// ============================================================
// REALTIME
// ============================================================
let _rtChannel = null;
let _rtRetryCount = 0;
let _rtRetryTimer = null;

function subscribeRealtime() {
  clearTimeout(_rtRetryTimer);
  if (_rtChannel) { try { sb.removeChannel(_rtChannel); } catch (e) {} }
  _rtChannel = sb.channel('app_rt_' + Date.now())
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'app_data' }, payload => {
      if (!payload.new?.clientes) return;
      const ts = payload.new?.updated_at;
      if (ts && _ownTimestamps.has(ts)) { _ownTimestamps.delete(ts); return; }
      if (_saving || _pendingSave) return;
      const prevClientId = clienteActual != null ? clientes[clienteActual]?.id : null;
      pushHistory();
      clientes = fixClientes(payload.new.clientes);
      _confirmedJson = JSON.stringify(clientes);
      localStorage.setItem('ciaber_v2', JSON.stringify({ clientes }));
      if (prevClientId && vistaActual === 'proyectos') {
        const newIdx = clientes.findIndex(c => c.id === prevClientId);
        if (newIdx >= 0) clienteActual = newIdx;
        else { clienteActual = null; vistaActual = 'clientes'; }
      }
      renderVista();
      showSaved('⟳ Actualizado');
    })
    .subscribe(status => {
      const ok = status === 'SUBSCRIBED';
      setSyncDot(ok, ok ? '' : (status === 'TIMED_OUT' ? 'Timeout' : 'Sin conexión'));
      if (!ok && status !== 'SUBSCRIBING') {
        const delay = Math.min(_rtRetryCount * 5000 + 5000, 30000);
        _rtRetryCount++;
        setSyncDot(false, 'Reintentando...');
        _rtRetryTimer = setTimeout(subscribeRealtime, delay);
      } else if (ok) {
        _rtRetryCount = 0;
      }
    });
}

async function reconectar() {
  setSyncDot(false, 'Reconectando...');
  _rtRetryCount = 0;
  subscribeRealtime();
  await initData();
}

// ============================================================
// ADJUNTOS — SUPABASE STORAGE
// ============================================================
async function handleUpload(event, refTipo, refId, adjArr) {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = '';
  if (file.size > 50 * 1024 * 1024) { alert('Archivo muy grande (máx 50MB).'); return; }
  showSaved('⏳ Subiendo archivo...');
  const ext = file.name.split('.').pop();
  const path = `${refTipo}/${refId}/${newId()}.${ext}`;
  const { error } = await sb.storage.from('archivos').upload(path, file, { contentType: file.type, upsert: false });
  if (error) { showSaved('⚠ Error subiendo archivo'); console.error(error); return; }
  adjArr.push({ id: newId(), nombre: file.name, storage_path: path, tipo_mime: file.type });
  await saveToSupabase();
  showSaved('✓ Archivo subido');
  renderVista();
}

async function openFile(storagePath) {
  showSaved('⏳ Abriendo...');
  const { data, error } = await sb.storage.from('archivos').createSignedUrl(storagePath, 3600);
  if (error || !data?.signedUrl) { showSaved('⚠ Error abriendo archivo'); return; }
  showSaved('');
  window.open(data.signedUrl, '_blank');
}

async function delArchivo(adjArr, idx) {
  const adj = adjArr[idx];
  if (!adj) return;
  if (!confirm(`¿Eliminar "${adj.nombre}"?`)) return;
  if (adj.storage_path) await sb.storage.from('archivos').remove([adj.storage_path]);
  adjArr.splice(idx, 1);
  save(); renderVista();
}

function icono(mime) {
  if (!mime) return '📎';
  if (mime.startsWith('image')) return '🖼️';
  if (mime.includes('pdf')) return '📄';
  if (mime.includes('word') || mime.includes('document')) return '📝';
  if (mime.includes('sheet') || mime.includes('excel')) return '📊';
  return '📎';
}

// ============================================================
// HELPERS RENDER
// ============================================================
const ESC = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const opt = (arr, v) => arr.map(o => `<option value="${o}"${o === v ? ' selected' : ''}>${o || '—'}</option>`).join('');
function optTrabajo(val) {
  return GRUPOS_TRABAJO.map(g =>
    `<optgroup label="${g.g}">${g.e.map(e => `<option value="${e}"${e === val ? ' selected' : ''}>${e}</option>`).join('')}</optgroup>`
  ).join('');
}

function pctOf(arr) {
  let t = 0, h = 0;
  arr.forEach(x => {
    t++; if (x.estado === 'Terminado') h++;
    (x.subtareas || []).forEach(s => { t++; if (s.estado === 'Terminado') h++; });
  });
  return t ? Math.round(h * 100 / t) : 0;
}

function allTareasProy(p) {
  return [...(p.tareas || []), ...(p.subpuntos || []).flatMap(s => s.tareas || [])];
}

// ============================================================
// RENDER TAREAS
// ============================================================
function renderTareas(tareas, ci, pi, kind, si) {
  const q = document.getElementById('q');
  const f = q ? q.value.toLowerCase() : '';
  let html = `<div class="tree">`;
  tareas.forEach((t, ti) => {
    const vis = !f || t.tarea.toLowerCase().includes(f) || (t.subtareas || []).some(st => st.tarea.toLowerCase().includes(f));
    if (!vis) return;
    const base = kind === 's' ? `${ci}|s|${pi}|${si}|${ti}` : `${ci}|t|${pi}|${ti}`;
    const refId = t.id || base;
    const adjPath = kind === 's'
      ? `Promise.resolve(clientes[${ci}].proyectos[${pi}].subpuntos[${si}].tareas[${ti}].adjuntos)`
      : `Promise.resolve(clientes[${ci}].proyectos[${pi}].tareas[${ti}].adjuntos)`;
    const adjMini = (t.adjuntos || []).length
      ? `<div class="task-adj-mini">${(t.adjuntos || []).map(a =>
          `<div class="task-adj-chip"><span>${icono(a.tipo_mime)}</span><a onclick="openFile('${a.storage_path}')">${ESC(a.nombre)}</a></div>`
        ).join('')}</div>`
      : '';
    const uploadId = 'tup_' + refId;
    const rowStyle = t.estado === 'Terminado'
      ? 'background:#d1fae5;border-left:2px solid #10b981'
      : t.estado === 'En proceso' ? 'background:#fff7ed;border-left:2px solid #f97316' : '';
    html += `<div class="node task" style="${rowStyle}">
      <span class="tree-id">${ESC(t.id)}</span>
      <div class="tree-tx">
        <textarea class="txt" data-path="${base}" data-k="tarea">${ESC(t.tarea)}</textarea>
        ${adjMini}
      </div>
      <div class="tree-meta">
        <input type="text" class="nro-ticket" data-path="${base}" data-k="nroTicket" value="${ESC(t.nroTicket || '')}" placeholder="Sin ticket">
        <input type="date" class="fecha-est" data-path="${base}" data-k="fechaEstimada" value="${ESC(t.fechaEstimada || '')}" title="Fecha estimada">
        <select class="est" data-path="${base}" data-k="estado">${opt(ESTADOS, t.estado)}</select>
        <select class="pri" data-path="${base}" data-k="prioridad">${opt(PRIORIDADES, t.prioridad)}</select>
        <button class="btn-sub" onclick="document.getElementById('${uploadId}').click()" title="Adjuntar">📎</button>
        <input type="file" id="${uploadId}" class="adj-upload-inp" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
          onchange="${adjPath}.then(arr=>handleUpload(event,'tarea','${refId}',arr))">
        <button class="btn-save" onclick="guardarAhora(this)">✓</button>
        <button class="btn-sub" onclick="addSub('${base}')">+sub</button>
        <input type="checkbox" class="sel-cb" data-sel="t|${base}" onclick="toggleSel(this)" title="Seleccionar para eliminar">
        <button class="del" onclick="delTarea('${base}')">✕</button>
      </div></div>`;
    if ((t.subtareas || []).length) {
      html += `<div style="margin-left:14px">`;
      t.subtareas.forEach((st, sti) => {
        const spath = `${base}|${sti}`;
        const stStyle = st.estado === 'Terminado' ? 'background:#d1fae5;border-left:2px solid #10b981' : '';
        html += `<div class="node subtask" style="${stStyle}">
          <span class="tree-id">${ESC(st.id || '└')}</span>
          <div class="tree-tx"><textarea class="txt" data-path="${spath}" data-k="tarea">${ESC(st.tarea)}</textarea></div>
          <div class="tree-meta">
            <input type="text" class="nro-ticket" data-path="${spath}" data-k="nroTicket" value="${ESC(st.nroTicket || '')}" placeholder="Sin ticket">
            <input type="date" class="fecha-est" data-path="${spath}" data-k="fechaEstimada" value="${ESC(st.fechaEstimada || '')}" title="Fecha estimada">
            <select class="est" data-path="${spath}" data-k="estado">${opt(ESTADOS, st.estado)}</select>
            <select class="pri" data-path="${spath}" data-k="prioridad">${opt(PRIORIDADES, st.prioridad)}</select>
            <input type="checkbox" class="sel-cb" data-sel="st|${spath}" onclick="toggleSel(this)" title="Seleccionar para eliminar">
            <button class="del" onclick="delSub('${spath}')">✕</button>
          </div></div>`;
      });
      html += `</div>`;
    }
  });
  html += `</div>`;
  return html;
}

// ============================================================
// RENDER PROYECTO BODY
// ============================================================
function renderProyectoBody(p, ci, pi) {
  const total = allTareasProy(p).length;
  const adjPath = `Promise.resolve(clientes[${ci}].proyectos[${pi}].adjuntos)`;
  const uploadId = 'pup_' + p.id;
  const adjItems = (p.adjuntos || []).map((a, i) => `
    <div class="adj-item">
      <span>${icono(a.tipo_mime)}</span>
      <a onclick="openFile('${a.storage_path}')" title="${ESC(a.nombre)}">${ESC(a.nombre)}</a>
      <span class="adj-del-btn" onclick="${adjPath}.then(arr=>delArchivo(arr,${i}))">✕</span>
    </div>`).join('');

  let tareasHtml;
  if (p.subpuntos && p.subpuntos.length) {
    tareasHtml = p.subpuntos.map((s, si) => `
      <div class="subp-node">
        <div class="subp-head">
          <span class="toggle-sp" onclick="this.classList.toggle('col');this.parentElement.nextElementSibling.classList.toggle('collapsed-ch')">▼</span>
          <input data-path="${ci}|sp|${pi}|${si}" data-k="nombreSub" value="${ESC(s.nombre)}" placeholder="Nombre de la fase...">
          <input type="date" class="fecha-est" data-path="${ci}|sp|${pi}|${si}" data-k="fechaEstimada" value="${ESC(s.fechaEstimada || '')}" title="Fecha estimada de la fase">
          <button class="btn-save" onclick="guardarAhora(this)">✓</button>
          <button class="del" onclick="delSubpunto(${ci},${pi},${si})">✕</button>
        </div>
        <div>
          <div class="nota-box"><textarea data-path="${ci}|sp|${pi}|${si}" data-k="descSub" placeholder="Descripción de la fase...">${ESC(s.desc || '')}</textarea></div>
          ${renderTareas(s.tareas || [], ci, pi, 's', si)}
          <button class="add" style="margin:4px 0 0 10px" onclick="addTarea('s|${ci}|${pi}|${si}')">+ Nueva Tarea en fase</button>
        </div>
      </div>`).join('');
  } else {
    tareasHtml = renderTareas(p.tareas || [], ci, pi, 't');
  }

  return `
    <div style="display:flex;gap:10px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
      <label style="font-size:11px;color:#6b7280;display:flex;align-items:center;gap:4px">📅 Fecha estimada
        <input type="date" class="fecha-est" data-path="${ci}|p|${pi}" data-k="fechaEstimada" value="${ESC(p.fechaEstimada || '')}">
      </label>
      <label style="font-size:11px;color:#6b7280;display:flex;align-items:center;gap:4px">🎫 Ticket
        <input type="text" class="nro-ticket" data-path="${ci}|p|${pi}" data-k="nroTicket" value="${ESC(p.nroTicket || '')}" placeholder="Sin ticket">
      </label>
    </div>
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
      <div class="tareas-toggle" data-tkey="tareas-${ci}-${pi}" onclick="toggleTareas(this)">
        <span class="t-arrow">▶</span> Tareas <span style="color:#9ca3af;font-weight:400">(${total})</span>
        <button class="add" style="font-size:11px;padding:1px 8px;margin-left:8px" onclick="event.stopPropagation();quickAddTarea(${ci},${pi})">+ Nueva Tarea</button>
      </div>
      <button class="add" style="font-size:11px;padding:2px 8px" onclick="addSubpunto(${ci},${pi})" title="Nueva Fase">+ Nueva Fase</button>
    </div>
    <div style="display:none">${tareasHtml}</div>
    <div class="nota-box"><textarea data-path="${ci}|p|${pi}" data-k="nota" placeholder="Notas del proyecto...">${ESC(p.nota || '')}</textarea></div>
    <div class="adj-section">
      <div class="adj-title">📎 Adjuntos del proyecto
        <button class="btn-adj" onclick="document.getElementById('${uploadId}').click()">+ Adjuntar</button>
        <input type="file" id="${uploadId}" class="adj-upload-inp" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip"
          onchange="${adjPath}.then(arr=>handleUpload(event,'proyecto','${p.id}',arr))">
      </div>
      <div class="adj-list">${adjItems}</div>
    </div>`;
}

// ============================================================
// RENDER VISTAS
// ============================================================
function renderClientes() {
  document.getElementById('btn-add').textContent = '+ Nuevo Cliente';
  document.getElementById('filtroAbono').style.display = 'none';
  const filtroSel = document.getElementById('filtroEstado');
  if (filtroSel.options.length <= 1) {
    ESTADOS_CLIENTE.forEach(e => {
      const o = document.createElement('option');
      o.value = e; o.textContent = e;
      filtroSel.appendChild(o);
    });
  }
  const q = document.getElementById('q').value.toLowerCase();
  const fv = filtroSel.value;
  const lista = clientes.filter(c =>
    (!fv || (c.estado || 'Activo') === fv) && (!q || c.nombre.toLowerCase().includes(q))
  );
  document.getElementById('filtroCount').textContent = fv ? `${lista.length} cliente${lista.length !== 1 ? 's' : ''}` : '';
  document.getElementById('breadcrumb').innerHTML = `<span class="cur">Clientes</span>`;

  if (!lista.length) {
    document.getElementById('root').innerHTML = `<div class="empty"><div class="empty-icon">🏢</div><p>No hay clientes. Hacé clic en <b>+ Nuevo Cliente</b>.</p></div>`;
    return;
  }
  document.getElementById('root').innerHTML = `<div class="lista-c">${lista.map(c => {
    const ci = clientes.indexOf(c);
    const strip = COLOR_HEX[c.color] || '#305496';
    return `<div class="it-wrap" data-ek="c-${ci}">
      <div class="it-row" onclick="if(event.target.tagName==='INPUT'||event.target.tagName==='BUTTON'||event.target.tagName==='SELECT')return;abrirCliente(${ci})">
        <div class="it-strip" style="background:${strip}"></div>
        <span class="it-arrow" style="transform:rotate(90deg);cursor:default">▶</span>
        <input class="nm-c" data-path="${ci}|c" data-k="nombre" value="${ESC(c.nombre)}" onclick="event.stopPropagation()">
        <div class="it-meta">
          <select class="est-cliente ${EC_CLASS[c.estado || 'Activo']}" data-path="${ci}|c" data-k="estadoCliente" onclick="event.stopPropagation()">${opt(ESTADOS_CLIENTE, c.estado || 'Activo')}</select>
          <span class="it-count">${c.proyectos.length} proy.</span>
          <button class="del it-del" onclick="event.stopPropagation();delCliente(${ci})">✕</button>
        </div>
      </div>
    </div>`;
  }).join('')}</div>`;
  bindEvents();
}

function renderProyectos(ci) {
  const c = clientes[ci];
  if (!c) return;
  document.getElementById('btn-add').textContent = '+ Nuevo Proyecto';
  document.getElementById('filtroAbono').style.display = '';
  const filtroSel = document.getElementById('filtroEstado');
  const savedFv = filtroSel.value;
  filtroSel.innerHTML = '<option value="">📋 Todos los estados</option>';
  GRUPOS_TRABAJO.forEach(g => {
    const og = document.createElement('optgroup');
    og.label = g.g;
    g.e.forEach(e => {
      const o = document.createElement('option');
      o.value = e; o.textContent = e;
      og.appendChild(o);
    });
    filtroSel.appendChild(og);
  });
  if (savedFv) filtroSel.value = savedFv;
  const q = document.getElementById('q').value.toLowerCase();
  const fv = filtroSel.value;
  const fAb = document.getElementById('filtroAbono').value;
  const lista = c.proyectos.filter(p => {
    if (fv && (p.estadoTrabajo || 'Sin Iniciar') !== fv) return false;
    if (fAb && (p.abono || 'Sin Abono') !== fAb) return false;
    if (q && !p.nombre.toLowerCase().includes(q)) return false;
    return true;
  });
  document.getElementById('filtroCount').textContent = (fv || fAb) ? `${lista.length} proyecto${lista.length !== 1 ? 's' : ''}` : '';
  document.getElementById('breadcrumb').innerHTML = `<a onclick="volverClientes()">Clientes</a><span class="sep">›</span><span class="cur">${ESC(c.nombre)}</span>`;

  if (!lista.length) {
    document.getElementById('root').innerHTML = `<div class="empty"><div class="empty-icon">📁</div><p>No hay proyectos. Hacé clic en <b>+ Nuevo Proyecto</b>.</p></div>`;
    return;
  }
  document.getElementById('root').innerHTML = `<div class="lista-c">${lista.map(p => {
    const pi = c.proyectos.indexOf(p);
    const t = allTareasProy(p);
    const total = t.length + t.reduce((a, x) => a + (x.subtareas || []).length, 0);
    const pct = pctOf(t);
    const strip = COLOR_HEX[p.color] || '#305496';
    return `<div class="it-wrap" data-ek="p-${ci}-${pi}">
      <div class="it-row">
        <div class="it-strip" style="background:${strip}"></div>
        <span class="it-arrow" onclick="toggleExpand(event)" style="cursor:pointer;padding:12px 6px">▶</span>
        <input class="nm-c" data-path="${ci}|p|${pi}" data-k="nombre" value="${ESC(p.nombre)}" onclick="event.stopPropagation()">
        <div class="it-meta">
          <select class="est-trabajo ${ET_CLASS[p.estadoTrabajo || 'Sin Iniciar'] || 'etj-SinIniciar'}" data-path="${ci}|p|${pi}" data-k="estadoTrabajo" onclick="event.stopPropagation()">${optTrabajo(p.estadoTrabajo || 'Sin Iniciar')}</select>
          <select class="est-abono ${(p.abono || 'Sin Abono') === 'Abono' ? 'abono-Con' : 'abono-Sin'}" data-path="${ci}|p|${pi}" data-k="abono" onclick="event.stopPropagation()">${opt(OPCIONES_ABONO, p.abono || 'Sin Abono')}</select>
          <span class="it-pct">${pct}% · ${total}t</span>
          ${p.fechaTerminado ? `<span class="it-fecha">✓ ${p.fechaTerminado}</span>` : ''}
          <button class="btn-save it-del" onclick="event.stopPropagation();guardarAhora(this)" title="Guardar proyecto">✓</button>
          <button class="add it-del" style="font-size:10px;padding:2px 6px" onclick="event.stopPropagation();quickAddTarea(${ci},${pi})" title="Nueva tarea">+Tarea</button>
          <input type="checkbox" class="sel-cb it-del" data-sel="p|${ci}|${pi}" onclick="event.stopPropagation();toggleSel(this)" title="Seleccionar para eliminar">
        </div>
      </div>
      <div class="it-body" style="display:none">${renderProyectoBody(p, ci, pi)}</div>
    </div>`;
  }).join('')}</div>`;
  bindEvents();
}

function abrirCliente(ci) { vistaActual = 'proyectos'; clienteActual = ci; renderVista(); }

function volverClientes() {
  vistaActual = 'clientes';
  clienteActual = null;
  document.getElementById('filtroEstado').innerHTML = '<option value="">📋 Todos los estados</option>';
  document.getElementById('filtroAbono').style.display = 'none';
  renderVista();
}

// ============================================================
// ESTADO EXPANDIDO
// ============================================================
function restoreExpanded() {
  document.querySelectorAll('.it-wrap[data-ek]').forEach(w => {
    if (expandedKeys.has(w.dataset.ek)) {
      const row = w.querySelector('.it-row');
      const body = w.querySelector('.it-body');
      if (row) row.classList.add('it-open');
      if (body) body.style.display = 'block';
    }
  });
  document.querySelectorAll('.tareas-toggle[data-tkey]').forEach(tog => {
    if (expandedKeys.has(tog.dataset.tkey)) {
      tog.classList.add('t-open');
      const sib = tog.parentElement ? tog.parentElement.nextElementSibling : null;
      if (sib) sib.style.display = 'block';
    }
  });
}

function toggleExpand(ev) {
  ev.stopPropagation();
  const wrap = ev.currentTarget.closest('.it-wrap');
  const row = wrap.querySelector('.it-row');
  const body = wrap.querySelector('.it-body');
  const isOpen = row.classList.contains('it-open');
  row.classList.toggle('it-open', !isOpen);
  if (body) body.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) expandedKeys.add(wrap.dataset.ek);
  else expandedKeys.delete(wrap.dataset.ek);
}

function toggleTareas(tog) {
  const key = tog.dataset.tkey;
  const isOpen = tog.classList.contains('t-open');
  tog.classList.toggle('t-open', !isOpen);
  // Next sibling of parent div (the tareas toggle + nueva fase row)
  const tareasDiv = tog.parentElement ? tog.parentElement.nextElementSibling : null;
  if (tareasDiv) tareasDiv.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) expandedKeys.add(key);
  else expandedKeys.delete(key);
}

function renderVista() {
  if (vistaActual === 'proyectos' && clienteActual != null) renderProyectos(clienteActual);
  else renderClientes();
  restoreExpanded();
}

// ============================================================
// EVENTOS DE EDICIÓN (delegación)
// ============================================================
function _onRootChange(ev) {
  const t = ev.target;
  if (!t.dataset.path) return;
  applyEdit(t.dataset.path, t.dataset.k, t.value);
  save();
  renderVista();
}

function _onRootInput(ev) {
  const t = ev.target;
  if (!t.dataset.path || t.tagName === 'SELECT') return;
  applyEdit(t.dataset.path, t.dataset.k, t.value);
  clearTimeout(window._it);
  window._it = setTimeout(save, 8000);
}

let _eventsBound = false;
function bindEvents() {
  if (_eventsBound) return;
  document.getElementById('root').addEventListener('change', _onRootChange);
  document.getElementById('root').addEventListener('input', _onRootInput);
  _eventsBound = true;
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('q').oninput = renderVista;
});

function applyEdit(path, k, val) {
  try {
    const p = path.split('|'), ci = +p[0], c = clientes[ci];
    if (!c) return;
    if (p[1] === 'c') {
      if (k === 'nombre') c.nombre = val;
      else if (k === 'estadoCliente') c.estado = val;
      else if (k === 'notaCliente') c.nota = val;
      return;
    }
    if (p[1] === 'p') {
      const pi = +p[2], pr = c.proyectos[pi]; if (!pr) return;
      if (k === 'nombre') pr.nombre = val;
      else if (k === 'nota') pr.nota = val;
      else if (k === 'estadoTrabajo') { pr.estadoTrabajo = val; const col = ET_COLOR[val]; if (col) pr.color = col; else delete pr.color; }
      else if (k === 'abono') pr.abono = val;
      else pr[k] = val;  // fechaEstimada, nroTicket, etc.
      return;
    }
    if (p[1] === 'sp') {
      const pi = +p[2], si = +p[3], s = c.proyectos[pi]?.subpuntos[si]; if (!s) return;
      if (k === 'nombreSub') s.nombre = val;
      else if (k === 'descSub') s.desc = val;
      else s[k] = val;  // fechaEstimada
      return;
    }
    if (p[1] === 't') {
      const pi = +p[2], ti = +p[3], t = c.proyectos[pi]?.tareas[ti]; if (!t) return;
      if (p.length === 4) t[k] = val;
      else if (p.length === 5) { const st = t.subtareas[+p[4]]; if (st) st[k] = val; }
      return;
    }
    if (p[1] === 's') {
      const pi = +p[2], si = +p[3], ti = +p[4], t = c.proyectos[pi]?.subpuntos[si]?.tareas[ti]; if (!t) return;
      if (p.length === 5) t[k] = val;
      else if (p.length === 6) { const st = t.subtareas[+p[5]]; if (st) st[k] = val; }
      return;
    }
  } catch (e) { console.warn('applyEdit:', e.message); }
}

// ============================================================
// HISTORIAL / DESHACER
// ============================================================
function pushHistory() {
  _history.push(JSON.stringify({ clientes: JSON.parse(JSON.stringify(clientes)), vistaActual, clienteActual }));
  if (_history.length > 20) _history.shift();
  updateUndoBtn();
}

function undo() {
  if (!_history.length) return;
  const prev = JSON.parse(_history.pop());
  clientes = fixClientes(prev.clientes);
  vistaActual = prev.vistaActual;
  clienteActual = prev.clienteActual;
  updateUndoBtn();
  save(); renderVista();
  showSaved('« Deshecho');
}

function updateUndoBtn() {
  const b = document.getElementById('btn-undo');
  if (b) b.style.display = _history.length ? '' : 'none';
}

// ============================================================
// SELECCIÓN MÚLTIPLE
// ============================================================
function toggleSel(cb) {
  const k = cb.dataset.sel;
  if (cb.checked) _selected.add(k); else _selected.delete(k);
  const n = _selected.size;
  const btn = document.getElementById('btn-del-sel');
  const cnt = document.getElementById('sel-count');
  btn.style.display = n ? '' : 'none';
  if (cnt) cnt.textContent = n;
}

function deleteSelected() {
  if (!_selected.size) return;
  if (!confirm(`¿Eliminar ${_selected.size} elemento(s) seleccionado(s)?`)) return;
  pushHistory();
  const projs = [], tareas = [], subs = [];
  _selected.forEach(k => {
    const p = k.split('|');
    if (p[0] === 'p') projs.push({ ci: +p[1], pi: +p[2] });
    else if (p[0] === 't') {
      const pp = p[1].split('|');
      if (p[1].includes('|t|')) tareas.push({ ci: +pp[0], pi: +pp[2], ti: +pp[3], kind: 't' });
      else if (p[1].includes('|s|')) tareas.push({ ci: +pp[0], pi: +pp[2], si: +pp[3], ti: +pp[4], kind: 's' });
    } else if (p[0] === 'st') {
      const pp = p[1].split('|');
      if (pp[1] === 't') subs.push({ ci: +pp[0], pi: +pp[2], ti: +pp[3], sti: +pp[4], kind: 't' });
      else if (pp[1] === 's') subs.push({ ci: +pp[0], pi: +pp[2], si: +pp[3], ti: +pp[4], sti: +pp[5], kind: 's' });
    }
  });
  subs.sort((a, b) => b.sti - a.sti).forEach(x => {
    const t = x.kind === 't' ? clientes[x.ci].proyectos[x.pi].tareas[x.ti] : clientes[x.ci].proyectos[x.pi].subpuntos[x.si].tareas[x.ti];
    if (t) t.subtareas.splice(x.sti, 1);
  });
  tareas.sort((a, b) => b.ti - a.ti).forEach(x => {
    const arr = x.kind === 't' ? clientes[x.ci].proyectos[x.pi].tareas : clientes[x.ci].proyectos[x.pi].subpuntos[x.si].tareas;
    if (arr) arr.splice(x.ti, 1);
  });
  projs.sort((a, b) => b.pi - a.pi).forEach(x => { clientes[x.ci].proyectos.splice(x.pi, 1); });
  _selected.clear();
  document.getElementById('btn-del-sel').style.display = 'none';
  save(); renderVista();
}

// ============================================================
// ACCIONES
// ============================================================
function guardarAhora(btn) {
  clearTimeout(window._it);
  if (btn) {
    btn.classList.add('guardado');
    btn.textContent = '✓ Guardado';
    setTimeout(() => { if (btn) { btn.classList.remove('guardado'); btn.textContent = '✓'; } }, 1500);
  }
  save();
}

function quickAddTarea(ci, pi) {
  pushHistory();
  const p = clientes[ci].proyectos[pi];
  const arr = (p.subpuntos && p.subpuntos.length) ? p.subpuntos[p.subpuntos.length - 1].tareas : p.tareas;
  const nid = (arr.length + 1).toString().padStart(2, '0');
  arr.push({ id: nid, tarea: 'Nueva tarea', estado: 'Pendiente', prioridad: 'Media', fechaEstimada: '', nroTicket: '', adjuntos: [], subtareas: [] });
  expandedKeys.add('p-' + ci + '-' + pi);
  expandedKeys.add('tareas-' + ci + '-' + pi);
  save(); renderVista();
  setTimeout(() => {
    const txts = document.querySelectorAll('.tree .task textarea.txt');
    if (txts.length) { const l = txts[txts.length - 1]; l.focus(); l.select(); }
  }, 60);
}

function addItem() {
  pushHistory();
  if (vistaActual === 'clientes') {
    clientes.push({ id: newId(), nombre: 'Nuevo Cliente', estado: 'Activo', nota: '', color: null, proyectos: [] });
  } else {
    if (clienteActual == null) return;
    const ci = clienteActual;
    clientes[ci].proyectos.push({
      id: newId(), nombre: 'Nuevo Proyecto', estadoTrabajo: 'Sin Iniciar', abono: 'Sin Abono',
      color: null, nota: '', adjuntos: [], fechaTerminado: null, fechaEstimada: '', nroTicket: '',
      tareas: [], subpuntos: []
    });
    expandedKeys.add('p-' + ci + '-' + (clientes[ci].proyectos.length - 1));
  }
  save(); renderVista();
}

function delCliente(ci) {
  if (!confirm(`¿Eliminar cliente "${clientes[ci].nombre}"?`)) return;
  pushHistory(); clientes.splice(ci, 1); save(); renderVista();
}

function delProyecto(ci, pi) {
  if (!confirm(`¿Eliminar proyecto "${clientes[ci].proyectos[pi].nombre}"?`)) return;
  pushHistory(); clientes[ci].proyectos.splice(pi, 1); save(); renderVista();
}

function addSubpunto(ci, pi) {
  pushHistory();
  const p = clientes[ci].proyectos[pi];
  if (!p.subpuntos) p.subpuntos = [];
  if (!p.subpuntos.length && p.tareas && p.tareas.length && confirm('¿Mover tareas actuales a subpunto "General"?')) {
    p.subpuntos.push({ id: newId(), nombre: 'General', desc: '', fechaEstimada: '', tareas: p.tareas });
    p.tareas = [];
  }
  p.subpuntos.push({ id: newId(), nombre: 'Nueva Fase', desc: '', fechaEstimada: '', tareas: [] });
  expandedKeys.add('p-' + ci + '-' + pi);
  expandedKeys.add('tareas-' + ci + '-' + pi);
  save(); renderVista();
}

function delSubpunto(ci, pi, si) {
  const p = clientes[ci].proyectos[pi];
  if (!confirm(`¿Eliminar fase "${p.subpuntos[si].nombre}"?`)) return;
  pushHistory(); p.subpuntos.splice(si, 1);
  if (!p.subpuntos.length) p.subpuntos = [];
  save(); renderVista();
}

function addTarea(addPath) {
  pushHistory();
  const p = addPath.split('|'), ci = +p[1], pi = +p[2];
  const arr = p[0] === 's' ? clientes[ci].proyectos[pi].subpuntos[+p[3]].tareas : clientes[ci].proyectos[pi].tareas;
  const nid = (arr.length + 1).toString().padStart(2, '0');
  arr.push({ id: nid, tarea: 'Nueva tarea', estado: 'Pendiente', prioridad: 'Media', fechaEstimada: '', nroTicket: '', adjuntos: [], subtareas: [] });
  expandedKeys.add(`p-${ci}-${pi}`);
  expandedKeys.add(`tareas-${ci}-${pi}`);
  save(); renderVista();
  setTimeout(() => {
    const txts = document.querySelectorAll('.tree .task textarea.txt');
    if (txts.length) { const last = txts[txts.length - 1]; last.focus(); last.select(); }
  }, 30);
}

function delTarea(path) {
  const p = path.split('|'), ci = +p[0];
  let arr;
  if (p[1] === 't') { arr = clientes[ci].proyectos[+p[2]].tareas; if (!confirm('¿Eliminar tarea?')) return; pushHistory(); arr.splice(+p[3], 1); }
  else if (p[1] === 's') { arr = clientes[ci].proyectos[+p[2]].subpuntos[+p[3]].tareas; if (!confirm('¿Eliminar tarea?')) return; pushHistory(); arr.splice(+p[4], 1); }
  save(); renderVista();
}

function addSub(path) {
  pushHistory();
  const p = path.split('|'), ci = +p[0];
  let t;
  if (p[1] === 't') t = clientes[ci].proyectos[+p[2]].tareas[+p[3]];
  else if (p[1] === 's') t = clientes[ci].proyectos[+p[2]].subpuntos[+p[3]].tareas[+p[4]];
  if (!t) return;
  if (!t.subtareas) t.subtareas = [];
  t.subtareas.push({ id: String.fromCharCode(97 + t.subtareas.length), tarea: 'Nueva subtarea', estado: 'Pendiente', prioridad: 'Media', fechaEstimada: '', nroTicket: '', adjuntos: [] });
  save(); renderVista();
}

function delSub(path) {
  const p = path.split('|'), ci = +p[0];
  let t;
  if (p[1] === 't') t = clientes[ci].proyectos[+p[2]].tareas[+p[3]];
  else if (p[1] === 's') t = clientes[ci].proyectos[+p[2]].subpuntos[+p[3]].tareas[+p[4]];
  if (t && confirm('¿Eliminar subtarea?')) { pushHistory(); t.subtareas.splice(+p[p.length - 1], 1); }
  save(); renderVista();
}

// ============================================================
// BACKUP / IMPORTAR
// ============================================================
function exportJSON() {
  const blob = new Blob([JSON.stringify({ clientes }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ciaber_backup_' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
}

function importJSON(ev) {
  const f = ev.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = e => {
    try {
      const d = JSON.parse(e.target.result);
      if (d.clientes) clientes = fixClientes(d.clientes);
      else if (Array.isArray(d)) clientes = migrarDesdeFormatoViejo(d);
      save(); renderVista();
      alert('Importado correctamente.');
    } catch (err) { alert('Archivo inválido: ' + err.message); }
  };
  r.readAsText(f);
}
