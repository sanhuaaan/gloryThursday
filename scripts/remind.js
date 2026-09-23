#!/usr/bin/env node
// Aviso a Google Chat el miércoles anterior al segundo jueves de mes.
//
// Uso: CHAT_WEBHOOK=... node scripts/remind.js [--force] [--dry-run]
// El segundo jueves cae entre el 8 y el 14, así que el miércoles anterior cae entre el 7 y el 13.
// --force salta la comprobación de fecha (pruebas y disparo manual). --dry-run imprime sin enviar.
import { existsSync, readFileSync } from 'fs';
import { COOLDOWN, latestRaffle, parseWinners, raffleState, penaltyWeight, activeBalls, cuisineWeight } from '../rules.js';

const ROOT = new URL('..', import.meta.url);
const PAGE = 'https://sanhuaaan.github.io/gloryThursday/';
const FRAC = { 0.25: '¼', 0.5: '½', 0.75: '¾' };
const args = process.argv.slice(2);
const read = (f, fallback) => existsSync(new URL(f, ROOT)) ? JSON.parse(readFileSync(new URL(f, ROOT), 'utf8')) : fallback;

const now = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Madrid', weekday: 'short', day: 'numeric' })
  .formatToParts(new Date()).map(p => [p.type, p.value]));
if (!args.includes('--force') && !(now.weekday === 'Wed' && +now.day >= 7 && +now.day <= 13)) {
  console.log('Hoy no es el miércoles anterior al segundo jueves; nada que enviar');
  process.exit(0);
}

const rows = read('data/stores.json').rows;
const issues = read('data/winners.json', []);           // copia que mantiene scripts/winners.py
const winners = parseWinners(issues);
const latest = latestRaffle(issues);
const { quarantine, lastIdx } = raffleState(winners, rows);
const name = slug => (rows.find(r => r.slug === slug) || { name: slug }).name;
const fmt = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString('es-ES', { day: 'numeric', month: 'long', timeZone: 'UTC' });

const lines = ['*Mañana es Jueves de Gloria* 🍽️', ''];
if (winners.length) {
  lines.push(`Última vez salió *${name(winners[0].slug)}* (${fmt(winners[0].date)}).`);
  lines.push('En cuarentena: ' + winners.slice(0, COOLDOWN).map(w => name(w.slug)).join(', ') + '.');
  const penalised = Object.keys(lastIdx).sort().filter(g => penaltyWeight(lastIdx[g]) < 1).map(g => `${g} ×${FRAC[penaltyWeight(lastIdx[g])]}`);
  if (penalised.length) lines.push('Cocinas penalizadas: ' + penalised.join(', ') + '.');
} else {
  lines.push('Todavía no hay ganadores registrados: bombo limpio.');
}

// bolas extra vigentes, con la probabilidad real de cada cocina (penalización, bolas y cuarentena incluidas)
const { balls, stores } = activeBalls(read('data/balls.json', {}), latest, rows);
if (Object.keys(balls).length) {
  const groups = [...new Set(rows.filter(r => quarantine[r.slug] == null).map(r => r.group))];
  const total = groups.reduce((a, g) => a + cuisineWeight(g, lastIdx, balls), 0);
  const parts = Object.entries(balls).sort((a, b) => b[1] - a[1]).filter(([g]) => groups.includes(g))
    .map(([g, n]) => `${g} +${n} (sale el ${Math.round(100 * cuisineWeight(g, lastIdx, balls) / total)} %)`);
  lines.push('');
  if (parts.length) lines.push('Bolas extra para este sorteo: ' + parts.join(', ') + '.');
  Object.keys(balls).sort().forEach(g => {
    const inside = Object.entries(stores).filter(([s]) => (rows.find(r => r.slug === s) || {}).group === g).map(([s, n]) => `${name(s)} +${n}`);
    if (inside.length) lines.push(`Dentro de ${g}: ` + inside.join(', ') + '.');
  });
}
lines.push('', `Bombo: ${PAGE}`);
const text = lines.join('\n');

if (args.includes('--dry-run')) { console.log(text); process.exit(0); }
if (!process.env.CHAT_WEBHOOK) { console.error('Falta CHAT_WEBHOOK'); process.exit(1); }
const r = await fetch(process.env.CHAT_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify({ text }) });
console.log('enviado:', r.status);
if (!r.ok) process.exit(1);
