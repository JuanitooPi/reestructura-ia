import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { simular, puntajeRiesgo, capacidadPago } from './public/js/finanzas.js';
import { analizar, iaDisponible } from './lib/ia.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
let db;
if (process.env.MOCK_DB) {
  db = (await import('./test/mockdb.js')).default; // solo para pruebas locales
} else {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Faltan SUPABASE_URL y SUPABASE_KEY en las variables de entorno.');
    process.exit(1);
  }
  db = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
}

const app = express();
app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '5m' }));

const ok = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    console.error(e);
    res.status(e.status || 500).json({ error: e.message || 'Error inesperado' });
  }
};
const fallo = (msg, status = 400) => Object.assign(new Error(msg), { status });
const chk = ({ data, error }) => {
  if (error) throw fallo(error.message, 500);
  return data;
};

const SEL_CREDITO = '*, cliente:clientes(*)';
const SEL_SOLICITUD = '*, credito:creditos(*, cliente:clientes(*)), asesor:asesores!solicitudes_asesor_id_fkey(nombre), decisor:asesores!solicitudes_decidido_por_fkey(nombre)';

app.get('/api/health', (req, res) => res.json({ ok: true, ia: iaDisponible() }));

app.get('/api/asesores', ok(async (req, res) => {
  res.json(chk(await db.from('asesores').select('*').order('rol')));
}));

app.get('/api/creditos', ok(async (req, res) => {
  const creditos = chk(await db.from('creditos').select(SEL_CREDITO));
  const sols = chk(await db.from('solicitudes').select('id, credito_id, estado, created_at').order('created_at', { ascending: false }));
  const out = creditos.map((c) => {
    const { excedente } = capacidadPago({ ingreso: +c.cliente.ingreso_mensual, gasto: +c.cliente.gasto_mensual, otrasDeudas: +c.cliente.otras_deudas });
    const riesgo = puntajeRiesgo({ credito: c, cliente: c.cliente, excedente });
    const ultima = sols.find((s) => s.credito_id === c.id) || null;
    return { ...c, historial_pagos: undefined, riesgo: { total: riesgo.total, nivel: riesgo.nivel }, ultima_solicitud: ultima };
  });
  out.sort((a, b) => b.riesgo.total - a.riesgo.total);
  res.json(out);
}));

app.get('/api/creditos/:id', ok(async (req, res) => {
  const c = chk(await db.from('creditos').select(SEL_CREDITO).eq('id', req.params.id).maybeSingle());
  if (!c) throw fallo('Crédito no encontrado', 404);
  const solicitudes = chk(await db.from('solicitudes').select('id, codigo, estado, motivo, escenario_elegido, created_at').eq('credito_id', c.id).order('created_at', { ascending: false }));
  res.json({ ...c, solicitudes });
}));

app.get('/api/resumen', ok(async (req, res) => {
  const creditos = chk(await db.from('creditos').select('saldo_capital, dias_atraso, estado'));
  const sols = chk(await db.from('solicitudes').select('estado, escenario_elegido, created_at, decidido_en'));
  const seg = chk(await db.from('seguimiento').select('estado, fecha_vencimiento'));
  const enRiesgo = creditos.filter((c) => c.dias_atraso > 0);
  const decididas = sols.filter((s) => ['Aprobada', 'Rechazada'].includes(s.estado));
  const vencidas = seg.filter((s) => new Date(s.fecha_vencimiento) <= new Date());
  const cumplidas = vencidas.filter((s) => s.estado.startsWith('Pagada'));
  const horas = decididas.filter((s) => s.decidido_en).map((s) => (new Date(s.decidido_en) - new Date(s.created_at)) / 36e5);
  res.json({
    carteraTotal: creditos.reduce((a, c) => a + +c.saldo_capital, 0),
    carteraEnRiesgo: enRiesgo.reduce((a, c) => a + +c.saldo_capital, 0),
    creditosEnRiesgo: enRiesgo.length,
    creditosMas30: creditos.filter((c) => c.dias_atraso > 30).length,
    totalCreditos: creditos.length,
    enComite: sols.filter((s) => s.estado === 'En comité').length,
    borradores: sols.filter((s) => s.estado === 'Borrador').length,
    aprobadas: sols.filter((s) => s.estado === 'Aprobada').length,
    tasaAprobacion: decididas.length ? (sols.filter((s) => s.estado === 'Aprobada').length / decididas.length) * 100 : null,
    cumplimiento: vencidas.length ? (cumplidas.length / vencidas.length) * 100 : null,
    horasPromedioDecision: horas.length ? horas.reduce((a, b) => a + b, 0) / horas.length : null,
    ia: iaDisponible(),
  });
}));

function leerEntrada(b) {
  const num = (v, nombre) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw fallo(`${nombre} debe ser un número positivo`);
    return n;
  };
  return {
    ingreso: num(b.ingreso_actual, 'El ingreso'),
    gasto: num(b.gasto_actual, 'El gasto'),
    eventoTemporal: b.evento_temporal !== false,
    gracia: b.gracia ? num(b.gracia, 'La gracia') : 2,
    plazoRefin: b.plazo_refin ? num(b.plazo_refin, 'El plazo') : null,
    ajusteTasa: Number(b.ajuste_tasa || 0),
  };
}

