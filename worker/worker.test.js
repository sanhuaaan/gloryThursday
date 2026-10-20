// Prueba del Worker de votos: node --test worker/   (Google y la base D1, simulados)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.js';
import { GOOGLE_CLIENT_ID, VOTE_DOMAIN } from '../rules.js';

// D1 de mentira: solo las consultas que hace el Worker
const rows = new Map(), cravings = new Map();
let extra = null;   // fila única de extra_balls
const BallsQ = (sql, args) => ({
  first: async () => extra && { doc: extra.doc, version: extra.version },
  run: async () => { if (extra && extra.version !== args[2]) return { meta: { changes: 0 } }; extra = { doc: args[0], version: args[1] }; return { meta: { changes: 1 } }; },
});
const CravingQ = (sql, args) => ({
  run: async () => /^DELETE/.test(sql) ? cravings.delete(`${args[0]}|${args[1]}`) : cravings.set(`${args[0]}|${args[1]}`, { after: args[0], groups: args[2] }),
  first: async () => (cravings.get(`${args[0]}|${args[1]}`) || {}).groups ?? null,
  all: async () => ({ results: [...cravings.values()].filter(c => c.after === args[0]) }),
});
const DB = {
  prepare: sql => {
    let args = [];
    if (/extra_balls/.test(sql)) { const q = { bind: (...a) => Object.assign(q, BallsQ(sql, a)) }; return Object.assign(q, BallsQ(sql, [])); }
    if (/cravings/.test(sql)) { const q = { bind: (...a) => Object.assign(q, CravingQ(sql, a)) }; return Object.assign(q, CravingQ(sql, [])); }
    const q = {
      bind: (...a) => (args = a, q),
      run: async () => rows.set(`${args[0]}|${args[1]}`, { raffle: args[0], voter: args[1], verdict: args[2] }),
      first: async () => (rows.get(`${args[0]}|${args[1]}`) || {}).verdict ?? null,
      all: async () => {
        const n = {};
        [...rows.values()].filter(r => !/WHERE/.test(sql) || r.raffle === args[0])
          .forEach(r => { const k = `${r.raffle}|${r.verdict}`; n[k] = n[k] || { raffle: r.raffle, verdict: r.verdict, n: 0 }; n[k].n++; });
        return { results: Object.values(n) };
      },
    };
    return q;
  },
};
const TOKENS = {
  ana: { aud: GOOGLE_CLIENT_ID, email_verified: 'true', hd: VOTE_DOMAIN, email: 'ana@' + VOTE_DOMAIN },
  bea: { aud: GOOGLE_CLIENT_ID, email_verified: 'true', hd: VOTE_DOMAIN, email: 'Bea@' + VOTE_DOMAIN },
  gmail: { aud: GOOGLE_CLIENT_ID, email_verified: 'true', email: 'x@gmail.com' },
  otra: { aud: 'otra-web', email_verified: 'true', hd: VOTE_DOMAIN, email: 'c@' + VOTE_DOMAIN },
};
const winner = (number, date) => ({ number, created_at: date + 'T10:00:00Z', labels: ['ganador'], body: `tienda: s${number}\nfecha: ${date}`, html_url: '', user: { login: 'x', avatar_url: '' } });
globalThis.fetch = async url => {
  const t = new URL(url).searchParams.get('id_token');
  if (t != null) return TOKENS[t] ? Response.json(TOKENS[t]) : new Response('{}', { status: 400 });
  if (/stores\.json/.test(url)) return Response.json({ rows: [{ group: 'Indio', slug: 'taj' }, { group: 'Poke', slug: 'nalu' }, { group: 'Pizza', slug: 'napoli' }, { group: 'Kebab', slug: 'qasim' }] });
  return Response.json([winner(7, '2026-11-12'), winner(4, '2026-10-08')]);
};
const call = (method, path, token, body) => worker.fetch(new Request('https://w' + path, {
  method, headers: token ? { Authorization: 'Bearer ' + token } : {}, body: body && JSON.stringify(body) }), { DB, BACKROOM: 'Ana@' + VOTE_DOMAIN + ', x@' + VOTE_DOMAIN });

test('solo votan cuentas del dominio, para nuestra web, en el último sorteo; votar otra vez cambia el voto', async () => {
  for (const t of [null, 'nadie', 'gmail', 'otra']) assert.equal((await call('POST', '/vote', t, { sorteo: 7, verdict: 'repetir' })).status, 401, t);
  assert.equal((await call('POST', '/vote', 'ana', { sorteo: 4, verdict: 'repetir' })).status, 409);   // sorteo cerrado
  assert.equal((await call('POST', '/vote', 'ana', { sorteo: 7, verdict: 'inventado' })).status, 400);

  assert.deepEqual(await (await call('GET', '/vote?sorteo=7', 'ana')).json(), { open: 7, mine: null, counts: null });  // sin votar no ve el recuento
  await call('POST', '/vote', 'ana', { sorteo: 7, verdict: 'repetir' });
  await call('POST', '/vote', 'ana', { sorteo: 7, verdict: 'nifu' });        // cambia de carta: sigue siendo un voto
  const r = await (await call('POST', '/vote', 'bea', { sorteo: 7, verdict: 'nifu' })).json();
  assert.deepEqual(r, { open: 7, mine: 'nifu', counts: { repetir: 0, aprobado: 0, nifu: 2, nuncamas: 0 } });
  assert.ok([...rows.values()].every(x => /^[0-9a-f]{64}$/.test(x.voter)));  // nunca el correo
  assert.deepEqual(await (await call('GET', '/counts')).json(), { 7: { repetir: 0, aprobado: 0, nifu: 2, nuncamas: 0 } });
});

