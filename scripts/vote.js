#!/usr/bin/env node
// Aviso a Google Chat para votar qué tal el último ganador: el día en que se registra, a partir de las 15:00 de Madrid.
//
// Uso: CHAT_WEBHOOK=... node scripts/vote.js [--wait] [--force] [--dry-run]
// Solo avisa una vez por sorteo (data/poll.json guarda el último issue avisado). --wait, si se registró hoy antes de las 15:00,
// espera hasta las 15:00 en vez de salir (lo usa vote.yml justo después de registrar un ganador). --force salta la comprobación
// de día y hora, pero no repite un sorteo ya avisado. --dry-run imprime sin enviar.
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { parseWinners, MIN_VOTES, VOTE_API } from '../rules.js';

const PAGE = 'https://sanhuaaan.github.io/gloryThursday/votar.html';
const ROOT = new URL('..', import.meta.url);
const args = process.argv.slice(2);
const read = (f, fallback) => existsSync(new URL(f, ROOT)) ? JSON.parse(readFileSync(new URL(f, ROOT), 'utf8')) : fallback;

if (!VOTE_API) { console.log('La votación aún no está montada (VOTE_API en rules.js); nada que enviar'); process.exit(0); }
const issues = read('data/winners.json', []);
const winners = parseWinners(issues), [w] = winners;
if (!w) { console.log('Aún no hay ganadores'); process.exit(0); }
if (!args.includes('--dry-run') && read('data/poll.json', {}).lastPolled === w.number) {
  console.log(`El sorteo ${w.number} ya tiene su votación; nada que hacer`);
  process.exit(0);
}
const madridDay = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(d);
const registered = madridDay(new Date(issues.find(i => i.number === w.number).created_at));
if (!args.includes('--force')) {
  if (registered !== madridDay(new Date())) {
    console.log(`El último ganador se registró el ${registered}; la votación sale ese mismo día`);
    process.exit(0);
  }
  // segundos que faltan para las 15:00 de Madrid
  const [h, m, sec] = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' })
    .format(new Date()).split(':').map(Number);
  const wait = (15 - h) * 3600 - m * 60 - sec;
  if (wait > 0) {
    // un trabajo de GitHub dura como mucho 6 h: si falta más, lo manda el cron de la tarde
    if (!args.includes('--wait') || wait > 5.5 * 3600) { console.log('La votación sale a las 15:00'); process.exit(0); }
    console.log(`Esperando ${Math.round(wait / 60)} min hasta las 15:00…`);
    await new Promise(r => setTimeout(r, wait * 1000));
  }
}

const name = (read('data/stores.json').rows.find(r => r.slug === w.slug) || { name: w.slug }).name;
const url = `${PAGE}?sorteo=${w.number}`;
const text = [
  `📰 *CRÍTICA GASTRONÓMICA · Nº ${winners.length}*`,
  `_Jueves de Gloria · hoy, a la mesa del inspector: ${name}_`,
  '',
  `La redacción ha comido en *${name}* y quiere vuestro dictamen antes de cerrar la edición:`,
  '★★★ ¡Repetiríamos! · ★★ Aprobado · ★ Ni fu ni fa · ⊘ Nunca más',
  `👉 ${url}`,
  '',
  `_Un voto por persona con la cuenta de la oficina, y se puede cambiar. Con ${MIN_VOTES} votos o más, el dictamen pesa en los próximos sorteos._`,
].join('\n');

if (args.includes('--dry-run')) { console.log(text); process.exit(0); }
if (!process.env.CHAT_WEBHOOK) { console.error('Falta CHAT_WEBHOOK'); process.exit(1); }
const r = await fetch(process.env.CHAT_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify({ text }) });
console.log('enviado:', r.status);
if (!r.ok) process.exit(1);
writeFileSync(new URL('data/poll.json', ROOT), JSON.stringify({ lastPolled: w.number }, null, 1) + '\n');
