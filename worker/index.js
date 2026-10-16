// Votos del informe del inspector (votar.html). Cloudflare Worker + D1.
//   GET  /counts              recuentos de todos los sorteos (público; lo copia scripts/winners.py a data/votes.json)
//   GET  /vote?sorteo=N       tu voto en ese sorteo y, si ya votaste, cómo va      (Authorization: Bearer <token de Google>)
//   POST /vote {sorteo, verdict}  vota o cambia el voto; solo en el último sorteo  (ídem)
//   GET  /cravings            antojo de la oficina para el próximo sorteo: {after, counts} (público; lo copia winners.py)
//   GET  /craving             tus marcas en la pizarra y, si ya votaste, cómo va    (Authorization: Bearer …)
//   POST /craving {after, marks: {cocina: 1 | -1}}  hasta CRAVING_PICKS marcas, rodear (1) o tachar (-1); {} = borra  (ídem)
// Despliegue: cd worker && npx wrangler@4 deploy   (esquema: npx wrangler@4 d1 execute glory-votes --remote --file schema.sql)
import { parseWinners, latestRaffle, VERDICTS, CRAVING_PICKS, GOOGLE_CLIENT_ID, VOTE_DOMAIN } from '../rules.js';

const WINNERS = 'https://sanhuaaan.github.io/gloryThursday/data/winners.json';
const STORES = 'https://sanhuaaan.github.io/gloryThursday/data/stores.json';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

// quién vota: Google valida la firma del token; aquí, que sea para nuestra web y de una cuenta de la oficina
async function voter(req) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer /, '');
  if (!token) return null;
  const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token));  // ponytail: tokeninfo basta para ~20 votos al mes
  if (!r.ok) return null;
  const t = await r.json();
  if (t.aud !== GOOGLE_CLIENT_ID || t.email_verified !== 'true' || t.hd !== VOTE_DOMAIN) return null;
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t.email.toLowerCase()));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// solo se vota el último sorteo registrado
const winners = () => fetch(WINNERS, { cf: { cacheTtl: 60 } }).then(r => r.json());
const openRaffle = async () => (parseWinners(await winners())[0] || {}).number;
// el antojo vale para el sorteo siguiente al último ganador; las cocinas válidas son las del bombo
const cravingRound = async () => latestRaffle(await winners());
const cuisines = async () => new Set((await fetch(STORES, { cf: { cacheTtl: 300 } }).then(r => r.json())).rows.map(r => r.group));

// marcas guardadas como {cocina: 1 | -1}; las primeras versiones guardaban una lista de cocinas rodeadas
const marksOf = json => { const m = JSON.parse(json); return Array.isArray(m) ? Object.fromEntries(m.map(g => [g, 1])) : m; };

async function cravingCounts(db, after) {
  const counts = {};
  (await db.prepare('SELECT groups FROM cravings WHERE after_raffle = ?').bind(after).all()).results.forEach(({ groups }) =>
    Object.entries(marksOf(groups)).forEach(([g, v]) => { const c = counts[g] = counts[g] || { up: 0, down: 0 }; c[v > 0 ? 'up' : 'down']++; }));
  return counts;
}

async function craving(req, db, url) {
  const after = await cravingRound();
  if (url.pathname === '/cravings') return json({ after, counts: await cravingCounts(db, after) });
  const who = await voter(req);
  if (!who) return json({ error: `Entra con tu cuenta de ${VOTE_DOMAIN}` }, 401);
  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    if (body.after !== after) return json({ error: 'Esa pizarra ya se borró: ha habido otro sorteo', after }, 409);
    const marks = body.marks && typeof body.marks === 'object' && !Array.isArray(body.marks) ? body.marks : null;
    const valid = await cuisines(), entries = Object.entries(marks || {});
    if (!marks || entries.length > CRAVING_PICKS || entries.some(([g, v]) => !valid.has(g) || (v !== 1 && v !== -1)))
      return json({ error: `Hasta ${CRAVING_PICKS} marcas, rodeando o tachando cocinas del bombo` }, 400);
    if (entries.length) await db.prepare('INSERT INTO cravings (after_raffle, voter, groups, at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (after_raffle, voter) DO UPDATE SET groups = ?3, at = ?4')
      .bind(after, who, JSON.stringify(marks), new Date().toISOString()).run();
    else await db.prepare('DELETE FROM cravings WHERE after_raffle = ? AND voter = ?').bind(after, who).run();
  }
  const row = await db.prepare('SELECT groups FROM cravings WHERE after_raffle = ? AND voter = ?').bind(after, who).first('groups');
  const mine = row ? marksOf(row) : null;
  return json({ after, mine, counts: mine ? await cravingCounts(db, after) : null });
}

async function counts(db, raffle) {
  const q = raffle == null ? db.prepare('SELECT raffle, verdict, COUNT(*) n FROM votes GROUP BY raffle, verdict')
    : db.prepare('SELECT raffle, verdict, COUNT(*) n FROM votes WHERE raffle = ? GROUP BY raffle, verdict').bind(raffle);
  const out = {};
  (await q.all()).results.forEach(({ raffle: r, verdict, n }) => {
    out[r] = out[r] || Object.fromEntries(Object.keys(VERDICTS).map(k => [k, 0]));
    out[r][verdict] = n;
  });
  return out;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (url.pathname === '/counts') return json(await counts(env.DB));
    if (url.pathname === '/cravings' || url.pathname === '/craving') return craving(req, env.DB, url);
    if (url.pathname !== '/vote') return json({ error: 'no existe' }, 404);

    const who = await voter(req);
    if (!who) return json({ error: `Entra con tu cuenta de ${VOTE_DOMAIN}` }, 401);
    const open = await openRaffle();
    if (req.method === 'POST') {
      const { sorteo, verdict } = await req.json().catch(() => ({}));
      if (sorteo !== open) return json({ error: 'La votación de ese sorteo está cerrada', open }, 409);
      if (!VERDICTS[verdict]) return json({ error: 'Carta desconocida' }, 400);
      await env.DB.prepare('INSERT INTO votes (raffle, voter, verdict, at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (raffle, voter) DO UPDATE SET verdict = ?3, at = ?4')
        .bind(sorteo, who, verdict, new Date().toISOString()).run();
    }
    const sorteo = req.method === 'POST' ? open : +url.searchParams.get('sorteo');
    const mine = await env.DB.prepare('SELECT verdict FROM votes WHERE raffle = ? AND voter = ?').bind(sorteo, who).first('verdict');
    // el recuento solo se enseña a quien ya ha votado, para no condicionar
    return json({ open, mine, counts: mine ? (await counts(env.DB, sorteo))[sorteo] : null });
  },
};