test('pizarra: hasta 3 marcas (rodear o tachar) de cocinas del bombo, un voto por persona que se puede cambiar o borrar', async () => {
  assert.equal((await call('POST', '/craving', 'gmail', { after: 7, marks: { Indio: 1 } })).status, 401);
  assert.equal((await call('POST', '/craving', 'ana', { after: 4, marks: { Indio: 1 } })).status, 409);           // pizarra pasada
  assert.equal((await call('POST', '/craving', 'ana', { after: 7, marks: { Indio: 1, Poke: -1, Pizza: 1, Kebab: -1 } })).status, 400);  // 4 marcas
  assert.equal((await call('POST', '/craving', 'ana', { after: 7, marks: { Fondue: 1 } })).status, 400);          // no está en el bombo
  assert.equal((await call('POST', '/craving', 'ana', { after: 7, marks: { Indio: 5 } })).status, 400);           // ni 1 ni -1
  assert.equal((await call('POST', '/craving', 'ana', { after: 7, groups: ['Indio'] })).status, 400);             // formato viejo

  assert.deepEqual(await (await call('GET', '/craving', 'ana')).json(), { after: 7, mine: null, counts: null });
  await call('POST', '/craving', 'ana', { after: 7, marks: { Indio: 1, Poke: -1 } });
  await call('POST', '/craving', 'bea', { after: 7, marks: { Indio: -1, Poke: -1 } });
  assert.deepEqual(await (await call('POST', '/craving', 'ana', { after: 7, marks: { Indio: 1, Pizza: 1, Poke: -1 } })).json(),
    { after: 7, mine: { Indio: 1, Pizza: 1, Poke: -1 }, counts: { Indio: { up: 1, down: 1 }, Pizza: { up: 1, down: 0 }, Poke: { up: 0, down: 2 } } });
  await call('POST', '/craving', 'bea', { after: 7, marks: {} });                                                 // {} borra su voto
  assert.deepEqual(await (await call('GET', '/cravings')).json(),
    { after: 7, counts: { Indio: { up: 1, down: 0 }, Pizza: { up: 1, down: 0 }, Poke: { up: 0, down: 1 } } });
  cravings.set('7|viejo', { after: 7, groups: JSON.stringify(['Pizza']) });                                     // fila del formato viejo: rodeadas
  assert.deepEqual((await (await call('GET', '/cravings')).json()).counts.Pizza, { up: 2, down: 0 });
});

test('trastienda: lectura pública; guardar solo con pase, en el sorteo en curso, sin pisar cambios ajenos', async () => {
  assert.deepEqual(await (await call('GET', '/balls')).json(), { balls: {}, stores: {}, mTo: null, updatedAt: null, version: 0 });
  assert.equal((await call('GET', '/backroom', 'bea')).status, 403);                                  // de xabet, pero sin pase
  assert.equal((await call('GET', '/backroom', 'gmail')).status, 401);
  assert.deepEqual(await (await call('GET', '/backroom', 'ana')).json(), { email: 'ana@' + VOTE_DOMAIN });  // la lista no distingue mayúsculas
  assert.equal((await call('PUT', '/balls', 'bea', { balls: { Indio: 1 }, stores: {}, mTo: 7, version: 0 })).status, 403);

  const bad = b => call('PUT', '/balls', 'ana', { stores: {}, mTo: 7, version: 0, ...b });
  assert.equal((await bad({ balls: { Indio: 10 } })).status, 400);                                     // más de 9
  assert.equal((await bad({ balls: { Fondue: 1 } })).status, 400);                                     // no es cocina del bombo
  assert.equal((await bad({ balls: { Indio: 1 }, stores: { nalu: 1 } })).status, 400);                 // restaurante de una cocina sin bolas
  assert.equal((await bad({ balls: { Indio: 1 }, mTo: 4 })).status, 409);                              // sorteo pasado

  const ok = await (await call('PUT', '/balls', 'ana', { balls: { Indio: 2 }, stores: { taj: 1 }, mTo: 7, version: 0 })).json();
  assert.deepEqual({ ...ok, updatedAt: 'x' }, { balls: { Indio: 2 }, stores: { taj: 1 }, mTo: 7, updatedAt: 'x', version: 1 });
  const stale = await call('PUT', '/balls', 'ana', { balls: { Poke: 1 }, stores: {}, mTo: 7, version: 0 });   // con la versión vieja
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).current.version, 1);
  assert.deepEqual((await (await call('GET', '/balls')).json()).balls, { Indio: 2 });
});
