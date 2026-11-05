// Imitación mínima del cliente de Supabase, solo para probar la app sin conexión.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const data = JSON.parse(readFileSync(new URL('./fixture.json', import.meta.url)));
const REL = {
  cliente: { tabla: 'clientes', fk: 'cliente_id' },
  credito: { tabla: 'creditos', fk: 'credito_id' },
  asesor: { tabla: 'asesores', fk: 'asesor_id' },
  decisor: { tabla: 'asesores', fk: 'decidido_por' },
};

function embed(row, sel) {
  const out = { ...row };
  const re = /(\w+):(\w+)(?:!\w+)?\(([^()]*(?:\([^()]*\))?[^()]*)\)/g;
  let m;
  while ((m = re.exec(sel))) {
    const r = REL[m[1]];
    const hijo = data[r.tabla].find((x) => x.id === row[r.fk]);
    out[m[1]] = hijo ? embed(hijo, m[3]) : null;
  }
  return out;
}

class Q {
  constructor(t) { this.t = t; this.f = []; this.op = 'select'; this.sel = '*'; }
  select(s = '*') { if (this.op === 'select') this.sel = s; this.ret = true; return this; }
  eq(k, v) { this.f.push((r) => r[k] === v); return this; }
  order(k, o = {}) { this.ord = [k, o.ascending !== false]; return this; }
  insert(v) { this.op = 'insert'; this.val = v; return this; }
  update(v) { this.op = 'update'; this.val = v; return this; }
  maybeSingle() { this.one = 'maybe'; return this; }
  single() { this.one = 'single'; return this; }
  then(res, rej) { return Promise.resolve(this.run()).then(res, rej); }
  run() {
    const tabla = data[this.t];
    if (this.op === 'insert') {
      const filas = (Array.isArray(this.val) ? this.val : [this.val]).map((v) => ({
        id: randomUUID(), created_at: new Date().toISOString(),
        ...(this.t === 'solicitudes' ? { codigo: 'SOL-' + Math.random().toString(16).slice(2, 6).toUpperCase(), seguimiento: undefined } : {}), ...v,
      }));
      tabla.push(...filas);
      return { data: this.one ? filas[0] : filas, error: null };
    }
    let filas = tabla.filter((r) => this.f.every((f) => f(r)));
    if (this.op === 'update') { filas.forEach((r) => Object.assign(r, this.val)); return { data: null, error: null }; }
    if (this.ord) { const [k, asc] = this.ord; filas = [...filas].sort((a, b) => (a[k] > b[k] ? 1 : -1) * (asc ? 1 : -1)); }
    filas = filas.map((r) => embed(r, this.sel));
    if (this.one) return { data: filas[0] || null, error: null };
    return { data: filas, error: null };
  }
}

export default { from: (t) => new Q(t) };
