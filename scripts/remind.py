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
COOLDOWN, PENALTY = 6, [(2, 0.25), (4, 0.5), (6, 0.75)]  # mismas reglas que index.html
FRAC = {0.25: "¼", 0.5: "½", 0.75: "¾"}
MONTHS = "enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre".split()

os.environ["TZ"] = "Europe/Madrid"
time.tzset()
today = date.today()
if "--force" not in sys.argv and not (today.weekday() == 2 and 7 <= today.day <= 13):
    print(f"{today}: no es el miércoles anterior al segundo jueves; nada que enviar")
    sys.exit(0)

data = json.loads((ROOT / "data/stores.json").read_text())
rows = {r["slug"]: r for r in data["rows"]}
issues = json.loads((ROOT / "data/winners.json").read_text())  # copia que mantiene scripts/winners.py
winners = []
for i in issues:
    m = re.search(r"^\s*tienda:\s*(\S+)", i.get("body") or "", re.M)
    if not m or "pull_request" in i:
        continue
    d = re.search(r"^\s*fecha:\s*(\d{4}-\d{2}-\d{2})", i["body"], re.M)
    winners.append((d.group(1) if d else i["created_at"][:10], m.group(1), i["number"]))
winners.sort(reverse=True)
latest = max((n for _, _, n in winners), default=0)


def fmt(iso):
    d = date.fromisoformat(iso)
    return f"{d.day} de {MONTHS[d.month - 1]}"


def name(slug):
    return rows[slug]["name"] if slug in rows else slug


last_by_group = {}
for i, (_, s, _) in enumerate(winners):
    if s in rows:
        last_by_group.setdefault(rows[s]["group"], i)  # sorteos registrados desde que ganó


def penalty(g):
    i = last_by_group.get(g)
    return 1 if i is None else next((w for lim, w in PENALTY if i < lim), 1)


def extra_balls_line():
    """Bolas extra vigentes y probabilidad real de cada cocina con bolas (penalización y cuarentena incluidas)."""
    path = ROOT / "data/balls.json"
    extra = json.loads(path.read_text()) if path.exists() else {}
    balls, stores = extra.get("balls") or {}, extra.get("stores") or {}
    if not balls or extra.get("mTo") != latest:
        return []
    quarantined = {s for _, s, _ in winners[:COOLDOWN]}
    groups = {r["group"] for s, r in rows.items() if s not in quarantined}
    weight = {g: penalty(g) * (1 + balls.get(g, 0)) for g in groups}
    total = sum(weight.values())
    parts = [f"{g} +{n} (sale el {round(100 * weight[g] / total)} %)" for g, n in sorted(balls.items(), key=lambda x: -x[1]) if g in weight]
    out = ["Bolas extra para este sorteo: " + ", ".join(parts) + "."] if parts else []
    for g in sorted(balls):
        inside = [f"{rows[s]['name']} +{n}" for s, n in stores.items() if s in rows and rows[s]["group"] == g]
        if inside:
            out.append(f"Dentro de {g}: " + ", ".join(inside) + ".")
    return out


lines = ["*Mañana es Jueves de Gloria* 🍽️", ""]
if winners:
    lines.append(f"Última vez salió *{name(winners[0][1])}* ({fmt(winners[0][0])}).")
    quarantine = [name(s) for _, s, _ in winners[:COOLDOWN]]
    lines.append("En cuarentena: " + ", ".join(quarantine) + ".")
    penalised = [f"{g} ×{FRAC[penalty(g)]}" for g in sorted(last_by_group) if penalty(g) < 1]
    if penalised:
        lines.append("Cocinas penalizadas: " + ", ".join(penalised) + ".")
else:
    lines.append("Todavía no hay ganadores registrados: bombo limpio.")
extra = extra_balls_line()
if extra:
    lines += [""] + extra
lines += ["", f"Bombo: {PAGE}"]
text = "\n".join(lines)

if "--dry-run" in sys.argv:
    print(text)
    sys.exit()
url = os.environ.get("CHAT_WEBHOOK") or sys.exit("Falta CHAT_WEBHOOK")
req = urllib.request.Request(url, data=json.dumps({"text": text}).encode(), headers={"Content-Type": "application/json; charset=UTF-8"})
with urllib.request.urlopen(req) as r:
    print("enviado:", r.status)
