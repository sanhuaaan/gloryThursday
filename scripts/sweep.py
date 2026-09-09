#!/usr/bin/env python3
"""Barrido de Glovo: que tiendas reparten a unas coordenadas.

Uso: python3 scripts/sweep.py [lat] [lon]  (por defecto, la oficina de Zuatzu)
Lee data/slugs.txt y escribe data/stores.json con el formato que consume index.html.
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
EXOTIC = {"Asiática", "Japonesa", "Sushi", "Poke", "Tailandesa", "India", "Mexicana", "Latina", "Venezolana",
          "Árabe", "Kebab", "Internacional", "Alta Cocina", "Grill", "Gourmet", "Vegana", "Coreana"}
GROUPS = [("Japonés / sushi / ramen", {"Japonesa", "Sushi"}), ("Poke", {"Poke"}), ("Tailandés / chino", {"Tailandesa", "Asiática"}),
          ("Indio", {"India"}), ("Mexicano", {"Mexicana"}), ("Latino / venezolano", {"Latina", "Venezolana"}),
          ("Turco / árabe", {"Árabe", "Kebab"}), ("Alta cocina / grill", {"Alta Cocina", "Grill", "Gourmet"}),
          ("Internacional", {"Internacional"}), ("Hamburguesas", {"Hamburguesas", "Americana"}), ("Pizza / italiano", {"Pizza", "Italiana"}),
          ("Mediterráneo / español", {"Mediterránea", "Española", "Comida local"}), ("Pollo", {"Pollo"}),
          ("Saludable", {"Saludable", "Vegetariana", "Vegana"}), ("Bocadillos", {"Bocadillos"}),
          ("Dulce / café", {"Panadería", "Desayuno", "Dulces", "Helado", "Snacks", "Té y café", "Bebidas", "Brunch"})]


def fetch(slug):
    args = ["curl", "-s", "-w", "\n%{http_code}", "-A", "Mozilla/5.0"]
    for k, v in HEADERS.items():
        args += ["-H", f"{k}: {v}"]
    body, _, code = subprocess.run(args + [f"https://api.glovoapp.com/v3/stores/{slug}"],
                                   capture_output=True, text=True).stdout.rpartition("\n")
    return code, (json.loads(body) if code == "200" else None)


def group_of(filters):
    fs = set(filters)
    g = next((n for n, s in GROUPS if fs & s), "Otros")
    return "Japonés / sushi / ramen" if g == "Tailandés / chino" and fs & {"Japonesa", "Sushi"} else g


ok, excluded = [], []
for slug in (ROOT / "data/slugs.txt").read_text().split():
    code, d = fetch(slug)
    if code != "200":
        excluded.append(slug)
        continue
    av = d.get("availability") or {}
    filters = [f["displayName"] for f in d.get("filters") or []]
    rating = (d.get("ratingInfo") or {}).get("cardLabel")
    ok.append({"name": d["name"], "rating": rating if rating and rating.endswith("%") else None,
               "fee": (d.get("deliveryFeeInfo") or {}).get("fee"), "dist": d.get("distance"), "tags": filters[:3],
               "group": group_of(filters), "exotic": bool(set(filters) & EXOTIC), "status": av.get("status"),
               "when": (((av.get("footerLabel") or {}).get("data") or {}).get("text") or "").replace(" EAS", ""),
               "slug": slug})
    time.sleep(0.25)

ok.sort(key=lambda r: -int(r["rating"][:-1]) if r["rating"] else 1)
for i, r in enumerate(ok, 1):
    r["n"] = i
(ROOT / "data/stores.json").write_text(json.dumps({"rows": ok, "excluded": excluded}, ensure_ascii=False, indent=1))
print(f"{len(ok)} llegan, {len(excluded)} no")
