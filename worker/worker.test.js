// Prueba del Worker de votos: node --test worker/   (Google y la base D1, simulados)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.js';
import { GOOGLE_CLIENT_ID, VOTE_DOMAIN } from '../rules.js';

// D1 de mentira: solo las consultas que hace el Worker
const rows = new Map(), cravings = new Map();
const CravingQ = (sql, args) => ({
  run: async () => /^DELETE/.test(sql) ? cravings.delete(`${args[0]}|${args[1]}`) : cravings.set(`${args[0]}|${args[1]}`, { after: args[0], groups: args[2] }),
  first: async () => (cravings.get(`${args[0]}|${args[1]}`) || {}).groups ?? null,
  all: async () => ({ results: [...cravings.values()].filter(c => c.after === args[0]) }),
});
const DB = {
  prepare: sql => {
    let args = [];
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
  if (/stores\.json/.test(url)) return Response.json({ rows: [{ group: 'Indio' }, { group: 'Poke' }, { group: 'Pizza' }, { group: 'Kebab' }] });
  return Response.json([winner(7, '2026-11-12'), winner(4, '2026-10-08')]);
};
const call = (method, path, token, body) => worker.fetch(new Request('https://w' + path, {
  method, headers: token ? { Authorization: 'Bearer ' + token } : {}, body: body && JSON.stringify(body) }), { DB });

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

test('pizarra: hasta 3 cocinas del bombo, un voto por persona que se puede cambiar o borrar, solo para el próximo sorteo', async () => {
  assert.equal((await call('POST', '/craving', 'gmail', { after: 7, groups: ['Indio'] })).status, 401);
  assert.equal((await call('POST', '/craving', 'ana', { after: 4, groups: ['Indio'] })).status, 409);    // pizarra de un sorteo pasado
  assert.equal((await call('POST', '/craving', 'ana', { after: 7, groups: ['Indio', 'Poke', 'Pizza', 'Kebab'] })).status, 400);  // más de 3
  assert.equal((await call('POST', '/craving', 'ana', { after: 7, groups: ['Fondue'] })).status, 400);   // no es una cocina del bombo

  assert.deepEqual(await (await call('GET', '/craving', 'ana')).json(), { after: 7, mine: null, counts: null });
  await call('POST', '/craving', 'ana', { after: 7, groups: ['Indio', 'Indio', 'Poke'] });             // repetidas cuentan una vez
  await call('POST', '/craving', 'bea', { after: 7, groups: ['Indio'] });
  assert.deepEqual(await (await call('POST', '/craving', 'ana', { after: 7, groups: ['Indio', 'Pizza'] })).json(),
    { after: 7, mine: ['Indio', 'Pizza'], counts: { Indio: 2, Pizza: 1 } });                             // cambia su voto
  assert.deepEqual(await (await call('GET', '/cravings')).json(), { after: 7, counts: { Indio: 2, Pizza: 1 } });
  await call('POST', '/craving', 'bea', { after: 7, groups: [] });                                        // lista vacía: borra
  assert.deepEqual(await (await call('GET', '/cravings')).json(), { after: 7, counts: { Indio: 1, Pizza: 1 } });
});
