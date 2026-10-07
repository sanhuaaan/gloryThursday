#!/usr/bin/env node
// Aviso a Google Chat el miércoles anterior al segundo jueves de mes.
//
// Uso: CHAT_WEBHOOK=... node scripts/remind.js [--force] [--dry-run]
// El segundo jueves cae entre el 8 y el 14, así que el miércoles anterior cae entre el 7 y el 13.
// --force salta la comprobación de fecha (pruebas y disparo manual). --dry-run imprime sin enviar.
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { COOLDOWN, latestRaffle, parseWinners, raffleState, penaltyWeight, activeBalls, cuisineWeight, VERDICTS, VERDICTS_ENABLED } from '../rules.js';

const ROOT = new URL('..', import.meta.url);
const PAGE = 'https://sanhuaaan.github.io/gloryThursday/';
const FRAC = { 0.25: '¼', 0.5: '½', 0.75: '¾' };
const args = process.argv.slice(2);
const read = (f, fallback) => existsSync(new URL(f, ROOT)) ? JSON.parse(readFileSync(new URL(f, ROOT), 'utf8')) : fallback;

// fecha de hoy en Madrid (AAAA-MM-DD): marca de "ya enviado" en data/reminder.json para no avisar dos veces el mismo día
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
if (!args.includes('--dry-run') && read('data/reminder.json', {}).lastSent === today) {
  console.log(`El aviso de hoy (${today}) ya se envió; nada que hacer`);
  process.exit(0);
}
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

// veredictos y bolas extra viven en el repo gloryThursday-extraBalls; si no se pueden leer, el aviso sale sin ellos
const extraRepo = f => fetch(`https://sanhuaaan.github.io/gloryThursday-extraBalls/${f}?t=${Date.now()}`).then(r => r.ok ? r.json() : {}).catch(() => ({}));
const verdicts = VERDICTS_ENABLED ? await extraRepo('verdicts.json') : {};

// El parte de la tómbola: formato elegido el 2026-10-07. Toda la información del aviso clásico, en boletín oficial.
const inDrum = rows.filter(r => quarantine[r.slug] == null);
const nGroups = new Set(inDrum.map(r => r.group)).size;
const low = g => g.toLowerCase().replace(/\s*\/\s*/g, '/');
const fmtShort = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' });

const lines = [
  `🎟️ *TÓMBOLA ANTOJITOS · PARTE OFICIAL Nº ${winners.length + 1}*`,
  `_Función de mañana, jueves · ${nGroups} cocinas · ${inDrum.length} bolas_`,
  '',
];
if (winners.length) {
  const v = VERDICTS[(verdicts[winners[0].number] || {}).verdict];
  lines.push(`🏆 *Última agraciada:* ${name(winners[0].slug)} (${fmtShort(winners[0].date)})${v ? ` · ${v.label}` : ''}`);
  lines.push('🚫 *En el camerino:* ' + winners.slice(0, COOLDOWN)
    .map((w, i) => `${name(w.slug)} (${i === 0 ? `vuelve en ${quarantine[w.slug]} sorteos` : `en ${quarantine[w.slug]}`})`).join(' · '));
  const penalised = Object.keys(lastIdx).sort().filter(g => penaltyWeight(lastIdx[g]) < 1)
    .map(g => `${low(g)} ×${FRAC[penaltyWeight(lastIdx[g])]}`);
  if (penalised.length) lines.push('⚖️ *Cocinas sancionadas:* ' + penalised.join(' · '));
} else {
  lines.push('🏆 *Última agraciada:* ninguna todavía — bombo limpio, todo por estrenar');
}

// bolas extra vigentes, con la probabilidad real de cada cocina (penalización, bolas y cuarentena incluidas)
const { balls, stores } = activeBalls(await extraRepo('balls.json'), latest, rows);
const groups = [...new Set(inDrum.map(r => r.group))];
const total = groups.reduce((a, g) => a + cuisineWeight(g, lastIdx, balls), 0);
const parts = Object.entries(balls).sort((a, b) => b[1] - a[1]).filter(([g]) => groups.includes(g)).map(([g, n]) => {
  const inside = Object.entries(stores).filter(([s]) => (rows.find(r => r.slug === s) || {}).group === g).map(([s, k]) => `${name(s)} +${k}`);
  return `${g} +${n} (sale el ${Math.round(100 * cuisineWeight(g, lastIdx, balls) / total)} %)${inside.length ? ` — dentro, ${inside.join(', ')}` : ''}`;
});
if (parts.length) lines.push('🎱 *Bolas extra en juego:* ' + parts.join(' · '));

lines.push('', '_El bombo no admite reclamaciones. Firmado: la Dirección._', `👉 ${PAGE}`);
const text = lines.join('\n');

if (args.includes('--dry-run')) { console.log(text); process.exit(0); }
if (!process.env.CHAT_WEBHOOK) { console.error('Falta CHAT_WEBHOOK'); process.exit(1); }
const r = await fetch(process.env.CHAT_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify({ text }) });
console.log('enviado:', r.status);
if (!r.ok) process.exit(1);
writeFileSync(new URL('data/reminder.json', ROOT), JSON.stringify({ lastSent: today }, null, 1) + '\n');
