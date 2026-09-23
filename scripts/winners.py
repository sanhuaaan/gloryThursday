#!/usr/bin/env python3
"""Copia de los ganadores (issues abiertos con línea "tienda:") en data/winners.json.

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
winners = [{"number": i["number"], "body": i["body"], "created_at": i["created_at"], "html_url": i["html_url"],
            "user": {"login": i["user"]["login"], "avatar_url": i["user"]["avatar_url"]}}
           for i in issues if "pull_request" not in i and re.search(r"^\s*tienda:", i.get("body") or "", re.M)]
winners.sort(key=lambda w: -w["number"])
(ROOT / "data/winners.json").write_text(json.dumps(winners, ensure_ascii=False, indent=1) + "\n")
print(f"{len(winners)} ganadores")
