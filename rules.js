// Reglas del Jueves de Gloria, en un solo sitio. Las usan el bombo (index.html), la trastienda (trastienda.html)
// y el recordatorio del chat (scripts/remind.js). Los pesos por promo y por nota solo los usa el bombo y viven allí.

export const COOLDOWN = 6;                                  // sorteos de cuarentena para el sitio ganador
export const PENALTY = [[2, 0.25], [4, 0.5], [6, 0.75]];    // [sorteos desde que ganó la cocina < límite, peso]

// Un sorteo cuenta solo si el issue lleva la etiqueta "ganador". El flujo de ganadores (.github/workflows/winners.yml) se la
// pone a cualquier issue con línea "tienda:", lo abra quien lo abra; quitarla o cerrar el issue deja el sorteo fuera.
// Las etiquetas llegan como objetos (API de GitHub) o como nombres (data/winners.json).
export const LABEL = 'ganador';
const isWinner = i => !i.pull_request && /^\s*tienda:/m.test(i.body || '') && (i.labels || []).some(l => (l.name || l) === LABEL);

// Número del último issue de ganador (0 si no hay): marca el sorteo para el que valen las bolas extra.
export const latestRaffle = issues => issues.filter(isWinner).reduce((a, i) => Math.max(a, i.number), 0);

// Issues abiertos → ganadores, el más reciente primero. La fecha sale de la línea "fecha:" o, si no, de cuándo se abrió.
export function parseWinners(issues) {
  return issues.filter(isWinner).map(i => ({
    slug: (i.body.match(/^\s*tienda:\s*(\S+)/m) || [])[1],
    date: (i.body.match(/^\s*fecha:\s*(\d{4}-\d{2}-\d{2})/m) || [])[1] || i.created_at.slice(0, 10),
    number: i.number, user: i.user.login, avatar: i.user.avatar_url, url: i.html_url,
  })).sort((a, b) => b.date.localeCompare(a.date) || b.number - a.number);
}

// Cuarentena de sitios (slug → sorteos que le faltan) y, por cocina, cuántos sorteos han pasado desde que ganó y cuándo.
export function raffleState(winners, rows) {
  const quarantine = {}, lastIdx = {}, lastWin = {};
  winners.forEach((w, i) => {
    if (i < COOLDOWN && quarantine[w.slug] == null) quarantine[w.slug] = COOLDOWN - i;
    const row = rows.find(r => r.slug === w.slug);
    if (row && lastIdx[row.group] == null) { lastIdx[row.group] = i; lastWin[row.group] = w.date; }
  });
  return { quarantine, lastIdx, lastWin };
}

// Peso de una cocina según cuántos sorteos han pasado desde que ganó (undefined = nunca ganó).
export const penaltyWeight = idx => idx == null ? 1 : (PENALTY.find(([lim]) => idx < lim) || [0, 1])[1];

// Bolas extra vigentes: solo si se guardaron para el último sorteo registrado, y las de restaurante solo si su cocina lleva.
export function activeBalls(file, latest, rows) {
  const out = { balls: {}, stores: {} };
  if (!file || latest == null || file.mTo !== latest) return out;
  const ok = n => Number.isInteger(n) && n > 0 && n <= 9;
  Object.entries(file.balls || {}).forEach(([g, n]) => { if (ok(n)) out.balls[g] = n; });
  Object.entries(file.stores || {}).forEach(([slug, n]) => {
    const r = rows.find(x => x.slug === slug);
    if (r && out.balls[r.group] && ok(n)) out.stores[slug] = n;
  });
  return out;
}

// Interruptor del veredicto. En false ni se ve ni pesa en el bombo ni en el recordatorio.
export const VERDICTS_ENABLED = true;

