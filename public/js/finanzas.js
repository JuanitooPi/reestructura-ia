// Motor financiero de ReestructuraIA.
// Se usa en el navegador (simulación instantánea) y en el servidor (cálculo oficial).
// Todos los cálculos son deterministas: la IA explica, pero no inventa números.

export const POLITICA = {
  limiteCapacidad: 0.7,        // la cuota no debe superar el 70% del excedente mensual
  maxDiasReprogramar: 30,      // atraso máximo para reprogramar (política interna referencial)
  maxReprogramaciones: 2,      // número máximo de reprogramaciones previas
  maxGraciaMeses: 3,
  maxPlazoRefinanciado: 60,
  clasificacionesReprogramables: ['Normal', 'CPP'],
};

export const tasaMensual = (tea) => Math.pow(1 + tea / 100, 1 / 12) - 1;

// Cuota del sistema francés
export function cuotaFrancesa(capital, tea, n) {
  if (n <= 0) return capital;
  const i = tasaMensual(tea);
  if (i === 0) return capital / n;
  return (capital * i) / (1 - Math.pow(1 + i, -n));
}

const r2 = (x) => Math.round(x * 100) / 100;

export function capacidadPago({ ingreso, gasto, otrasDeudas = 0 }) {
  const excedente = ingreso - gasto - otrasDeudas;
  return { excedente: r2(excedente), limite: r2(Math.max(0, excedente) * POLITICA.limiteCapacidad) };
}

// Puntaje de riesgo 0–100 (mayor = más riesgo)
export function puntajeRiesgo({ credito, cliente, excedente }) {
  const hist = credito.historial_pagos || [];
  const conAtraso = hist.filter((h) => h.dias_atraso > 0).length;
  const pctAtraso = hist.length ? conAtraso / hist.length : 0;
  const promAtraso = hist.length ? hist.reduce((a, h) => a + h.dias_atraso, 0) / hist.length : 0;
  const ratio = excedente > 0 ? credito.cuota_actual / excedente : 1.5;
  const clasif = { Normal: 0, CPP: 4, Deficiente: 7, Dudoso: 9, 'Pérdida': 10 }[cliente.clasificacion_sbs] ?? 5;

  const factores = [
    { clave: 'atraso_actual', etiqueta: 'Días de atraso actuales', puntos: Math.min(credito.dias_atraso / 90, 1) * 35 },
    { clave: 'frecuencia', etiqueta: 'Frecuencia de atrasos en el historial', puntos: pctAtraso * 20 },
    { clave: 'severidad', etiqueta: 'Atraso promedio histórico', puntos: Math.min(promAtraso / 30, 1) * 10 },
    { clave: 'carga', etiqueta: 'Peso de la cuota sobre el excedente', puntos: (Math.min(Math.max(ratio, 0), 1.5) / 1.5) * 25 },
    { clave: 'clasificacion', etiqueta: 'Clasificación SBS del deudor', puntos: clasif },
  ].map((f) => ({ ...f, puntos: Math.round(f.puntos) }));

  const total = Math.min(100, factores.reduce((a, f) => a + f.puntos, 0));
  const nivel = total < 35 ? 'Bajo' : total < 60 ? 'Medio' : 'Alto';
  return { total, nivel, factores, pctAtraso: r2(pctAtraso * 100), promAtraso: r2(promAtraso) };
}

function interesVencido(saldo, tea, diasAtraso) {
  return saldo * tasaMensual(tea) * (diasAtraso / 30);
}

/**
 * Simula los tres escenarios.
 * @param {object} p
 *  credito, cliente, ingreso, gasto, eventoTemporal, gracia, plazoRefin, ajusteTasa
 */