app.post('/api/solicitudes', ok(async (req, res) => {
  const b = req.body || {};
  if (!b.credito_id) throw fallo('Falta el crédito');
  if (!b.motivo?.trim()) throw fallo('Indique el motivo de la dificultad');
  const credito = chk(await db.from('creditos').select(SEL_CREDITO).eq('id', b.credito_id).maybeSingle());
  if (!credito) throw fallo('Crédito no encontrado', 404);
  const entrada = leerEntrada(b);
  const sim = simular({ credito, cliente: credito.cliente, ...entrada });
  const solicitud = { motivo: b.motivo.trim(), descripcion: (b.descripcion || '').trim(), evento_temporal: entrada.eventoTemporal };
  const ia = await analizar({ cliente: credito.cliente, credito, solicitud, sim });

  const fila = chk(await db.from('solicitudes').insert({
    credito_id: credito.id,
    asesor_id: b.asesor_id || null,
    motivo: solicitud.motivo,
    descripcion: solicitud.descripcion,
    ingreso_actual: entrada.ingreso,
    gasto_actual: entrada.gasto,
    evento_temporal: entrada.eventoTemporal,
    escenarios: sim,
    recomendacion: { ...ia, informe_comite: undefined, mensaje_cliente: undefined },
    informe_comite: ia.informe_comite,
    mensaje_cliente: ia.mensaje_cliente,
    escenario_elegido: ia.escenario === 'ninguno' ? null : ia.escenario,
    estado: 'Borrador',
  }).select('id').single());
  res.status(201).json(fila);
}));

app.get('/api/solicitudes', ok(async (req, res) => {
  let q = db.from('solicitudes').select(SEL_SOLICITUD).order('created_at', { ascending: false });
  if (req.query.estado) q = q.eq('estado', req.query.estado);
  const sols = chk(await q);
  const seg = chk(await db.from('seguimiento').select('*').order('numero_cuota'));
  res.json(sols.map((s) => ({ ...s, cuota_nueva: s.escenarios?.escenarios?.find((e) => e.id === s.escenario_elegido)?.cuota ?? null, escenarios: undefined, seguimiento: seg.filter((x) => x.solicitud_id === s.id) })));
}));

app.get('/api/solicitudes/:id', ok(async (req, res) => {
  const s = chk(await db.from('solicitudes').select(SEL_SOLICITUD).eq('id', req.params.id).maybeSingle());
  if (!s) throw fallo('Solicitud no encontrada', 404);
  const seguimiento = chk(await db.from('seguimiento').select('*').eq('solicitud_id', s.id).order('numero_cuota'));
  res.json({ ...s, seguimiento });
}));

app.patch('/api/solicitudes/:id', ok(async (req, res) => {
  const b = req.body || {};
  const cambios = {};
  if (b.informe_comite !== undefined) cambios.informe_comite = String(b.informe_comite);
  if (b.mensaje_cliente !== undefined) cambios.mensaje_cliente = String(b.mensaje_cliente);
  if (b.escenario_elegido !== undefined) cambios.escenario_elegido = b.escenario_elegido;
  if (b.accion === 'enviar') cambios.estado = 'En comité';
  chk(await db.from('solicitudes').update(cambios).eq('id', req.params.id));
  res.json({ ok: true });
}));

app.post('/api/solicitudes/:id/decision', ok(async (req, res) => {
  const { decision, comentario, decidido_por } = req.body || {};
  if (!['Aprobada', 'Rechazada'].includes(decision)) throw fallo('Decisión inválida');
  if (decision === 'Rechazada' && !comentario?.trim()) throw fallo('Explique el motivo del rechazo');
  const s = chk(await db.from('solicitudes').select('*, credito:creditos(*)').eq('id', req.params.id).maybeSingle());
  if (!s) throw fallo('Solicitud no encontrada', 404);
  if (s.estado !== 'En comité') throw fallo('La solicitud no está en comité');

  chk(await db.from('solicitudes').update({
    estado: decision, comentario_comite: comentario || null, decidido_por: decidido_por || null, decidido_en: new Date().toISOString(),
  }).eq('id', s.id));

  if (decision === 'Aprobada' && s.escenario_elegido && s.escenario_elegido !== 'sin_cambio') {
    const esc = s.escenarios?.escenarios?.find((e) => e.id === s.escenario_elegido) || { cuota: s.credito.cuota_actual, graciaMeses: 0 };
    const filas = [];
    for (let k = 1; k <= 3; k++) {
      const f = new Date();
      f.setMonth(f.getMonth() + k + (esc.graciaMeses || 0));
      filas.push({ solicitud_id: s.id, numero_cuota: k, fecha_vencimiento: f.toISOString().slice(0, 10), monto: esc.cuota, estado: 'Pendiente' });
    }
    chk(await db.from('seguimiento').insert(filas));
    chk(await db.from('creditos').update({
      estado: s.escenario_elegido === 'reprogramacion' ? 'Reprogramado' : 'Refinanciado',
      veces_reprogramado: s.credito.veces_reprogramado + (s.escenario_elegido === 'reprogramacion' ? 1 : 0),
    }).eq('id', s.credito_id));
  }
  res.json({ ok: true });
}));

app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ReestructuraIA escuchando en :${PORT} · IA ${iaDisponible() ? 'Gemini activa' : 'en modo respaldo'}`));
