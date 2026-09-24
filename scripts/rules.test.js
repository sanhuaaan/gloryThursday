// Prueba de las reglas del sorteo: node --test scripts/rules.test.js (también la lanza GitHub al cambiar rules.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COOLDOWN, latestRaffle, parseWinners, raffleState, penaltyWeight, activeBalls, cuisineWeight, verdictsBySlug } from '../rules.js';

const issue = (number, slug, { fecha, labels = ['ganador'], created = '2026-01-01T10:00:00Z', pr = false } = {}) => ({
  number, created_at: created, html_url: `u${number}`, user: { login: 'x', avatar_url: 'a' }, labels,
  body: `tienda: ${slug}\n${fecha ? `fecha: ${fecha}\n` : ''}`, ...(pr ? { pull_request: {} } : {}),
});
const rows = [
  { slug: 'sushi', group: 'Japonés' }, { slug: 'ramen', group: 'Japonés' },
  { slug: 'nalu', group: 'Poke' }, { slug: 'taj', group: 'Indio' },
];

test('solo cuentan los issues con la etiqueta ganador (objeto o nombre), ni PR ni issues sin etiqueta', () => {
  const list = [issue(1, 'sushi', { labels: [{ name: 'ganador' }] }), issue(2, 'nalu', { labels: [] }),
    issue(3, 'taj', { pr: true }), issue(4, 'ramen')];
  assert.deepEqual(parseWinners(list).map(w => w.slug).sort(), ['ramen', 'sushi']);
  assert.equal(latestRaffle(list), 4);
  assert.equal(latestRaffle([issue(9, 'taj', { labels: [] })]), 0);
});

test('la fecha sale de "fecha:" o, si no, de cuándo se abrió; el más reciente primero', () => {
  const w = parseWinners([issue(1, 'sushi', { fecha: '2026-03-05' }), issue(2, 'nalu', { created: '2026-04-01T09:00:00Z' })]);
  assert.deepEqual(w.map(x => [x.slug, x.date]), [['nalu', '2026-04-01'], ['sushi', '2026-03-05']]);
});

test('cuarentena de 6 sorteos para el sitio y penalización por cocina desde su último triunfo', () => {
  const winners = Array.from({ length: 7 }, (_, i) => ({ slug: ['sushi', 'nalu', 'taj', 'ramen', 'nalu', 'taj', 'sushi'][i], date: `2026-0${9 - i}-01` }));
  const { quarantine, lastIdx } = raffleState(winners, rows);
  assert.equal(COOLDOWN, 6);
  assert.deepEqual(quarantine, { sushi: 6, nalu: 5, taj: 4, ramen: 3 });   // el séptimo (sushi otra vez) ya no cuenta
  assert.deepEqual(lastIdx, { Japonés: 0, Poke: 1, Indio: 2 });
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 12, undefined].map(penaltyWeight), [0.25, 0.25, 0.5, 0.5, 0.75, 0.75, 1, 1, 1]);
});

test('bolas extra: solo para el último sorteo, de 1 a 9, y las de restaurante solo si su cocina lleva', () => {
  const file = { mTo: 7, balls: { Poke: 2, Indio: 0, Pizza: 12 }, stores: { nalu: 1, taj: 3, sushi: 2, fantasma: 1 } };
  assert.deepEqual(activeBalls(file, 7, rows), { balls: { Poke: 2 }, stores: { nalu: 1 } });
  assert.deepEqual(activeBalls(file, 8, rows), { balls: {}, stores: {} });      // ya hubo otro sorteo: caducadas
  assert.deepEqual(activeBalls(file, null, rows), { balls: {}, stores: {} });   // sin ganadores cargados: nada
  assert.equal(cuisineWeight('Poke', { Poke: 0 }, { Poke: 2 }), 0.75);         // ¼ de penalización × 3 bolas
  assert.equal(cuisineWeight('Indio', {}, {}), 1);
});

test('veredicto de la mesa: pesa el del sorteo más reciente de cada sitio; los desconocidos se ignoran', () => {
  const winners = [{ slug: 'nalu', number: 9 }, { slug: 'taj', number: 8 }, { slug: 'nalu', number: 5 }, { slug: 'sushi', number: 4 }];
  const v = verdictsBySlug(winners, { 5: { verdict: 'nuncamas' }, 9: { verdict: 'repetir' }, 8: { verdict: 'inventado' }, 4: { verdict: 'nifu' } });
  assert.deepEqual(Object.fromEntries(Object.entries(v).map(([s, x]) => [s, x.weight])), { nalu: 1.25, sushi: 0.75 });
  assert.deepEqual(verdictsBySlug(winners, undefined), {});
});
