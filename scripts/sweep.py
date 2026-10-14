#!/usr/bin/env python3
"""Barrido de Glovo: que tiendas reparten a unas coordenadas.

Uso: python3 scripts/sweep.py [lat] [lon]  (por defecto, la oficina de Zuatzu)
Lee data/slugs.txt más las tiendas que aparezcan en los listados de Glovo, actualiza data/slugs.txt,
escribe data/stores.json (la página lo lee al abrirse).
Las tiendas fuera de zona devuelven 404 "No available store address found".
"""
import html, json, os, re, subprocess, sys, time, uuid
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
          ("Dulce / café", {"Panadería", "Desayuno", "Dulces", "Helado", "Snacks", "Té y café", "Bebidas", "Brunch"}),
          ("Saludable", {"Saludable", "Vegetariana", "Vegana"}), ("Bocadillos", {"Bocadillos"})]


OUT_OF_ZONE = "260002"  # Glovo: "No available store address found"
GONE = "108040"  # Glovo: "Store not found" (la tienda se ha dado de baja)


def fetch(slug):
    """Devuelve ("ok", datos), ("out", None) si no reparte aqui, ("gone", None) si ya no existe, o ("error", None) si Glovo no contesta bien."""
    args = ["curl", "-s", "-w", "\n%{http_code}", "-A", "Mozilla/5.0"]
    for k, v in HEADERS.items():
        args += ["-H", f"{k}: {v}"]
    for attempt in range(4):
        body, _, code = subprocess.run(args + [f"https://api.glovoapp.com/v3/stores/{slug}"],
                                       capture_output=True, text=True).stdout.rpartition("\n")
        if code == "200":
            return "ok", json.loads(body)
        err = json.loads(body).get("error", {}).get("code") if code == "404" and body.startswith("{") else None
        if err == OUT_OF_ZONE:
            return "out", None
        if err == GONE:
            return "gone", None
        print(f"  {slug}: HTTP {code}, reintento {attempt + 1}", file=sys.stderr)
        time.sleep(3 * (attempt + 1))  # ponytail: backoff lineal; Glovo corta tras ~100 peticiones seguidas desde IPs de GitHub
    return "error", None


EXOTIC_GROUPS = {"Japonés / sushi / ramen", "Poke", "Tailandés / chino", "Indio", "Mexicano", "Latino / venezolano",
                 "Turco / árabe", "Alta cocina / grill", "Internacional"}
GROUP_OVERRIDES = {"mumbai-curry-san-sebastian": "Indio"}  # Glovo lo etiqueta como árabe
LEFT_OUT_GROUPS = {"Dulce / café", "Bocadillos"}  # no son comida de mediodía o son grupos de un solo sitio
FRANCHISES = {  # grandes cadenas: reparten, pero no entran en el bombo
    "mcdonaldseas",  # McDonald's®,
    "burger-king-eas1",  # Burger King,
    "goiko-san-sebastian",  # Goiko,
    "vips-san-sebastian",  # VIPS,
    "vips-desayunos-san-sebastian",  # VIPS Desayunos,
    "telepizza-san-sebastian",  # Telepizza,
    "dominos-pizza-san-sebastian",  # Domino's Pizza,
    "papa-johns-donostia-san-sebastian",  # Papa Johns,
    "ginos-san-sebastian",  # Ginos,
    "la-tagliatella-eas",  # La Tagliatella,
    "starbucks-san-sebastian",  # Starbucks,
    "manolo-bakes-donostia-san-sebastian",  # Manolo Bakes
}


def group_of(slug, filters):
    """Manda el orden de GROUPS (lo específico primero), no el orden de etiquetas de Glovo."""
    if slug in GROUP_OVERRIDES:
        return GROUP_OVERRIDES[slug]
    fs = set(filters)
    return next((name for name, tags in GROUPS if fs & tags), "Otros")


CITY_URL = "https://glovoapp.com/es/es/donostia-san-sebastian"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"


def get_page(url):
    return subprocess.run(["curl", "-sL", "-A", UA, "-H", "Accept-Language: es-ES", url], capture_output=True, text=True).stdout


def fetch_listings():
    """Tiendas de Donostia y su etiqueta de promo ("2x1 en algunos productos"), sacadas de los listados por cocina.

    Son páginas de glovoapp.com, no de la API; una página que falle simplemente no aporta tiendas ni etiquetas.
    """
    main = get_page(f"{CITY_URL}/restaurantes_1/")
    types = sorted(set(re.findall(r"categories/comida_1\?type=([a-z0-9-]+_\d+)", main)))
    promos, slugs = {}, set()
    for t in types:
        page = get_page(f"{CITY_URL}/categories/comida_1?type={t}")
        for m in re.finditer(r'href="/es/es/donostia-san-sebastian/stores/([a-z0-9-]+)"', page):
            slugs.add(m.group(1))
            text = html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "|", page[m.end():m.end() + 6000])))
            first = next((p.strip() for p in text.split("|") if p.strip() and not p.strip().startswith(("<", ">"))), "")
            if re.search(r"2x1|3x2|%|gratis|€", first, re.I) and not re.fullmatch(r"\d+%", first):
                promos.setdefault(m.group(1), first)
        time.sleep(0.3)
    slugs = {s for s in slugs if not re.fullmatch(r"[0-9a-f]{64}", s)}  # tarjetas sin dirección pública
    print(f"{len(types)} listados leídos, {len(slugs)} tiendas, {len(promos)} con promo")
    return promos, slugs


