import { simular, soles, POLITICA } from './finanzas.js';
import { icon, hydrateIcons } from './icons.js';

const $app = document.getElementById('app');
const NOMBRE_ESC = { sin_cambio: 'Mantener condiciones', reprogramacion: 'Reprogramación', refinanciamiento: 'Refinanciamiento', ninguno: 'Derivar a Recuperaciones' };
const TAG_ESC = { sin_cambio: '', reprogramacion: 'tag-teal', refinanciamiento: 'tag-ochre', ninguno: 'tag-bad' };
const TAG_ESTADO = { Borrador: '', 'En comité': 'tag-warn', Aprobada: 'tag-ok', Rechazada: 'tag-bad' };
const MOTIVOS = ['Caída de ventas', 'Enfermedad del titular', 'Enfermedad familiar', 'Fenómeno climático (heladas)', 'Fenómeno climático (sequía)', 'Fenómeno climático (lluvias / huaico)', 'Robo de mercadería', 'Pérdida de cliente principal', 'Pérdida de empleo temporal', 'Reducción de horas laborales', 'Accidente del vehículo', 'Atraso en pagos de clientes', 'Otro'];

const state = { asesores: [], yo: null, ia: false };

// ---------- utilidades ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fecha = (d) => new Date(d).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
const fechaHora = (d) => new Date(d).toLocaleString('es-PE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const pct = (n) => (n == null ? '—' : `${Math.round(n)}%`);
const diasCls = (d) => (d === 0 ? 'd0' : d <= 30 ? 'd1' : 'd2');
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } },
};

async function api(url, opts = {}) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), 2600);
}

