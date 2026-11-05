// Capa de IA: Google Gemini explica y redacta; los números vienen del motor financiero.
import { soles } from '../public/js/finanzas.js';

const MODELOS = [...new Set([process.env.GEMINI_MODEL, 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-flash-latest'].filter(Boolean))];
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const NOMBRES = { sin_cambio: 'Mantener condiciones', reprogramacion: 'Reprogramación', refinanciamiento: 'Refinanciamiento' };

export const iaDisponible = () => Boolean(process.env.GEMINI_API_KEY);

function construirPrompt({ cliente, credito, solicitud, sim }) {
  const esc = sim.escenarios
    .map((e) => `- ${e.nombre} (${e.id}): cuota ${soles(e.cuota)}, plazo ${e.plazoRestante} meses, gracia ${e.graciaMeses}, TEA ${e.tea}%, intereses totales ${soles(e.interesTotal)}, entra en capacidad: ${e.cabe ? 'sí' : 'no'}, viable según política: ${e.viable ? 'sí' : 'no'}. Condiciones: ${e.condiciones.map((c) => `${c.ok ? '✔' : '✘'} ${c.texto}`).join('; ')}. Impacto SBS: ${e.impactoSBS}`)
    .join('\n');
  return `Eres analista senior de riesgos de una Caja Municipal de Ahorro y Crédito del Perú.
Evalúas una solicitud de reestructuración de deuda. Los cálculos ya están hechos por el motor financiero: NO inventes ni recalcules cifras, usa solo las que se te dan.
Normativa: la SBS distingue la reprogramación (cambio de cronograma por dificultad temporal, que bajo condiciones no se considera refinanciación ni afecta la calificación) del refinanciamiento (nuevo crédito por deterioro de la capacidad de pago, que se reporta como refinanciado y exige mayores provisiones) según el Reglamento para la Evaluación y Clasificación del Deudor y la Exigencia de Provisiones (Res. SBS N.º 11356-2008 y modificatorias).

CLIENTE: ${cliente.nombres}, DNI ${cliente.dni}. ${cliente.tipo_credito}, actividad: ${cliente.actividad}. Agencia ${cliente.agencia}. Clasificación SBS: ${cliente.clasificacion_sbs}.
Ingreso habitual ${soles(cliente.ingreso_mensual)}, gasto habitual ${soles(cliente.gasto_mensual)}, otras deudas ${soles(cliente.otras_deudas)}.
CRÉDITO ${credito.codigo} (${credito.producto}): monto original ${soles(credito.monto_original)}, saldo capital ${soles(credito.saldo_capital)}, TEA ${credito.tea}%, ${credito.cuotas_pagadas}/${credito.plazo_meses} cuotas pagadas, cuota ${soles(credito.cuota_actual)}, ${credito.dias_atraso} días de atraso, reprogramado ${credito.veces_reprogramado} veces.
Historial: ${sim.riesgo.pctAtraso}% de cuotas con atraso, atraso promedio ${sim.riesgo.promAtraso} días.
SOLICITUD: motivo "${solicitud.motivo}". Detalle: "${solicitud.descripcion || 'sin detalle'}". Dificultad temporal: ${solicitud.evento_temporal ? 'sí' : 'no'}.
Ingreso actual ${soles(sim.entrada.ingreso)}, gasto actual ${soles(sim.entrada.gasto)}. Excedente actual ${soles(sim.capacidad.excedente)} (límite de cuota ${soles(sim.capacidad.limite)} = ${sim.capacidad.porcentajeLimite}%). Excedente habitual ${soles(sim.capacidad.habitual.excedente)}.
Puntaje de riesgo: ${sim.riesgo.total}/100 (${sim.riesgo.nivel}).
ESCENARIOS:
${esc}
Recomendación del motor de reglas: ${sim.motor.recomendado || 'ninguna'} — ${sim.motor.razon}

Responde SOLO con JSON válido con esta forma:
{
 "escenario": "sin_cambio" | "reprogramacion" | "refinanciamiento" | "ninguno",
 "coincide_con_motor": boolean,
 "confianza": entero 0-100,
 "resumen": "1-2 frases en español, claras, para el asesor",
 "factores_favor": ["máx 3 frases cortas"],
 "factores_riesgo": ["máx 3 frases cortas"],
 "condiciones_sugeridas": ["máx 3 condiciones de seguimiento concretas"],
 "informe_comite": "Informe técnico formal para el Comité de Créditos, 180-260 palabras, con secciones en texto plano tituladas exactamente: 1. Antecedentes, 2. Evaluación de capacidad de pago, 3. Alternativas evaluadas, 4. Recomendación, 5. Impacto regulatorio. Separa secciones con salto de línea.",
 "mensaje_cliente": "Mensaje de WhatsApp para el cliente, tono cercano y respetuoso, trato de usted, máx 550 caracteres, explica la propuesta y la nueva cuota, invita a acercarse a la agencia ${cliente.agencia}. Sin emojis."
}
Si discrepas del motor, explica por qué en el resumen.`;
}

async function llamarGemini(prompt) {
  let ultimoError;
  const intentos = MODELOS.flatMap((m) => [m, m]); // cada modelo se reintenta una vez (503 = saturado)
  for (const [n, modelo] of intentos.entries()) {
    if (n % 2 === 1) await espera(1500);
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.4, responseMimeType: 'application/json' },
          }),
          signal: AbortSignal.timeout(45000),
        }
      );
      if (!res.ok) throw new Error(`Gemini ${modelo} respondió ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      const texto = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
      const json = JSON.parse(texto.replace(/^```json\s*|```$/g, ''));
      return { ...json, fuente: `Google Gemini (${modelo})` };
    } catch (e) {
      ultimoError = e;
      console.error(`[IA] Intento con ${modelo} falló: ${e.message}`);
      if (/ 4(00|01|03) /.test(e.message)) break; // clave inválida o sin permiso: no insistir
    }
  }
  throw ultimoError;
}

// Respaldo sin IA: misma estructura, redactada con plantillas del motor de reglas
function respaldo({ cliente, credito, solicitud, sim }) {
  const id = sim.motor.recomendado;
  const e = sim.escenarios.find((x) => x.id === id);
  const nombre = cliente.nombres.split(' ')[0];
  const alternativas = sim.escenarios
    .map((x) => `${x.nombre}: cuota ${soles(x.cuota)} a ${x.plazoRestante} meses (${x.viable ? 'viable' : 'no viable'}).`)
    .join(' ');
  return {
    escenario: id || 'ninguno',
    coincide_con_motor: true,
    confianza: id ? 70 : 50,
    resumen: sim.motor.razon,
    factores_favor: [
      sim.riesgo.pctAtraso === 0 ? 'Historial puntual: ninguna cuota con atraso.' : sim.riesgo.pctAtraso < 30 ? `Buen historial: solo ${sim.riesgo.pctAtraso}% de cuotas con atraso.` : null,
      solicitud.evento_temporal ? 'La dificultad declarada es temporal.' : null,
      sim.capacidad.excedente > 0 ? `Mantiene un excedente de ${soles(sim.capacidad.excedente)}.` : null,
    ].filter(Boolean),
    factores_riesgo: [
      credito.dias_atraso > 30 ? `Atraso actual de ${credito.dias_atraso} días.` : null,
      cliente.clasificacion_sbs !== 'Normal' ? `Clasificación SBS ${cliente.clasificacion_sbs}.` : null,
      cliente.otras_deudas > 0 ? `Otras deudas por ${soles(cliente.otras_deudas)} mensuales.` : null,
    ].filter(Boolean),
    condiciones_sugeridas: ['Visita de verificación del negocio en 30 días.', 'Seguimiento de las 3 primeras cuotas posteriores.'],
    informe_comite: `1. Antecedentes\n${cliente.nombres} (${cliente.actividad}) mantiene el crédito ${credito.codigo} con saldo de ${soles(credito.saldo_capital)} y ${credito.dias_atraso} días de atraso. Motivo: ${solicitud.motivo}.\n2. Evaluación de capacidad de pago\nExcedente actual ${soles(sim.capacidad.excedente)}; límite de cuota ${soles(sim.capacidad.limite)}. Puntaje de riesgo ${sim.riesgo.total}/100 (${sim.riesgo.nivel}).\n3. Alternativas evaluadas\n${alternativas}\n4. Recomendación\n${e ? `${e.nombre}: ${e.descripcion}` : 'Derivar a Recuperaciones.'} ${sim.motor.razon}\n5. Impacto regulatorio\n${e ? e.impactoSBS : 'No aplica reestructuración.'}`,
    mensaje_cliente: e
      ? `Estimado(a) ${nombre}, en Caja le proponemos una ${e.nombre.toLowerCase()} de su crédito ${credito.codigo}: ${e.graciaMeses ? `${e.graciaMeses} meses sin cuota y luego ` : ''}una cuota de ${soles(e.cuota)} por ${e.plazoRestante - e.graciaMeses} meses. Acérquese a la agencia ${cliente.agencia} para revisar y firmar la propuesta. Estamos para ayudarle.`
      : `Estimado(a) ${nombre}, queremos conversar con usted sobre su crédito ${credito.codigo}. Por favor acérquese a la agencia ${cliente.agencia} para buscar juntos una solución.`,
    fuente: 'Motor de reglas (IA no configurada)',
  };
}

export async function analizar(ctx) {
  if (!iaDisponible()) return respaldo(ctx);
  try {
    const r = await llamarGemini(construirPrompt(ctx));
    if (!['sin_cambio', 'reprogramacion', 'refinanciamiento', 'ninguno'].includes(r.escenario)) r.escenario = ctx.sim.motor.recomendado || 'ninguno';
    return r;
  } catch (e) {
    console.error('[IA] Fallo Gemini, usando respaldo:', e.message);
    return { ...respaldo(ctx), fuente: 'Motor de reglas (Gemini no respondió)' };
  }
}

export { NOMBRES };