export function simular(p) {
  const { credito, cliente } = p;
  const ingreso = Number(p.ingreso ?? cliente.ingreso_mensual);
  const gasto = Number(p.gasto ?? cliente.gasto_mensual);
  const otrasDeudas = Number(cliente.otras_deudas || 0);
  const eventoTemporal = p.eventoTemporal !== false;
  const gracia = Math.min(Math.max(Number(p.gracia ?? 2), 1), POLITICA.maxGraciaMeses);
  const ajusteTasa = Number(p.ajusteTasa ?? 0);

  const saldo = Number(credito.saldo_capital);
  const tea = Number(credito.tea);
  const nRest = credito.plazo_meses - credito.cuotas_pagadas;
  const cuotaActual = Number(credito.cuota_actual);
  const { excedente, limite } = capacidadPago({ ingreso, gasto, otrasDeudas });
  const intVenc = interesVencido(saldo, tea, credito.dias_atraso);
  const cuotasVencidas = Math.ceil(credito.dias_atraso / 30);

  // Capacidad habitual (antes de la dificultad): es la que vuelve si el evento es temporal
  const habitual = capacidadPago({ ingreso: Number(cliente.ingreso_mensual), gasto: Number(cliente.gasto_mensual), otrasDeudas });

  const evalCuota = (c, cap = { excedente, limite }) => ({
    cabe: c <= cap.limite && cap.limite > 0,
    usoExcedente: cap.excedente > 0 ? r2((c / cap.excedente) * 100) : null,
  });

  // A. Sin cambio
  const totalA = cuotaActual * nRest;
  const sinCambio = {
    id: 'sin_cambio',
    nombre: 'Mantener condiciones',
    descripcion: 'El cliente regulariza lo vencido y continúa con su cronograma.',
    cuota: r2(cuotaActual),
    plazoRestante: nRest,
    graciaMeses: 0,
    tea,
    montoRegularizar: r2(cuotasVencidas * cuotaActual + intVenc),
    totalPagar: r2(totalA + intVenc),
    interesTotal: r2(totalA + intVenc - saldo),
    ...evalCuota(cuotaActual),
    impactoSBS: 'Sin cambios en el registro del crédito.',
    condiciones: [],
  };
  sinCambio.condiciones.push({ ok: sinCambio.cabe, texto: `Cuota dentro del ${POLITICA.limiteCapacidad * 100}% del excedente` });
  sinCambio.condiciones.push({ ok: credito.dias_atraso <= 8, texto: 'Atraso actual de 8 días o menos' });
  sinCambio.viable = sinCambio.condiciones.every((c) => c.ok);

  // B. Reprogramación: periodo de gracia, intereses capitalizados, misma tasa
  const capitalB = (saldo + intVenc) * Math.pow(1 + tasaMensual(tea), gracia);
  const cuotaB = cuotaFrancesa(capitalB, tea, nRest);
  const totalB = cuotaB * nRest;
  const reprogramacion = {
    id: 'reprogramacion',
    nombre: 'Reprogramación',
    descripcion: `${gracia} ${gracia === 1 ? 'mes' : 'meses'} de gracia y se retoman las ${nRest} cuotas restantes, misma tasa.`,
    cuota: r2(cuotaB),
    plazoRestante: nRest + gracia,
    graciaMeses: gracia,
    tea,
    montoRegularizar: 0,
    totalPagar: r2(totalB),
    interesTotal: r2(totalB - saldo),
    ...evalCuota(cuotaB, habitual),
    baseCapacidad: 'habitual',
    impactoSBS: 'Si cumple las condiciones, no se registra como refinanciación y no afecta la calificación del cliente.',
    condiciones: [
      { ok: eventoTemporal, texto: 'Dificultad temporal (no permanente)' },
      { ok: credito.dias_atraso <= POLITICA.maxDiasReprogramar, texto: `Atraso de ${POLITICA.maxDiasReprogramar} días o menos` },
      { ok: POLITICA.clasificacionesReprogramables.includes(cliente.clasificacion_sbs), texto: 'Clasificación Normal o CPP' },
      { ok: (credito.veces_reprogramado || 0) < POLITICA.maxReprogramaciones, texto: `Menos de ${POLITICA.maxReprogramaciones} reprogramaciones previas` },
    ],
  };
  reprogramacion.condiciones.push({ ok: reprogramacion.cabe, texto: 'Al recuperarse, la cuota entra en su capacidad habitual' });
  reprogramacion.viable = reprogramacion.condiciones.every((c) => c.ok);

  // C. Refinanciamiento: nuevo plazo ajustado a la capacidad
  const teaC = Math.max(0, tea + ajusteTasa);
  const capitalC = saldo + intVenc;
  let plazoC = p.plazoRefin ? Number(p.plazoRefin) : null;
  if (!plazoC) {
    plazoC = Math.min(POLITICA.maxPlazoRefinanciado, nRest + 36);
    for (let n = Math.max(nRest, 6); n <= Math.min(POLITICA.maxPlazoRefinanciado, nRest + 36); n++) {
      if (cuotaFrancesa(capitalC, teaC, n) <= limite) { plazoC = n; break; }
    }
  }
  plazoC = Math.min(Math.max(plazoC, 3), POLITICA.maxPlazoRefinanciado);
  const cuotaC = cuotaFrancesa(capitalC, teaC, plazoC);
  const totalC = cuotaC * plazoC;
  const refinanciamiento = {
    id: 'refinanciamiento',
    nombre: 'Refinanciamiento',
    descripcion: `Nuevo crédito a ${plazoC} meses${ajusteTasa ? ` con TEA ${teaC.toFixed(1)}%` : ''}, cuota ajustada al excedente.`,
    cuota: r2(cuotaC),
    plazoRestante: plazoC,
    graciaMeses: 0,
    tea: r2(teaC),
    montoRegularizar: 0,
    totalPagar: r2(totalC),
    interesTotal: r2(totalC - saldo),
    ...evalCuota(cuotaC),
    impactoSBS: 'Se registra como crédito refinanciado: la clasificación no mejora de inmediato y la caja constituye mayores provisiones.',
    condiciones: [
      { ok: excedente > 0, texto: 'El cliente tiene excedente positivo' },
      { ok: cuotaC <= limite && limite > 0, texto: 'Nueva cuota dentro de la capacidad' },
      { ok: plazoC <= POLITICA.maxPlazoRefinanciado, texto: `Plazo de ${POLITICA.maxPlazoRefinanciado} meses o menos` },
    ],
  };
  refinanciamiento.viable = refinanciamiento.condiciones.every((c) => c.ok);

  const riesgo = puntajeRiesgo({ credito, cliente, excedente });

  // Recomendación del motor de reglas
  let recomendado = null;
  let razon = '';
  if (sinCambio.viable) {
    recomendado = 'sin_cambio';
    razon = 'El cliente puede seguir pagando su cuota actual; reestructurar encarecería el crédito sin necesidad.';
  } else if (reprogramacion.viable) {
    recomendado = 'reprogramacion';
    razon = 'La dificultad es temporal y el cliente cumple las condiciones para reprogramar sin afectar su calificación.';
  } else if (refinanciamiento.viable) {
    recomendado = 'refinanciamiento';
    razon = 'La reprogramación no es suficiente o no aplica; se requiere una cuota menor con mayor plazo.';
  } else {
    razon = 'Ninguna alternativa entra en la capacidad de pago. Se sugiere derivar a Recuperaciones o evaluar garantías.';
  }

  return {
    entrada: { ingreso, gasto, otrasDeudas, eventoTemporal, gracia, ajusteTasa },
    capacidad: { excedente, limite, porcentajeLimite: POLITICA.limiteCapacidad * 100, habitual },
    saldo: r2(saldo),
    interesVencido: r2(intVenc),
    cuotasRestantes: nRest,
    riesgo,
    escenarios: [sinCambio, reprogramacion, refinanciamiento],
    motor: { recomendado, razon },
  };
}

export const soles = (n) =>
  'S/\u00a0' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