OUT_FILE = ROOT / "data/stores.json"
previous = json.loads(OUT_FILE.read_text()) if OUT_FILE.exists() else {"rows": [], "excluded": []}
prev_rows = {r["slug"]: r for r in previous["rows"]}
promos, listed = fetch_listings()
SLUGS_FILE = ROOT / "data/slugs.txt"
known = set(SLUGS_FILE.read_text().split())
new = sorted(listed - known)
if new:
    print(f"{len(new)} tiendas nuevas en Glovo: {' '.join(new)}")
ok, excluded, unknown, left_out, gone = [], [], [], [], []
for slug in sorted(known | listed):
    result, d = fetch(slug)
    if result == "gone":
        gone.append(slug)
        continue
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
    if slug in FRANCHISES or group_of(slug, [f["displayName"] for f in d.get("filters") or []]) in LEFT_OUT_GROUPS:
        left_out.append(d["name"])
        continue
    av = d.get("availability") or {}
    filters = [f["displayName"] for f in d.get("filters") or []]
    ri = d.get("ratingInfo") or {}
    rating = ri.get("cardLabel")
    ok.append({"name": d["name"], "rating": rating if rating and rating.endswith("%") else None,
               "rv": ri.get("ratingValue"), "rc": ri.get("ratingCount") or 0,
               "fee": (d.get("deliveryFeeInfo") or {}).get("fee"), "dist": d.get("distance"), "tags": filters[:3],
               "group": group_of(slug, filters), "exotic": group_of(slug, filters) in EXOTIC_GROUPS, "status": av.get("status"),
               "when": (((av.get("footerLabel") or {}).get("data") or {}).get("text") or "").replace(" EAS", ""),
               "next": av.get("nextSchedulingOrOpeningTime"), "slug": slug})
    time.sleep(0.6)

if unknown:
    print(f"{len(unknown)} tiendas sin respuesta fiable, se conserva su dato anterior: {' '.join(unknown)}", file=sys.stderr)
if len(unknown) > 20:
    sys.exit("Demasiados errores; no se escribe nada")
if gone:
    print(f"{len(gone)} tiendas dadas de baja, se quitan de la lista: {' '.join(gone)}")
SLUGS_FILE.write_text("\n".join(sorted((known | listed) - set(gone))) + "\n")
for r in ok:
    r["promo"] = promos.get(r["slug"])

# --- Just Eat: los sitios que Glovo no trae a Zuatzu (no están en Glovo o están pero no llegan) ---
# Su API pública busca por código postal; la zona de reparto la calcula con el centro del 20018, a ~700 m de la oficina.
os.environ["TZ"] = "Europe/Madrid"; time.tzset()  # Just Eat da horas locales sin zona
JE_API = "https://rest.api.eu-central-1.production.jet-external.com/discovery/es/restaurants/enriched/bypostcode/20018"
JE_TAGS = {  # cocinas de Just Eat → etiquetas de Glovo, para caer en los mismos grupos (GROUPS)
    "Japonesa": "Japonesa", "Sushi": "Sushi", "Poke": "Poke", "Hawaiana": "Poke", "Tailandesa": "Tailandesa",
    "China": "Asiática", "Oriental": "Asiática", "Vietnamita": "Asiática", "Coreana": "Asiática", "India": "India",
    "Mexicana": "Mexicana", "Tex-Mex": "Mexicana", "Venezolana": "Venezolana", "Argentina": "Latina", "Sudamericana": "Latina",
    "Kebab": "Kebab", "Turca": "Árabe", "Medio Oriental": "Árabe", "Shawarma": "Árabe",
    "Hamburguesas": "Hamburguesas", "Americana": "Americana", "Pizza": "Pizza", "Italiana": "Italiana",
    "Mediterránea": "Mediterránea", "Española": "Española", "Tapas": "Española", "Casera": "Española", "Arroceria": "Española",
    "Vasca": "Comida local", "Pollo": "Pollo", "Bocadillos": "Bocadillos", "Sandwiches": "Bocadillos",
    "Dulces": "Dulces", "Merienda": "Dulces", "Repostería": "Dulces", "Heladería": "Helado", "Desayuno": "Desayuno", "Bakery": "Panadería",
}
JE_FRANCHISES = re.compile(r"mcdonald|burger king|kfc|taco bell|popeyes|starbucks|domino|vips|telepizza|goiko|papa john|tagliatella|ginos|foster", re.I)
JE_DEALS = {"Bogof", "Percent", "ItemLevelDiscount", "FreeDelivery"}  # las que son descuento de verdad (no avisos ni tarjetas de sellos)


