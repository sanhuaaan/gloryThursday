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

# Recuentos de la votación (worker/, GET /counts) → data/votes.json {nºissue: {repetir, aprobado, nifu, nuncamas}},
# y antojo de la pizarra (GET /cravings) → data/cravings.json {after, counts: {cocina: votos}}.
# La dirección del Worker vive en rules.js (VOTE_API).
api = re.search(r"VOTE_API = '([^']*)'", (ROOT / "rules.js").read_text())[1]
if api:
    try:
        # Cloudflare rechaza (403) el User-Agent por defecto de Python
        for path, out in (("/counts", "votes.json"), ("/cravings", "cravings.json")):  # dictámenes y antojo de la pizarra
            with urllib.request.urlopen(urllib.request.Request(api + path, headers={"User-Agent": "gloryThursday-sweep"}), timeout=20) as r:
                (ROOT / "data" / out).write_text(json.dumps(json.load(r), ensure_ascii=False, indent=1) + "\n")
        print("votos y antojo copiados")
    except Exception as e:
        print(f"No se pudieron leer los votos ({e}); votes.json y cravings.json sin cambios")
