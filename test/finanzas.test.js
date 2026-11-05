import test from 'node:test';
import assert from 'node:assert/strict';
import { cuotaFrancesa, simular, tasaMensual } from '../public/js/finanzas.js';

const cliente = { ingreso_mensual: 3800, gasto_mensual: 2100, otras_deudas: 0, clasificacion_sbs: 'Normal' };
const credito = { saldo_capital: 10479.94, tea: 38.5, plazo_meses: 24, cuotas_pagadas: 9, cuota_actual: 862.16, dias_atraso: 18, veces_reprogramado: 0,
  historial_pagos: Array.from({ length: 9 }, (_, k) => ({ cuota: k + 1, dias_atraso: k === 8 ? 18 : 0 })) };

test('cuota francesa coincide con la base de datos', () => {
  assert.equal(Math.round(cuotaFrancesa(15000, 38.5, 24) * 100) / 100, 862.16);
});

test('la cuota francesa amortiza el capital exactamente', () => {
  const i = tasaMensual(30), n = 18, P = 9000, c = cuotaFrancesa(P, 30, n);
  let s = P; for (let k = 0; k < n; k++) s = s * (1 + i) - c;
  assert.ok(Math.abs(s) < 1e-6);
});

test('caída de ventas temporal → reprogramación', () => {
  const r = simular({ credito, cliente, ingreso: 2600, gasto: 1500, eventoTemporal: true, gracia: 2 });
  console.log(JSON.stringify({ cap: r.capacidad, motor: r.motor, esc: r.escenarios.map(e => [e.id, e.cuota, e.plazoRestante, e.viable, e.interesTotal]), riesgo: r.riesgo.total }));
  assert.equal(r.motor.recomendado, 'reprogramacion');
});

test('caída permanente → refinanciamiento', () => {
  const r = simular({ credito, cliente, ingreso: 2300, gasto: 1500, eventoTemporal: false });
  console.log(JSON.stringify({ cap: r.capacidad, motor: r.motor, esc: r.escenarios.map(e => [e.id, e.cuota, e.plazoRestante, e.viable]) }));
  assert.equal(r.motor.recomendado, 'refinanciamiento');
  assert.ok(r.escenarios[2].cuota <= r.capacidad.limite);
});

test('sin capacidad → ninguna alternativa', () => {
  const r = simular({ credito, cliente, ingreso: 1600, gasto: 1500, eventoTemporal: false });
  assert.equal(r.motor.recomendado, null);
});