def norm(s):
    s = re.sub(r"[\u0300-\u036f]", "", __import__("unicodedata").normalize("NFKD", s.lower()))
    s = re.sub(r"\b(restaurante|restaurant|bar|the|la|el|los|de|donostia|san|sebastian|espana|eas\d*)\b", " ", s.replace("-", " "))
    return re.sub(r"[^a-z0-9]", "", s)


def same_place(a, names):
    # ponytail: nombre normalizado contenido en el otro; si un día empareja mal, va una lista de excepciones a mano
    a = norm(a)
    return any(len(a) >= 4 and len(b) >= 4 and (a in b or b in a) for b in map(norm, names))


def je_row(x, tags):
    km, av = x["driveDistanceMeters"] / 1000, x["availability"]["delivery"]
    rt = x["rating"] if x["rating"].get("starRating") else {}  # 0 estrellas = sin nota
    deal = next((d["description"] for d in x.get("deals") or [] if d.get("offerType") in JE_DEALS and d.get("description")), None)
    nxt = (av.get("nextAvailability") or {}).get("from")
    group = group_of("", tags)
    return {"name": x["name"].strip(), "src": "je", "url": f"https://www.just-eat.es/restaurants-{x['uniqueName']}/menu",
            "rating": f"{rt['starRating']:.1f}★".replace(".", ",") if rt.get("count") else None,
            # ponytail: estrellas → escala de Glovo con las mismas bandas del bombo (4,5★ ≈ 95 %, 4★ ≈ 90 %)
            "rv": min(1, 0.95 + (rt["starRating"] - 4.5) / 10) if rt.get("count") else None, "rc": rt.get("count") or 0,
            "fee": x["deliveryCost"], "min": x["minimumDeliveryValue"], "dist": f"{km:.1f}km",
            "tags": list(dict.fromkeys(c["name"] for c in x["cuisines"] if c["name"] in JE_TAGS))[:3],
            "group": group, "exotic": group in EXOTIC_GROUPS,
            "status": "OPEN" if av.get("isOpen") and not av.get("isTemporarilyOffline") else "CLOSED",
            "when": "Cerrado temporalmente" if av.get("isTemporarilyOffline") else "",
            "next": int(time.mktime(time.strptime(nxt[:19], "%Y-%m-%dT%H:%M:%S")) * 1000) if nxt else None,  # hora de Madrid (TZ arriba)
            "promo": re.sub(r"(\d) X (\d)", r"\1x\2", deal) if deal else None, "slug": "je-" + x["uniqueName"]}


try:
    je = json.loads(subprocess.run(["curl", "-sf", "-A", UA, "-H", "Accept: application/json", JE_API], capture_output=True, text=True).stdout)["restaurants"]
except (json.JSONDecodeError, KeyError) as e:
    je = None
    print(f"Just Eat no responde ({e}); se conservan sus sitios del barrido anterior", file=sys.stderr)
glovo_names = [r["name"] for r in ok]
if je is None:
    ok += [r for r in previous["rows"] if r.get("src") == "je"]
else:
    added = []
    for x in je:
        tags = [JE_TAGS[c["name"]] for c in x["cuisines"] if c["name"] in JE_TAGS]
        slug = "je-" + x["uniqueName"]
        if not x["isDelivery"] and slug in prev_rows:
            added.append({**prev_rows[slug], "status": "CLOSED", "when": "Sin reparto en el último barrido", "next": None})
            continue  # Just Eat quita el reparto según la hora: el sitio sigue en el bombo, cerrado
        if not x["isDelivery"] or x["isTestRestaurant"] or x["driveDistanceMeters"] > 10000 or not tags:
            continue  # sin reparto, de prueba, lejos o no es comida (supermercados, farmacias…)
        if same_place(x["name"], glovo_names):
            continue  # ya está en el bombo por Glovo
        if JE_FRANCHISES.search(x["name"]) or group_of("", tags) in LEFT_OUT_GROUPS:
            left_out.append(x["name"].strip())
            continue
        added.append(je_row(x, tags))
    ok += added
    excluded = [s for s in excluded if not same_place(s, [r["name"] for r in added])]  # ya no "no llegan": llegan por Just Eat
    print(f"Just Eat: {len(added)} sitios más")
ok.sort(key=lambda r: -(r["rv"] or 0))
for i, r in enumerate(ok, 1):
    r["n"] = i
out = {"sweptAt": int(time.time() * 1000), "rows": ok, "excluded": excluded, "leftOut": sorted(left_out)}
(ROOT / "data/stores.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
print(f"{len(ok)} llegan, {len(excluded)} no, {len(left_out)} fuera del bombo")
