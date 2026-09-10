#!/usr/bin/env python3
"""Aviso a Google Chat el miércoles anterior al segundo jueves de mes.

Uso: CHAT_WEBHOOK=... python3 scripts/remind.py [--force] [--dry-run]
El segundo jueves cae entre el 8 y el 14, así que el miércoles anterior cae entre el 7 y el 13.
--force salta la comprobación de fecha (pruebas y disparo manual). --dry-run imprime sin enviar.
"""
import json, os, re, sys, time, urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPO = "sanhuaaan/gloryThursday"
PAGE = "https://sanhuaaan.github.io/gloryThursday/"
COOLDOWN, PENALTY = 6, [(2, "½"), (4, "¾")]  # mismas reglas que index.html
MONTHS = "enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre".split()

os.environ["TZ"] = "Europe/Madrid"
time.tzset()
today = date.today()
if "--force" not in sys.argv and not (today.weekday() == 2 and 7 <= today.day <= 13):
    print(f"{today}: no es el miércoles anterior al segundo jueves; nada que enviar")
    sys.exit(0)

rows = {r["slug"]: r for r in json.loads((ROOT / "data/stores.json").read_text())["rows"]}
with urllib.request.urlopen(f"https://api.github.com/repos/{REPO}/issues?state=open&per_page=100") as r:
    issues = json.load(r)
winners = []
for i in issues:
    m = re.search(r"^\s*tienda:\s*(\S+)", i.get("body") or "", re.M)
    if not m or "pull_request" in i:
        continue
    d = re.search(r"^\s*fecha:\s*(\d{4}-\d{2}-\d{2})", i["body"], re.M)
    winners.append((d.group(1) if d else i["created_at"][:10], m.group(1)))
winners.sort(reverse=True)


def fmt(iso):
    d = date.fromisoformat(iso)
    return f"{d.day} de {MONTHS[d.month - 1]}"


def name(slug):
    return rows[slug]["name"] if slug in rows else slug


lines = ["*Mañana es Jueves de Gloria* 🎱", ""]
if winners:
    lines.append(f"Última vez salió *{name(winners[0][1])}* ({fmt(winners[0][0])}).")
    quarantine = [name(s) for _, s in winners[:COOLDOWN]]
    lines.append("En cuarentena: " + ", ".join(quarantine) + ".")
    last_by_group = {}
    for d, s in winners:
        if s in rows:
            last_by_group.setdefault(rows[s]["group"], d)
    penalised = []
    for g, d in last_by_group.items():
        months = (today - date.fromisoformat(d)).days / 30.44
        w = next((w for lim, w in PENALTY if months < lim), None)
        if w:
            penalised.append(f"{g} ×{w}")
    if penalised:
        lines.append("Cocinas penalizadas: " + ", ".join(penalised) + ".")
else:
    lines.append("Todavía no hay ganadores registrados: bombo limpio.")
lines += ["", f"Bombo: {PAGE}"]
text = "\n".join(lines)

if "--dry-run" in sys.argv:
    print(text)
    sys.exit()
url = os.environ.get("CHAT_WEBHOOK") or sys.exit("Falta CHAT_WEBHOOK")
req = urllib.request.Request(url, data=json.dumps({"text": text}).encode(), headers={"Content-Type": "application/json; charset=UTF-8"})
with urllib.request.urlopen(req) as r:
    print("enviado:", r.status)
