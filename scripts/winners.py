#!/usr/bin/env python3
"""Copia de los ganadores (issues abiertos con línea "tienda:" y etiqueta "ganador") en data/winners.json.

Sirve de reserva al bombo y a la trastienda cuando la API de GitHub corta las lecturas anónimas (60/h por IP),
y de fuente para el recordatorio. En Actions usa GITHUB_TOKEN, que no tiene ese límite.
Si GitHub no responde, deja el fichero como estaba.
"""
import json, os, re, sys, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
token = os.environ.get("GITHUB_TOKEN")
req = urllib.request.Request("https://api.github.com/repos/sanhuaaan/gloryThursday/issues?state=open&per_page=100",
                             headers={"Accept": "application/vnd.github+json", **({"Authorization": f"Bearer {token}"} if token else {})})
try:
    with urllib.request.urlopen(req, timeout=20) as r:
        issues = json.load(r)
except Exception as e:
    print(f"No se pudo leer GitHub ({e}); winners.json sin cambios")
    sys.exit(0)
labels = lambda i: [l["name"] for l in i.get("labels") or []]
winners = [{"number": i["number"], "body": i["body"], "created_at": i["created_at"], "html_url": i["html_url"], "labels": labels(i),
            "user": {"login": i["user"]["login"], "avatar_url": i["user"]["avatar_url"]}}
           for i in issues if "pull_request" not in i and re.search(r"^\s*tienda:", i.get("body") or "", re.M)
           and "ganador" in labels(i)]  # misma regla que rules.js
winners.sort(key=lambda w: -w["number"])
(ROOT / "data/winners.json").write_text(json.dumps(winners, ensure_ascii=False, indent=1) + "\n")
print(f"{len(winners)} ganadores")

# Votos de la oficina: pestaña "votos" de la hoja del formulario, publicada en la web como CSV. Una fila por persona y sorteo
# (la fórmula de la hoja ya deja solo el último voto de cada uno), sin correos: "7 · Sushi Fuji","Aprobado".
# Se cuentan aquí → data/votes.json {nºissue: {repetir, aprobado, nifu, nuncamas}}.
VOTES_CSV = ""
OPTIONS = {"¡Repetiríamos!": "repetir", "Aprobado": "aprobado", "Ni fu ni fa": "nifu", "Nunca más": "nuncamas"}  # = VERDICTS de rules.js


def count_votes(text):
    import csv, io
    votes = {}
    for row in csv.reader(io.StringIO(text)):
        m, key = re.match(r"\s*(\d+)", row[0]) if row else None, OPTIONS.get(row[1].strip()) if len(row) > 1 else None
        if m and key:
            votes.setdefault(m[1], dict.fromkeys(OPTIONS.values(), 0))[key] += 1
    return votes


assert count_votes('7 · Sushi,Aprobado\n7 · Sushi,¡Repetiríamos!\n4 · Taj,Nunca más\nx,Aprobado\n#N/A\n9,Otra\n') == {
    "7": {"repetir": 1, "aprobado": 1, "nifu": 0, "nuncamas": 0}, "4": {"repetir": 0, "aprobado": 0, "nifu": 0, "nuncamas": 1}}
if VOTES_CSV:
    try:
        with urllib.request.urlopen(VOTES_CSV, timeout=20) as r:
            votes = count_votes(r.read().decode("utf-8"))
        (ROOT / "data/votes.json").write_text(json.dumps(votes, indent=1) + "\n")
        print(f"votos de {len(votes)} sorteos")
    except Exception as e:
        print(f"No se pudieron leer los votos ({e}); votes.json sin cambios")