function render(html) {
  $app.innerHTML = `<div class="view-enter">${html}</div>`;
  hydrateIcons($app);
  $app.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

const loading = () => render(`
  <div class="skeleton" style="height:34px;width:280px;margin-bottom:12px"></div>
  <div class="skeleton" style="height:18px;width:420px;margin-bottom:28px"></div>
  <div class="skeleton" style="height:84px;margin-bottom:24px"></div>
  <div class="skeleton" style="height:360px"></div>`);

const errorView = (e) => render(`<div class="error-box">${icon('alert')}<div><strong>No se pudo cargar la información.</strong><p>${esc(e.message)}. Revise la conexión e intente de nuevo.</p><p style="margin-top:10px"><button class="btn btn-sm" onclick="location.reload()">Reintentar</button></p></div></div>`);

const riskCell = (r) => `<span class="risk lvl-${r.nivel}" title="Puntaje de riesgo ${r.total}/100"><span class="risk-bar"><i style="width:${r.total}%"></i></span><b>${r.total}</b><small>${r.nivel}</small></span>`;
const clasifTag = (c) => `<span class="tag plain ${c === 'Normal' ? 'tag-ok' : c === 'CPP' ? 'tag-warn' : 'tag-bad'}">${esc(c)}</span>`;
const estadoTag = (e) => `<span class="tag ${TAG_ESTADO[e] || ''}">${esc(e)}</span>`;
const escTag = (id) => (id ? `<span class="tag ${TAG_ESC[id] || ''}">${NOMBRE_ESC[id]}</span>` : '<span class="subtle">—</span>');

function setNav(key) {
  document.querySelectorAll('[data-nav]').forEach((a) => (a.dataset.nav === key ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
}

async function refreshComiteCount() {
  try {
    const r = await api('/api/resumen');
    const b = document.getElementById('nav-comite');
    b.hidden = !r.enComite;
    b.textContent = r.enComite;
    state.ia = r.ia;
    document.getElementById('ia-status').innerHTML = `<span class="dot ${r.ia ? 'on' : ''}"></span>${r.ia ? 'IA conectada · Google Gemini' : 'IA sin configurar · motor de reglas'}`;
  } catch { /* no bloquea la navegación */ }
}

// ---------- Cartera ----------
async function vistaPanel() {
  setNav('panel');
  loading();
  const [res, creditos] = await Promise.all([api('/api/resumen'), api('/api/creditos')]);
  const agencias = [...new Set(creditos.map((c) => c.cliente.agencia))].sort();
  const f = { q: '', nivel: 'Todos', agencia: '' };

  render(`
    <header class="page-head">
      <div>
        <h1>Cartera con dificultades de pago</h1>
        <p>Créditos ordenados por puntaje de riesgo. Abra uno para simular la reprogramación o el refinanciamiento y generar la solicitud para el comité.</p>
      </div>
    </header>
    <dl class="kpis">
      <div class="kpi"><dt>Cartera con atraso</dt><dd>${soles(res.carteraEnRiesgo)}<small>${res.creditosEnRiesgo} de ${res.totalCreditos} créditos</small></dd></div>
      <div class="kpi"><dt>Créditos con más de 30 días</dt><dd>${res.creditosMas30}<small>en riesgo de pasar a vencido</small></dd></div>
      <div class="kpi"><dt>Solicitudes en comité</dt><dd>${res.enComite}<small>${res.borradores} en borrador</small></dd></div>
      <div class="kpi"><dt>Cumplimiento tras reestructurar</dt><dd>${pct(res.cumplimiento)}<small>cuotas vencidas pagadas</small></dd></div>
    </dl>
    <section class="panel">
      <div class="panel-head">
        <div class="toolbar">
          <label class="search">${icon('search')}<input type="search" id="f-q" placeholder="Buscar cliente, DNI o crédito" aria-label="Buscar"></label>
          <div class="seg" role="group" aria-label="Nivel de riesgo">
            ${['Todos', 'Alto', 'Medio', 'Bajo'].map((n) => `<button type="button" data-nivel="${n}" aria-pressed="${n === 'Todos'}">${n}</button>`).join('')}
          </div>
          <select id="f-ag" aria-label="Agencia"><option value="">Todas las agencias</option>${agencias.map((a) => `<option>${esc(a)}</option>`).join('')}</select>
        </div>
        <span class="subtle" id="f-count"></span>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Cliente</th><th>Crédito</th><th class="num">Saldo</th><th class="num">Cuota</th><th class="num">Atraso</th><th>Clasificación</th><th>Riesgo</th><th>Solicitud</th></tr></thead>
        <tbody id="rows"></tbody>
      </table></div>
    </section>`);

  const pinta = () => {
    const q = f.q.toLowerCase();
    const lista = creditos.filter((c) =>
      (f.nivel === 'Todos' || c.riesgo.nivel === f.nivel) &&
      (!f.agencia || c.cliente.agencia === f.agencia) &&
      (!q || `${c.cliente.nombres} ${c.cliente.dni} ${c.codigo}`.toLowerCase().includes(q)));
    document.getElementById('f-count').textContent = `${lista.length} ${lista.length === 1 ? 'crédito' : 'créditos'}`;
    document.getElementById('rows').innerHTML = lista.length ? lista.map((c) => `
      <tr class="link" data-href="#/credito/${c.id}" tabindex="0">
        <td class="who"><strong>${esc(c.cliente.nombres)}</strong><span>${esc(c.cliente.actividad)} · ${esc(c.cliente.agencia)}</span></td>
        <td class="who"><strong>${esc(c.codigo)}</strong><span>${esc(c.producto)}</span></td>
        <td class="num">${soles(c.saldo_capital)}</td>
        <td class="num">${soles(c.cuota_actual)}</td>
        <td class="num"><span class="days ${diasCls(c.dias_atraso)}">${c.dias_atraso} d</span></td>
        <td>${clasifTag(c.cliente.clasificacion_sbs)}</td>
        <td>${riskCell(c.riesgo)}</td>
        <td>${c.ultima_solicitud ? estadoTag(c.ultima_solicitud.estado) : c.estado !== 'Vigente' && c.estado !== 'Vencido' ? `<span class="tag plain">${esc(c.estado)}</span>` : '<span class="subtle">Sin solicitud</span>'}</td>
      </tr>`).join('') : `<tr><td colspan="8"><div class="empty">${icon('search')}<strong>Ningún crédito coincide con los filtros</strong><span class="subtle">Pruebe con otro nombre o quite el filtro de riesgo.</span></div></td></tr>`;
  };
  pinta();
  document.getElementById('f-q').addEventListener('input', (e) => { f.q = e.target.value; pinta(); });
  document.getElementById('f-ag').addEventListener('change', (e) => { f.agencia = e.target.value; pinta(); });
  document.querySelectorAll('[data-nivel]').forEach((b) => b.addEventListener('click', () => {
    f.nivel = b.dataset.nivel;
    document.querySelectorAll('[data-nivel]').forEach((x) => x.setAttribute('aria-pressed', x === b));
    pinta();
  }));
  const go = (e) => { const tr = e.target.closest('tr[data-href]'); if (tr) location.hash = tr.dataset.href; };
  document.getElementById('rows').addEventListener('click', go);
  document.getElementById('rows').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(e); });
}

// ---------- Ficha y simulador ----------
function historial(c) {
  const h = c.historial_pagos || [];
  const total = c.plazo_meses;
  const cel = [];
  for (let k = 1; k <= total; k++) {
    const p = h.find((x) => x.cuota === k);
    if (!p) { cel.push(`<span class="pend" title="Cuota ${k}: pendiente"></span>`); continue; }
    const l = p.dias_atraso === 0 ? '' : p.dias_atraso <= 8 ? 'l1' : p.dias_atraso <= 30 ? 'l2' : 'l3';
    cel.push(`<span class="${l}" title="Cuota ${k}: ${p.dias_atraso ? `${p.dias_atraso} días de atraso` : 'puntual'}"></span>`);
  }
  return `<div class="hist" role="img" aria-label="Historial de ${h.length} cuotas pagadas de ${total}">${cel.join('')}</div>
    <div class="legend"><span><i style="background:var(--ok-wash);box-shadow:inset 0 0 0 1px oklch(0.85 0.05 150)"></i>Puntual</span><span><i style="background:var(--warn-wash);box-shadow:inset 0 0 0 1px oklch(0.83 0.08 80)"></i>1–8 d</span><span><i style="background:oklch(0.9 0.06 50)"></i>9–30 d</span><span><i style="background:var(--bad)"></i>+30 d</span><span><i style="box-shadow:inset 0 0 0 1px var(--line-strong)"></i>Pendiente</span></div>`;
}

function columnaEscenario(e, sim, rec) {
  const uso = e.usoExcedente;
  const base = e.baseCapacidad === 'habitual' ? 'del excedente habitual' : 'del excedente actual';
  return `<article class="esc ${rec ? 'rec' : ''}" data-id="${e.id}">
    <div class="esc-band"></div>
    <div class="esc-head">
      <h3>${e.nombre}${rec ? '<span class="rec-flag">Recomendado</span>' : ''}</h3>
      <p>${esc(e.descripcion)}</p>
    </div>
    <div class="esc-cuota"><strong>${soles(e.cuota)}</strong><span>cuota mensual${e.graciaMeses ? ` desde el mes ${e.graciaMeses + 1}` : ''}</span></div>
    <dl>
      <div><dt>Plazo restante</dt><dd>${e.plazoRestante} meses</dd></div>
      <div><dt>Periodo de gracia</dt><dd>${e.graciaMeses ? `${e.graciaMeses} meses` : '—'}</dd></div>
      <div><dt>TEA</dt><dd>${Number(e.tea).toFixed(2)}%</dd></div>
      <div><dt>Para regularizar hoy</dt><dd>${e.montoRegularizar ? soles(e.montoRegularizar) : '—'}</dd></div>
      <div><dt>Intereses por pagar</dt><dd>${soles(e.interesTotal)}</dd></div>
      <div><dt>Total a pagar</dt><dd>${soles(e.totalPagar)}</dd></div>
    </dl>
    <div class="use">
      <span class="subtle">${uso == null ? 'Sin excedente disponible' : `Usa el ${Math.round(uso)}% ${base}`}</span>
      <div class="use-bar ${!e.cabe ? 'over' : ''}"><i style="width:${Math.min(uso ?? 100, 100)}%"></i></div>
    </div>
    <ul class="checks">${e.condiciones.map((c) => `<li class="${c.ok ? 'ok' : 'no'}">${icon(c.ok ? 'check' : 'x')}<span>${esc(c.texto)}</span></li>`).join('')}</ul>
    <p class="sbs"><b>Impacto SBS.</b> ${esc(e.impactoSBS)}</p>
  </article>`;
}

async function vistaCredito(id) {
  setNav('panel');
  loading();
  const c = await api(`/api/creditos/${id}`);
  const cl = c.cliente;
  const abierta = c.solicitudes.find((s) => ['Borrador', 'En comité'].includes(s.estado));
  const p = { ingreso: +cl.ingreso_mensual, gasto: +cl.gasto_mensual, eventoTemporal: true, gracia: 2, ajusteTasa: 0, plazoRefin: null, motivo: '', descripcion: '' };

  render(`
    <a class="back" href="#/">${icon('back')}Volver a la cartera</a>
    <header class="page-head">
      <div>
        <h1>${esc(cl.nombres)}</h1>
        <p>${esc(c.codigo)} · ${esc(c.producto)} · Agencia ${esc(cl.agencia)}</p>
      </div>
      ${abierta ? `<a class="btn" href="#/solicitud/${abierta.id}">${icon('file')}Ver solicitud abierta (${esc(abierta.estado)})</a>` : ''}
    </header>
    <div class="ficha">
      <div class="sticky">
        <section class="panel panel-body">
          <h2>Diagnóstico</h2>
          <dl class="facts" style="margin-top:14px">
            <div><dt>DNI</dt><dd>${esc(cl.dni)}</dd></div>
            <div><dt>Clasificación SBS</dt><dd>${clasifTag(cl.clasificacion_sbs)}</dd></div>
            <div class="wide"><dt>Actividad</dt><dd>${esc(cl.actividad)} · ${esc(cl.tipo_credito)}</dd></div>
            <div><dt>Saldo capital</dt><dd>${soles(c.saldo_capital)}</dd></div>
            <div><dt>Cuota actual</dt><dd>${soles(c.cuota_actual)}</dd></div>
            <div><dt>TEA</dt><dd>${c.tea}%</dd></div>
            <div><dt>Atraso</dt><dd><span class="days ${diasCls(c.dias_atraso)}">${c.dias_atraso} días</span></dd></div>
            <div><dt>Ingreso habitual</dt><dd>${soles(cl.ingreso_mensual)}</dd></div>
            <div><dt>Otras deudas / mes</dt><dd>${soles(cl.otras_deudas)}</dd></div>
            <div class="wide"><dt>Reprogramaciones previas</dt><dd>${c.veces_reprogramado}</dd></div>
          </dl>
          <h3 class="section-title">Historial de pagos · ${c.cuotas_pagadas} de ${c.plazo_meses} cuotas</h3>
          ${historial(c)}
        </section>
        <section class="panel panel-body" style="margin-top:16px">
          <h2>Situación actual del cliente</h2>
          <form id="form" class="form-grid" style="margin-top:14px" novalidate>
            <label class="field wide"><span>Motivo de la dificultad</span>
              <select name="motivo" required><option value="">Seleccione un motivo</option>${MOTIVOS.map((m) => `<option>${m}</option>`).join('')}</select>
            </label>
            <label class="field wide"><span>Detalle para el comité</span>
              <textarea name="descripcion" rows="3" placeholder="Ej.: las heladas de octubre afectaron el 60% de su cosecha; espera recuperarse en la campaña de marzo."></textarea>
            </label>
            <label class="field"><span>Ingreso actual</span><div class="money"><input type="number" name="ingreso" min="0" step="50" value="${p.ingreso}" inputmode="decimal"></div></label>
            <label class="field"><span>Gasto actual</span><div class="money"><input type="number" name="gasto" min="0" step="50" value="${p.gasto}" inputmode="decimal"></div></label>
            <label class="switch wide"><input type="checkbox" name="temporal" checked><span><strong style="font-weight:500">La dificultad es temporal</strong><br><span class="subtle">El cliente recuperará su ingreso habitual en pocos meses.</span></span></label>
            <div class="field"><span>Meses de gracia</span>
              <div class="seg" role="group" aria-label="Meses de gracia">${[1, 2, 3].map((g) => `<button type="button" data-gracia="${g}" aria-pressed="${g === 2}">${g}</button>`).join('')}</div>
            </div>
            <label class="field"><span>Tasa al refinanciar</span>
              <select name="ajuste"><option value="0">Misma TEA</option><option value="-2">TEA −2 puntos</option><option value="-4">TEA −4 puntos</option></select>
            </label>
            <label class="field wide"><span>Plazo del refinanciamiento</span>
              <input type="number" name="plazo" min="3" max="${POLITICA.maxPlazoRefinanciado}" placeholder="Automático"><small>Vacío: el menor plazo cuya cuota entra en la capacidad.</small>
            </label>
          </form>
        </section>
      </div>
      <div>
        <section class="panel capacity" id="cap"></section>
        <div id="motor"></div>
        <div class="compare" id="compare"></div>
        <div class="actions-bar">
          <span class="subtle">Los cálculos usan el sistema francés y la política de la caja: la cuota no puede superar el ${POLITICA.limiteCapacidad * 100}% del excedente.</span>
          <button class="btn btn-primary" id="go" type="button">${icon('spark')}Analizar con IA y crear solicitud</button>
        </div>
      </div>
    </div>`);

  const form = document.getElementById('form');
  const pinta = () => {
    const sim = simular({ credito: c, cliente: cl, ...p });
    const max = Math.max(sim.capacidad.excedente, sim.capacidad.habitual.excedente, c.cuota_actual * 1.2, 1);
    const at = (v) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
    const cuotas = sim.escenarios.map((e) => ({ id: e.id, v: e.cuota, col: e.id === 'sin_cambio' ? 'var(--slate)' : e.id === 'reprogramacion' ? 'var(--teal)' : 'var(--ochre)' }));
    document.getElementById('cap').innerHTML = `
      <div class="cap-row">
        <div><span class="subtle">Excedente mensual actual</span><br><strong>${soles(sim.capacidad.excedente)}</strong></div>
        <div style="text-align:right"><span class="subtle">Cuota máxima recomendada (${sim.capacidad.porcentajeLimite}%)</span><br><strong>${soles(sim.capacidad.limite)}</strong></div>
        <div style="text-align:right"><span class="subtle">Puntaje de riesgo</span><br>${riskCell(sim.riesgo)}</div>
      </div>
      <div class="cap-track" aria-hidden="true">
        <div class="limit" style="width:${at(sim.capacidad.limite)}"></div>
        ${cuotas.map((q) => `<span class="mark" style="left:${at(q.v)};background:${q.col}" title="${NOMBRE_ESC[q.id]}: ${soles(q.v)}"></span>`).join('')}
      </div>
      <div class="cap-legend"><span><i style="background:var(--teal-wash);height:8px;box-shadow:inset 0 0 0 1px oklch(0.85 0.04 195)"></i>Zona segura de cuota</span>${cuotas.map((q) => `<span><i style="background:${q.col}"></i>${NOMBRE_ESC[q.id]} ${soles(q.v)}</span>`).join('')}</div>`;
    const m = sim.motor;
    document.getElementById('motor').innerHTML = `<div class="motor-note ${m.recomendado ? '' : 'none'}">${icon(m.recomendado ? 'thumb' : 'alert')}<div><strong>${m.recomendado ? `Motor de reglas: ${NOMBRE_ESC[m.recomendado]}` : 'Ninguna alternativa es viable'}</strong><p class="muted">${esc(m.razon)}</p></div></div>`;
    document.getElementById('compare').innerHTML = sim.escenarios.map((e) => columnaEscenario(e, sim, e.id === m.recomendado)).join('');
  };
  pinta();

  form.addEventListener('input', () => {
    const fd = new FormData(form);
    p.ingreso = +fd.get('ingreso') || 0;
    p.gasto = +fd.get('gasto') || 0;
    p.eventoTemporal = form.temporal.checked;
    p.ajusteTasa = +fd.get('ajuste');
    p.plazoRefin = +fd.get('plazo') || null;
    p.motivo = fd.get('motivo');
    p.descripcion = fd.get('descripcion');
    pinta();
  });
  form.querySelectorAll('[data-gracia]').forEach((b) => b.addEventListener('click', () => {
    p.gracia = +b.dataset.gracia;
    form.querySelectorAll('[data-gracia]').forEach((x) => x.setAttribute('aria-pressed', x === b));
    pinta();
  }));

  document.getElementById('go').addEventListener('click', async (ev) => {
    if (!p.motivo) { form.motivo.focus(); toast('Seleccione el motivo de la dificultad'); return; }
    const btn = ev.currentTarget;
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span>Analizando…';
    const area = document.getElementById('compare');
    area.insertAdjacentHTML('beforebegin', `<div class="panel thinking" id="thinking"><div class="pulse">${icon('spark')}</div><strong>${state.ia ? 'Gemini está evaluando el caso' : 'Preparando la solicitud'}</strong><span class="subtle">Revisa capacidad de pago, historial y normativa, y redacta el informe para el comité y el mensaje para el cliente.</span></div>`);
    try {
      const r = await api('/api/solicitudes', { method: 'POST', body: {
        credito_id: c.id, asesor_id: state.yo?.id, motivo: p.motivo, descripcion: p.descripcion,
        ingreso_actual: p.ingreso, gasto_actual: p.gasto, evento_temporal: p.eventoTemporal,
        gracia: p.gracia, ajuste_tasa: p.ajusteTasa, plazo_refin: p.plazoRefin,
      } });
      location.hash = `#/solicitud/${r.id}`;
    } catch (e) {
      document.getElementById('thinking')?.remove();
      btn.disabled = false;
      btn.innerHTML = `${icon('spark')}Analizar con IA y crear solicitud`;
      toast(e.message);
    }
  });
}

// ---------- Solicitud ----------
function informeHTML(txt) {
  return (txt || '').split(/\n+/).map((l) => l.trim()).filter(Boolean)
    .map((l) => (/^\d+\.\s/.test(l) && l.length < 60 ? `<h4>${esc(l)}</h4>` : `<p>${esc(l)}</p>`)).join('');
}

async function vistaSolicitud(id) {
  setNav('solicitudes');
  loading();
  const s = await api(`/api/solicitudes/${id}`);
  const c = s.credito, cl = c.cliente, r = s.recomendacion || {};
  const sim = s.escenarios?.escenarios ? s.escenarios : { escenarios: [], motor: {}, entrada: {}, capacidad: {}, riesgo: {} };
  const soyComite = ['comite', 'jefe_riesgos'].includes(state.yo?.rol);
  const elegido = sim.escenarios.find((e) => e.id === s.escenario_elegido);
  const tel = (cl.telefono || '').replace(/\D/g, '');

  const pasos = [
    { t: 'Solicitud creada', d: `${fechaHora(s.created_at)} · ${esc(s.asesor?.nombre || 'Asesor')}`, cls: 'done' },
    { t: 'En comité de créditos', d: s.estado === 'Borrador' ? 'Pendiente de envío' : 'Enviada para evaluación', cls: s.estado === 'Borrador' ? '' : s.estado === 'En comité' ? 'now' : 'done' },
    { t: s.estado === 'Rechazada' ? 'Rechazada' : 'Aprobada', d: s.decidido_en ? `${fechaHora(s.decidido_en)} · ${esc(s.decisor?.nombre || 'Comité')}` : 'Esperando decisión', cls: s.estado === 'Aprobada' ? 'done' : s.estado === 'Rechazada' ? 'bad' : '' },
    { t: 'Seguimiento de cuotas', d: s.seguimiento.length ? `${s.seguimiento.filter((x) => x.estado.startsWith('Pagada')).length} de ${s.seguimiento.length} cuotas pagadas` : 'Inicia al aprobarse', cls: s.seguimiento.length ? 'now' : '' },
  ];

  let accion = '';
  if (s.estado === 'Borrador') {
    accion = `<label class="field"><span>Escenario propuesto al comité</span>
        <select id="esc-sel">${sim.escenarios.map((e) => `<option value="${e.id}" ${e.id === s.escenario_elegido ? 'selected' : ''}>${e.nombre} · ${soles(e.cuota)}</option>`).join('')}</select>
        <small>La IA recomendó ${NOMBRE_ESC[r.escenario] || '—'}. El asesor puede cambiarlo y justificarlo en el informe.</small></label>
      <button class="btn btn-primary" id="enviar">${icon('send')}Enviar al comité</button>`;
  } else if (s.estado === 'En comité') {
    accion = soyComite
      ? `<label class="field"><span>Comentario del comité</span><textarea id="coment" rows="3" placeholder="Condiciones o motivo de la decisión"></textarea></label>
         <div style="display:flex;gap:8px"><button class="btn btn-ok" id="aprobar" style="flex:1">${icon('check')}Aprobar</button><button class="btn btn-bad" id="rechazar" style="flex:1">${icon('x')}Rechazar</button></div>`
      : `<p class="subtle">Esperando la decisión del comité. Cambie la sesión simulada a <strong>Comité de Créditos</strong> para aprobar o rechazar.</p>`;
  } else if (s.comentario_comite) {
    accion = `<div><span class="subtle">Comentario del comité</span><p style="margin-top:4px">${esc(s.comentario_comite)}</p></div>`;
  }

  render(`
    <a class="back no-print" href="#/solicitudes">${icon('back')}Volver a solicitudes</a>
    <header class="page-head">
      <div>
        <h1>${esc(cl.nombres)}</h1>
        <p>${esc(s.codigo)} · Crédito ${esc(c.codigo)} · ${esc(s.motivo)}</p>
      </div>
      <div class="toolbar no-print">${estadoTag(s.estado)}<a class="btn btn-sm" href="#/credito/${c.id}">${icon('edit')}Volver a simular</a></div>
    </header>
    <div class="sol-grid">
      <div>
        <section class="panel ia-card">
          <div class="ia-top">
            <div>
              <span class="ia-source">${icon('spark')}${esc(r.fuente || 'Análisis')}</span>
              <h2 style="margin-top:6px">Recomendación: ${escTag(r.escenario)}</h2>
            </div>
            <div class="conf">Confianza <span class="conf-bar"><i style="width:${r.confianza || 0}%"></i></span><b>${r.confianza ?? '—'}%</b></div>
          </div>
          <p class="verdict">${esc(r.resumen)}</p>
          ${r.coincide_con_motor === false ? `<p class="subtle" style="margin-top:8px">${icon('alert')} La IA discrepa del motor de reglas (${NOMBRE_ESC[sim.motor.recomendado] || 'ninguno'}).</p>` : ''}
          <div class="three">
            <div class="fav"><h4>${icon('check')}A favor</h4><ul>${(r.factores_favor || []).map((x) => `<li>${esc(x)}</li>`).join('') || '<li>—</li>'}</ul></div>
            <div class="rsk"><h4>${icon('alert')}Riesgos</h4><ul>${(r.factores_riesgo || []).map((x) => `<li>${esc(x)}</li>`).join('') || '<li>Sin riesgos relevantes</li>'}</ul></div>
            <div class="cnd"><h4>${icon('flag')}Condiciones sugeridas</h4><ul>${(r.condiciones_sugeridas || []).map((x) => `<li>${esc(x)}</li>`).join('') || '<li>—</li>'}</ul></div>
          </div>
        </section>
        <section class="panel" style="margin-top:20px">
          <div class="tabs no-print" role="tablist">
            <button role="tab" aria-selected="true" data-tab="informe">${icon('file')}Informe para el comité</button>
            <button role="tab" aria-selected="false" data-tab="mensaje">${icon('msg')}Mensaje al cliente</button>
            <button role="tab" aria-selected="false" data-tab="escenarios">${icon('scale')}Escenarios</button>
          </div>
          <div class="panel-body" data-pane="informe">
            <div class="toolbar no-print" style="justify-content:flex-end;margin-bottom:14px">
              ${s.estado === 'Borrador' ? `<button class="btn btn-sm btn-ghost" id="editar">${icon('edit')}Editar</button>` : ''}
              <button class="btn btn-sm" onclick="window.print()">${icon('print')}Imprimir</button>
            </div>
            <div class="doc" id="doc">${informeHTML(s.informe_comite)}</div>
          </div>
          <div class="panel-body" data-pane="mensaje" hidden>
            <p class="subtle" style="margin-bottom:12px">Para ${esc(cl.nombres)} · ${esc(cl.telefono || 'sin teléfono')}</p>
            <div class="wa">${esc(s.mensaje_cliente || 'Sin mensaje.')}</div>
            <div class="toolbar" style="margin-top:14px">
              <button class="btn btn-sm" id="copiar">${icon('copy')}Copiar</button>
              ${tel && s.mensaje_cliente ? `<a class="btn btn-sm" target="_blank" rel="noopener" href="https://wa.me/51${tel}?text=${encodeURIComponent(s.mensaje_cliente)}">${icon('msg')}Abrir en WhatsApp</a>` : ''}
            </div>
          </div>
          <div class="panel-body" data-pane="escenarios" hidden>
            <div class="table-wrap"><table>
              <thead><tr><th>Escenario</th><th class="num">Cuota</th><th class="num">Plazo</th><th class="num">Gracia</th><th class="num">Intereses</th><th>Viable</th></tr></thead>
              <tbody>${sim.escenarios.map((e) => `<tr><td>${escTag(e.id)}</td><td class="num">${soles(e.cuota)}</td><td class="num">${e.plazoRestante} m</td><td class="num">${e.graciaMeses || '—'}</td><td class="num">${soles(e.interesTotal)}</td><td>${e.viable ? '<span class="tag tag-ok">Sí</span>' : '<span class="tag tag-bad">No</span>'}</td></tr>`).join('')}</tbody>
            </table></div>
            <p class="subtle" style="margin-top:12px">Ingreso declarado ${soles(sim.entrada.ingreso)}, gasto ${soles(sim.entrada.gasto)}, excedente ${soles(sim.capacidad.excedente)}. Puntaje de riesgo ${sim.riesgo.total}/100.</p>
          </div>
        </section>
      </div>
      <aside class="no-print">
        <section class="panel panel-body decision">
          <h2>Decisión</h2>
          <div class="chosen"><div><span class="subtle">Escenario elegido</span><br><strong>${elegido ? soles(elegido.cuota) : '—'}</strong></div>${escTag(s.escenario_elegido)}</div>
          ${accion}
        </section>
        <section class="panel panel-body" style="margin-top:16px">
          <h3 style="margin-bottom:16px">Recorrido</h3>
          <ol class="timeline">${pasos.map((x) => `<li class="${x.cls}"><span class="node"></span><div><strong>${x.t}</strong><span>${x.d}</span></div></li>`).join('')}</ol>
        </section>
        ${s.seguimiento.length ? `<section class="panel panel-body" style="margin-top:16px"><h3 style="margin-bottom:12px">Primeras cuotas</h3>
          <table><tbody>${s.seguimiento.map((x) => `<tr><td>Cuota ${x.numero_cuota}</td><td class="subtle">${fecha(x.fecha_vencimiento)}</td><td>${estadoTag(x.estado)}</td></tr>`).join('')}</tbody></table></section>` : ''}
      </aside>
    </div>`);

  document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-selected', x === b));
    document.querySelectorAll('[data-pane]').forEach((p) => (p.hidden = p.dataset.pane !== b.dataset.tab));
  }));
  document.getElementById('copiar')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(s.mensaje_cliente); toast('Mensaje copiado'); } catch { toast('No se pudo copiar'); }
  });
  document.getElementById('editar')?.addEventListener('click', (ev) => {
    const doc = document.getElementById('doc');
    if (doc.querySelector('textarea')) return;
    doc.innerHTML = `<textarea class="doc-edit" id="doc-txt">${esc(s.informe_comite)}</textarea><div class="toolbar" style="margin-top:10px;justify-content:flex-end"><button class="btn btn-sm btn-primary" id="guardar">Guardar informe</button></div>`;
    ev.currentTarget.hidden = true;
    document.getElementById('guardar').addEventListener('click', async () => {
      try {
        await api(`/api/solicitudes/${s.id}`, { method: 'PATCH', body: { informe_comite: document.getElementById('doc-txt').value } });
        toast('Informe guardado');
        vistaSolicitud(id);
      } catch (e) { toast(e.message); }
    });
  });
  document.getElementById('esc-sel')?.addEventListener('change', async (e) => {
    try { await api(`/api/solicitudes/${s.id}`, { method: 'PATCH', body: { escenario_elegido: e.target.value } }); vistaSolicitud(id); } catch (err) { toast(err.message); }
  });
  document.getElementById('enviar')?.addEventListener('click', async (ev) => {
    ev.currentTarget.disabled = true;
    try { await api(`/api/solicitudes/${s.id}`, { method: 'PATCH', body: { accion: 'enviar' } }); toast('Solicitud enviada al comité'); refreshComiteCount(); vistaSolicitud(id); } catch (e) { toast(e.message); ev.currentTarget.disabled = false; }
  });
  const decidir = (decision) => async (ev) => {
    ev.currentTarget.disabled = true;
    try {
      await api(`/api/solicitudes/${s.id}/decision`, { method: 'POST', body: { decision, comentario: document.getElementById('coment').value, decidido_por: state.yo?.id } });
      toast(decision === 'Aprobada' ? 'Solicitud aprobada' : 'Solicitud rechazada');
      refreshComiteCount();
      vistaSolicitud(id);
    } catch (e) { toast(e.message); ev.currentTarget.disabled = false; }
  };
  document.getElementById('aprobar')?.addEventListener('click', decidir('Aprobada'));
  document.getElementById('rechazar')?.addEventListener('click', decidir('Rechazada'));
}

