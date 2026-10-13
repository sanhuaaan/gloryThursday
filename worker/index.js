// Votos del informe del inspector (votar.html). Cloudflare Worker + D1.
//   GET  /counts              recuentos de todos los sorteos (público; lo copia scripts/winners.py a data/votes.json)
//   GET  /vote?sorteo=N       tu voto en ese sorteo y, si ya votaste, cómo va      (Authorization: Bearer <token de Google>)
//   POST /vote {sorteo, verdict}  vota o cambia el voto; solo en el último sorteo  (ídem)
// Despliegue: cd worker && npx wrangler@4 deploy   (esquema: npx wrangler@4 d1 execute glory-votes --remote --file schema.sql)
import { parseWinners, VERDICTS, GOOGLE_CLIENT_ID, VOTE_DOMAIN } from '../rules.js';

const WINNERS = 'https://sanhuaaan.github.io/gloryThursday/data/winners.json';
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
const openRaffle = async () => (parseWinners(await fetch(WINNERS, { cf: { cacheTtl: 60 } }).then(r => r.json()))[0] || {}).number;

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
