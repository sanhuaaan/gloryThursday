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

// Veredicto de la mesa: lo estampa la trastienda sobre cada sorteo (verdicts.json del repo extraBalls, {nºissue: {verdict}}).
// Pesa sobre el restaurante dentro de su cocina; si ha ganado varias veces, manda el veredicto del sorteo más reciente.
export const VERDICTS = {
  repetir:  { label: '¡Repetiríamos!', weight: 1.25 },
  aprobado: { label: 'Aprobado',       weight: 1 },
  nifu:     { label: 'Ni fu ni fa',    weight: 0.75 },
  nuncamas: { label: 'Nunca más',      weight: 0.25 },
};
export function verdictsBySlug(winners, verdicts) {
  const out = {};
  winners.forEach(w => {   // winners va del más reciente al más antiguo
    const v = (verdicts || {})[w.number];
    if (v && VERDICTS[v.verdict] && !out[w.slug]) out[w.slug] = { key: v.verdict, ...VERDICTS[v.verdict], number: w.number };
  });
  return out;
}

// Peso de una cocina en la primera fase del sorteo: penalización × (1 + bolas extra).
export const cuisineWeight = (group, lastIdx, balls) => penaltyWeight(lastIdx[group]) * (1 + (balls[group] || 0));