// ---------- Listas ----------
function tablaSolicitudes(lista, vacio) {
  if (!lista.length) return `<div class="empty">${icon('inbox')}<strong>${vacio.t}</strong><span class="subtle">${vacio.d}</span></div>`;
  return `<div class="table-wrap"><table>
    <thead><tr><th>Cliente</th><th>Solicitud</th><th>Motivo</th><th>Escenario</th><th class="num">Nueva cuota</th><th>Estado</th><th>Fecha</th></tr></thead>
    <tbody>${lista.map((s) => `<tr class="link" data-href="#/solicitud/${s.id}" tabindex="0">
      <td class="who"><strong>${esc(s.credito.cliente.nombres)}</strong><span>${esc(s.credito.cliente.agencia)}</span></td>
      <td class="who"><strong>${esc(s.codigo)}</strong><span>${esc(s.credito.codigo)}</span></td>
      <td>${esc(s.motivo)}</td>
      <td>${escTag(s.escenario_elegido)}</td>
      <td class="num">${s.cuota_nueva ? soles(s.cuota_nueva) : '—'}</td>
      <td>${estadoTag(s.estado)}</td>
      <td class="subtle">${fecha(s.created_at)}</td></tr>`).join('')}</tbody></table></div>`;
}

function enlazarFilas() {
  const go = (e) => { const tr = e.target.closest('tr[data-href]'); if (tr) location.hash = tr.dataset.href; };
  $app.querySelectorAll('tbody').forEach((tb) => { tb.addEventListener('click', go); tb.addEventListener('keydown', (e) => e.key === 'Enter' && go(e)); });
}

