#!/usr/bin/env python3
"""Barrido de Glovo: que tiendas reparten a unas coordenadas.

Uso: python3 scripts/sweep.py [lat] [lon]  (por defecto, la oficina de Zuatzu)
Lee data/slugs.txt, escribe data/stores.json y lo inyecta en index.html (entre DATA-START y DATA-END).
Las tiendas fuera de zona devuelven 404 "No available store address found".
"""
import json, subprocess, sys, time, uuid
from pathlib import Path

LAT, LON = (sys.argv[1], sys.argv[2]) if len(sys.argv) > 2 else ("43.2970256", "-2.0050771")
ROOT = Path(__file__).resolve().parent.parent
TS = str(int(time.time() * 1000))
HEADERS = {
    "Accept": "application/json", "Origin": "https://glovoapp.com", "Referer": "https://glovoapp.com/",
    "Glovo-Perseus-Session-Id": str(uuid.uuid4()), "Glovo-Perseus-Client-Id": str(uuid.uuid4()),
    "Glovo-Perseus-Session-Timestamp": TS, "Glovo-Location-City-Code": "EAS", "Glovo-Location-Country-Code": "ES",
    "Glovo-Delivery-Location-Latitude": LAT, "Glovo-Delivery-Location-Longitude": LON,
    "Glovo-Delivery-Location-Timestamp": TS, "Glovo-Delivery-Location-Accuracy": "0",
    "Glovo-Api-Version": "14", "Glovo-App-Platform": "WEB", "Glovo-App-Type": "customer",
    "Glovo-Language-Code": "es", "Glovo-App-Version": "7",
}
GROUPS = [("Japonés / sushi / ramen", {"Japonesa", "Sushi"}), ("Poke", {"Poke"}), ("Tailandés / chino", {"Tailandesa", "Asiática"}),
          ("Indio", {"India"}), ("Mexicano", {"Mexicana"}), ("Latino / venezolano", {"Latina", "Venezolana"}),
          ("Turco / árabe", {"Árabe", "Kebab"}), ("Alta cocina / grill", {"Alta Cocina", "Grill", "Gourmet"}),
          ("Internacional", {"Internacional"}), ("Hamburguesas", {"Hamburguesas", "Americana"}), ("Pizza / italiano", {"Pizza", "Italiana"}),
          ("Mediterráneo / español", {"Mediterránea", "Española", "Comida local"}), ("Pollo", {"Pollo"}),
          ("Saludable", {"Saludable", "Vegetariana", "Vegana"}), ("Bocadillos", {"Bocadillos"}),
          ("Dulce / café", {"Panadería", "Desayuno", "Dulces", "Helado", "Snacks", "Té y café", "Bebidas", "Brunch"})]


OUT_OF_ZONE = "260002"  # Glovo: "No available store address found"


def fetch(slug):
    """Devuelve ("ok", datos), ("out", None) si no reparte aqui, o ("error", None) si Glovo no contesta bien."""
    args = ["curl", "-s", "-w", "\n%{http_code}", "-A", "Mozilla/5.0"]
    for k, v in HEADERS.items():
        args += ["-H", f"{k}: {v}"]
    for attempt in range(4):
        body, _, code = subprocess.run(args + [f"https://api.glovoapp.com/v3/stores/{slug}"],
                                       capture_output=True, text=True).stdout.rpartition("\n")
        if code == "200":
            return "ok", json.loads(body)
        if code == "404" and body.startswith("{") and json.loads(body).get("error", {}).get("code") == OUT_OF_ZONE:
            return "out", None
        print(f"  {slug}: HTTP {code}, reintento {attempt + 1}", file=sys.stderr)
        time.sleep(3 * (attempt + 1))  # ponytail: backoff lineal; Glovo corta tras ~100 peticiones seguidas desde IPs de GitHub
    return "error", None


EXOTIC_GROUPS = {"Japonés / sushi / ramen", "Poke", "Tailandés / chino", "Indio", "Mexicano", "Latino / venezolano",
                 "Turco / árabe", "Alta cocina / grill", "Internacional"}
GROUP_OVERRIDES = {"mumbai-curry-san-sebastian": "Indio"}  # Glovo lo etiqueta como árabe


def group_of(slug, filters):
    """Manda la primera etiqueta de Glovo que caiga en algún grupo (es la principal de la tienda)."""
    if slug in GROUP_OVERRIDES:
        return GROUP_OVERRIDES[slug]
    for f in filters:
        for name, tags in GROUPS:
            if f in tags:
                return name
    return "Otros"


OUT_FILE = ROOT / "data/stores.json"
previous = json.loads(OUT_FILE.read_text()) if OUT_FILE.exists() else {"rows": [], "excluded": []}
prev_rows = {r["slug"]: r for r in previous["rows"]}
ok, excluded, unknown = [], [], []
for slug in (ROOT / "data/slugs.txt").read_text().split():
    result, d = fetch(slug)
    if result == "out":
        excluded.append(slug)
        continue
    if result == "error":
        unknown.append(slug)
        if slug in prev_rows:
            ok.append(prev_rows[slug])
        elif slug in previous["excluded"]:
            excluded.append(slug)
        continue
    av = d.get("availability") or {}
    filters = [f["displayName"] for f in d.get("filters") or []]
    rating = (d.get("ratingInfo") or {}).get("cardLabel")
    ok.append({"name": d["name"], "rating": rating if rating and rating.endswith("%") else None,
               "fee": (d.get("deliveryFeeInfo") or {}).get("fee"), "dist": d.get("distance"), "tags": filters[:3],
               "group": group_of(slug, filters), "exotic": group_of(slug, filters) in EXOTIC_GROUPS, "status": av.get("status"),
               "when": (((av.get("footerLabel") or {}).get("data") or {}).get("text") or "").replace(" EAS", ""),
               "next": av.get("nextSchedulingOrOpeningTime"), "slug": slug})
    time.sleep(0.6)

if unknown:
    print(f"{len(unknown)} tiendas sin respuesta fiable, se conserva su dato anterior: {' '.join(unknown)}", file=sys.stderr)
if len(unknown) > 20:
    sys.exit("Demasiados errores; no se escribe nada")
ok.sort(key=lambda r: -int(r["rating"][:-1]) if r["rating"] else 1)
for i, r in enumerate(ok, 1):
    r["n"] = i
out = {"sweptAt": int(time.time() * 1000), "rows": ok, "excluded": excluded}
(ROOT / "data/stores.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
html = (ROOT / "index.html").read_text()
a, b = html.index("/*DATA-START*/"), html.index("/*DATA-END*/")
(ROOT / "index.html").write_text(html[:a] + "/*DATA-START*/const DATA=" + json.dumps(out, ensure_ascii=False) + ";" + html[b:])
print(f"{len(ok)} llegan, {len(excluded)} no")