// Veredicto de la oficina: sale de la votación del informe del inspector (votar.html), cuyo enlace llega al chat el jueves por la tarde
// (scripts/vote.js). data/votes.json trae los recuentos por sorteo, {nºissue: {repetir, aprobado, nifu, nuncamas}}, ya con
// un voto por persona. Pesa sobre el restaurante dentro de su cocina; si ha ganado varias veces, manda el sorteo más reciente.
export const VERDICTS = {
  repetir:  { label: '¡Repetiríamos!', weight: 1.25, score: 4 },
  aprobado: { label: 'Aprobado',       weight: 1,    score: 3 },
  nifu:     { label: 'Ni fu ni fa',    weight: 0.75, score: 2 },
  nuncamas: { label: 'Nunca más',      weight: 0.25, score: 1 },
};
export const MIN_VOTES = 3;   // con menos votos el sorteo no tiene veredicto: dos personas no hunden un sitio

// Recuentos → {nºissue: {verdict, votes}}: la media de puntos (4 a 1), redondeada, elige el veredicto.
export function votesToVerdicts(votes) {
  const out = {};
  Object.entries(votes || {}).forEach(([n, c]) => {
    const keys = Object.keys(VERDICTS), total = keys.reduce((a, k) => a + (c[k] || 0), 0);
    if (total < MIN_VOTES) return;
    const avg = Math.round(keys.reduce((a, k) => a + (c[k] || 0) * VERDICTS[k].score, 0) / total);
    out[n] = { verdict: keys.find(k => VERDICTS[k].score === avg), votes: total };
  });
  return out;
}
export function verdictsBySlug(winners, verdicts) {
  const out = {};
  winners.forEach(w => {   // winners va del más reciente al más antiguo
    const v = (verdicts || {})[w.number];
    if (v && VERDICTS[v.verdict] && !out[w.slug]) out[w.slug] = { key: v.verdict, ...VERDICTS[v.verdict], number: w.number };
  });
  return out;
}

// Peso de una cocina en la primera fase: penalización × tachones de la pizarra × (1 + bolas extra).
export const cuisineWeight = (group, lastIdx, balls, factor = {}) => penaltyWeight(lastIdx[group]) * (factor[group] || 1) * (1 + (balls[group] || 0));

// Votación: el Worker de Cloudflare (worker/) guarda los votos; solo entran cuentas de Google del dominio de la oficina.
export const VOTE_API = 'https://glory-votes.juevesdegloria.workers.dev';           // https://glory-votes.<cuenta>.workers.dev
export const GOOGLE_CLIENT_ID = '867747052313-5urh1tb1h3rhhrc7f2no4p2a2t6da2mk.apps.googleusercontent.com';   // ID de cliente OAuth (Google Cloud → Credenciales), tipo "Aplicación web"
export const VOTE_DOMAIN = 'xabet.net';

// Antojo de la oficina: entre un sorteo y el siguiente, cada persona tiene CRAVING_PICKS marcas en la pizarra (pizarra.html):
// rodear una cocina es un voto a favor y tacharla, uno en contra. Cuenta el neto (a favor − en contra) de cada cocina:
// cada CRAVING_PER_BALL de neto positivo da una bola extra (como mucho CRAVING_MAX) y el neto negativo baja su peso por
// tramos (CRAVING_DOWN), nunca a cero. data/cravings.json = {after: nº del último ganador, counts: {cocina: {up, down}}};
// caduca al registrar otro ganador.
export const CRAVING_PICKS = 3, CRAVING_PER_BALL = 3, CRAVING_MAX = 3;
export const CRAVING_DOWN = [[-9, 0.25], [-6, 0.5], [-3, 0.75]];   // [neto ≤ límite, peso]
const tally = c => typeof c === 'number' ? { up: c, down: 0 } : { up: (c && c.up) || 0, down: (c && c.down) || 0 };
export function cravingEffect(file, latest) {
  const balls = {}, factor = {};
  if (!file || latest == null || file.after !== latest) return { balls, factor };
  Object.entries(file.counts || {}).forEach(([g, c]) => {
    const { up, down } = tally(c), net = up - down;
    const b = Math.min(CRAVING_MAX, Math.floor(net / CRAVING_PER_BALL));
    if (b > 0) balls[g] = b;
    const f = (CRAVING_DOWN.find(([lim]) => net <= lim) || [0, 1])[1];
    if (f < 1) factor[g] = f;
  });
  return { balls, factor };
}