async function vistaLista({ nav, titulo, texto, estado, vacio }) {
  setNav(nav);
  loading();
  const lista = await api(`/api/solicitudes${estado ? `?estado=${encodeURIComponent(estado)}` : ''}`);
  render(`<header class="page-head"><div><h1>${titulo}</h1><p>${texto}</p></div></header>
    <section class="panel">${tablaSolicitudes(lista, vacio)}</section>`);
  enlazarFilas();
}

async function vistaSeguimiento() {
  setNav('seguimiento');
  loading();
  const lista = (await api('/api/solicitudes?estado=Aprobada'));
  const filas = lista.map((s) => {
    const venc = s.seguimiento.filter((x) => new Date(x.fecha_vencimiento) <= new Date());
    const pag = venc.filter((x) => x.estado.startsWith('Pagada'));
    return { s, venc, pag };
  });
  render(`<header class="page-head"><div><h1>Seguimiento posterior</h1><p>Las tres primeras cuotas después de reestructurar son el mejor indicador de que la decisión fue correcta. Un atraso aquí es una alerta para Recuperaciones.</p></div></header>
    <section class="panel">${filas.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Cliente</th><th>Escenario</th><th>Aprobada</th><th>Cuotas</th><th>Estado</th></tr></thead>
      <tbody>${filas.map(({ s, venc, pag }) => `<tr class="link" data-href="#/solicitud/${s.id}" tabindex="0">
        <td class="who"><strong>${esc(s.credito.cliente.nombres)}</strong><span>${esc(s.credito.codigo)}</span></td>
        <td>${escTag(s.escenario_elegido)}</td>
        <td class="subtle">${s.decidido_en ? fecha(s.decidido_en) : '—'}</td>
        <td><div class="hist">${s.seguimiento.map((x) => `<span class="${x.estado === 'Pagada' ? '' : x.estado === 'Pagada con atraso' ? 'l1' : x.estado === 'Vencida' ? 'l3' : 'pend'}" title="Cuota ${x.numero_cuota} · ${fecha(x.fecha_vencimiento)} · ${x.estado}"></span>`).join('') || '<span class="subtle">Sin cronograma</span>'}</div></td>
        <td>${!venc.length ? '<span class="tag">Aún sin vencimientos</span>' : pag.length === venc.length ? '<span class="tag tag-ok">Al día</span>' : '<span class="tag tag-bad">Con atraso</span>'}</td>
      </tr>`).join('')}</tbody></table></div>` : `<div class="empty">${icon('trend')}<strong>Todavía no hay reestructuraciones aprobadas</strong><span class="subtle">Cuando el comité apruebe una solicitud, sus primeras cuotas aparecerán aquí.</span></div>`}</section>`);
  enlazarFilas();
}

// ---------- Router ----------
async function router() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [, ruta, id] = h.split('/');
  try {
    if (ruta === 'credito' && id) await vistaCredito(id);
    else if (ruta === 'solicitud' && id) await vistaSolicitud(id);
    else if (ruta === 'solicitudes') await vistaLista({ nav: 'solicitudes', titulo: 'Solicitudes de reestructuración', texto: 'Todas las solicitudes creadas por los asesores, con la recomendación de la IA y su estado.', vacio: { t: 'Aún no hay solicitudes', d: 'Abra un crédito desde la cartera para crear la primera.' } });
    else if (ruta === 'comite') await vistaLista({ nav: 'comite', titulo: 'Comité de créditos', texto: 'Solicitudes esperando decisión. Cada una incluye el informe técnico redactado por la IA y los tres escenarios calculados.', estado: 'En comité', vacio: { t: 'No hay solicitudes pendientes', d: 'Cuando un asesor envíe una solicitud, aparecerá aquí.' } });
    else if (ruta === 'seguimiento') await vistaSeguimiento();
    else await vistaPanel();
  } catch (e) { errorView(e); }
}

async function init() {
  try {
    state.asesores = await api('/api/asesores');
    const sel = document.getElementById('rol');
    const etiqueta = { asesor: 'Asesora de Negocios', comite: 'Comité de Créditos', jefe_riesgos: 'Jefa de Riesgos' };
    sel.innerHTML = state.asesores.map((a) => `<option value="${a.id}">${esc(a.nombre)} · ${etiqueta[a.rol]}</option>`).join('');
    const guardado = store.get('rol');
    state.yo = state.asesores.find((a) => a.id === guardado) || state.asesores.find((a) => a.rol === 'asesor');
    sel.value = state.yo?.id || '';
    sel.addEventListener('change', () => { state.yo = state.asesores.find((a) => a.id === sel.value); store.set('rol', sel.value); router(); });
  } catch { /* la vista mostrará el error */ }
  hydrateIcons(document.querySelector('.side'));
  refreshComiteCount();
  window.addEventListener('hashchange', router);
  router();
}
init();
