#!/usr/bin/env python3
"""Barrido de Glovo: que tiendas reparten a unas coordenadas.

Uso: python3 scripts/sweep.py [lat] [lon]  (por defecto, la oficina de Zuatzu)
Lee data/slugs.txt más las tiendas que aparezcan en los listados de Glovo, actualiza data/slugs.txt,
escribe data/stores.json y lo inyecta en index.html (entre DATA-START y DATA-END).
Las tiendas fuera de zona devuelven 404 "No available store address found".
"""
import hashlib, html, json, os, re, subprocess, sys, time, urllib.request, uuid
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
LEFT_OUT_GROUPS = {"Dulce / café"}  # pastelerías y cafés: no son comida de mediodía
LEFT_OUT_GROUPS = {"Dulce / café"}  # pastelerías y cafés: no son comida de mediodía
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
ok.sort(key=lambda r: -int(r["rating"][:-1]) if r["rating"] else 1)
for i, r in enumerate(ok, 1):
    r["n"] = i
def latest_raffle():
    """Número del último issue de ganador abierto (0 si no hay)."""
    token = os.environ.get("GITHUB_TOKEN")
    req = urllib.request.Request("https://api.github.com/repos/sanhuaaan/gloryThursday/issues?state=open&per_page=100",
                                 headers={"Accept": "application/vnd.github+json", **({"Authorization": f"Bearer {token}"} if token else {})})
    with urllib.request.urlopen(req, timeout=20) as r:
        issues = json.load(r)
    return max((i["number"] for i in issues if "pull_request" not in i and re.search(r"^\s*tienda:", i.get("body") or "", re.M)), default=0)


def draw_modifier():
    """Bolas extra de un solo sorteo, leídas del secreto DRAW_MOD:
    JSON {"balls": {"<cocina>": n}, "stores": {"<slug>": n}, "nonce": ...}.

    Cada bola extra suma el peso normal de su cocina o de su restaurante (1 bola = doble, 2 = triple). Las de restaurante
    solo valen en cocinas que también llevan bolas. Solo se publican huellas, cuántas bolas lleva cada una y el último
    sorteo registrado al guardarlas; la página las ignora en cuanto se registra otro. Un mismo valor del secreto solo se
    procesa una vez. Nunca se escribe una cocina ni un restaurante en claro ni en el log.
    """
    prev = {k: previous[k] for k in ("m", "s", "mTo", "mId") if k in previous}
    secret = os.environ.get("DRAW_MOD", "").strip()
    if not secret:
        return prev
    sid = hashlib.sha256(secret.encode()).hexdigest()[:16]
    if sid == prev.get("mId"):
        return prev
    try:
        wanted = json.loads(secret)
        wanted_balls, wanted_stores = wanted["balls"], wanted.get("stores", {})
    except (ValueError, KeyError, TypeError, AttributeError):
        print("DRAW_MOD con formato no válido; se ignora")
        return {**prev, "mId": sid}
    valid = lambda n: isinstance(n, int) and 0 < n <= 9
    names = {name for name, _ in GROUPS}
    balls = {g: n for g, n in wanted_balls.items() if g in names and valid(n)}
    group_of_slug = {r["slug"]: r["group"] for r in ok}
    stores = {s: n for s, n in wanted_stores.items() if group_of_slug.get(s) in balls and valid(n)}
    if not balls:
        return {"mId": sid}
    try:
        n = latest_raffle()
    except Exception as e:  # sin el último sorteo no se puede fijar la caducidad: mejor no activar
        print(f"DRAW_MOD sin activar: no se pudo leer GitHub ({e.__class__.__name__})")
        return prev
    sha = lambda t: hashlib.sha256(t.encode()).hexdigest()
    out = {"m": {sha(g): c for g, c in balls.items()}, "mTo": n, "mId": sid}
    if stores:
        out["s"] = {sha(s): c for s, c in stores.items()}
    return out


out = {"sweptAt": int(time.time() * 1000), "rows": ok, "excluded": excluded, "leftOut": sorted(left_out), **draw_modifier()}
(ROOT / "data/stores.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
html = (ROOT / "index.html").read_text()
a, b = html.index("/*DATA-START*/"), html.index("/*DATA-END*/")
(ROOT / "index.html").write_text(html[:a] + "/*DATA-START*/const DATA=" + json.dumps(out, ensure_ascii=False) + ";" + html[b:])
print(f"{len(ok)} llegan, {len(excluded)} no, {len(left_out)} fuera del bombo")
