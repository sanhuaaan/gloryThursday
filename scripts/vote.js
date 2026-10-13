#!/usr/bin/env node
// Aviso a Google Chat para votar qué tal el último ganador: el día del sorteo, a partir de las 15:00 de Madrid.
//
// Uso: CHAT_WEBHOOK=... node scripts/vote.js [--force] [--dry-run]
// Solo avisa una vez por sorteo (data/poll.json guarda el último issue avisado). --force salta la comprobación de día y hora,
// pero no repite un sorteo ya avisado. --dry-run imprime sin enviar.
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { parseWinners, MIN_VOTES, VOTE_API } from '../rules.js';

const PAGE = 'https://sanhuaaan.github.io/gloryThursday/votar.html';
const ROOT = new URL('..', import.meta.url);
const args = process.argv.slice(2);
const read = (f, fallback) => existsSync(new URL(f, ROOT)) ? JSON.parse(readFileSync(new URL(f, ROOT), 'utf8')) : fallback;

if (!VOTE_API) { console.log('La votación aún no está montada (VOTE_API en rules.js); nada que enviar'); process.exit(0); }
const [w] = parseWinners(read('data/winners.json', []));
if (!w) { console.log('Aún no hay ganadores'); process.exit(0); }
if (!args.includes('--dry-run') && read('data/poll.json', {}).lastPolled === w.number) {
  console.log(`El sorteo ${w.number} ya tiene su votación; nada que hacer`);
  process.exit(0);
}
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
const hour = +new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: 'numeric', hourCycle: 'h23' }).format(new Date());
if (!args.includes('--force') && !(w.date === today && hour >= 15)) {
  console.log(`Último sorteo del ${w.date}; la votación sale ese día desde las 15:00`);
  process.exit(0);
}

const name = (read('data/stores.json').rows.find(r => r.slug === w.slug) || { name: w.slug }).name;
const url = `${PAGE}?sorteo=${w.number}`;
const text = [
  '⭐ *GUÍA DEL JUEVES DE GLORIA · SE BUSCAN INSPECTORES*',
  `La redacción necesita vuestro dictamen sobre *${name}*.`,
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
