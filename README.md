# Jueves de Gloria

Bombo de bingo para decidir dónde pedimos la comida en la oficina de Zuatzu (Juan Fermín Gilisagasti, Donostia).

- `index.html`: la página. Abrir en el navegador, sin build.
- `data/stores.json`: restaurantes de Glovo que sí llegan a la oficina, y los que no.
- `data/slugs.txt`: tiendas a comprobar (slugs de Glovo Donostia). El barrido añade las que aparecen nuevas en los listados de Glovo y quita las que Glovo da por inexistentes.
- `scripts/sweep.py`: regenera `stores.json` consultando Glovo con las coordenadas de la oficina.
- `.github/workflows/sweep.yml`: lanza el barrido cada media hora (y a mano desde Actions) y commitea el resultado.
- `scripts/remind.py` + `.github/workflows/remind.yml`: aviso a Google Chat el miércoles anterior al segundo jueves de mes (08:00 Madrid), con última ganadora, cuarentena y cocinas penalizadas. La URL del webhook va en el secreto `CHAT_WEBHOOK`.

Para actualizar los datos:

```bash
python3 scripts/sweep.py
```

La página lee `data/stores.json`, `data/winners.json` (copia de los issues ganadores, `scripts/winners.py`) y `data/balls.json` (bolas extra, escritas desde `trastienda.html`) al abrirse, todo desde Pages y sin consultar la API de GitHub, y proyecta el estado de cada tienda sobre la hora real del visitante (Glovo no expone horario semanal ni permite CORS desde otros dominios). Si `stores.json` no carga, la página lo dice y pide recargar.

## Reglas del sorteo

- Dos fases: primero una cocina, luego un sitio al azar dentro de ella.
- Cuarentena de sitio: los ganadores de los últimos 6 sorteos no entran.
- Sitios con promo de Glovo: dentro de su cocina, el 2x1 pesa ×2 y un descuento en porcentaje ×1,5 (función `promoWeight` en `index.html`).
- Valoración: nota de Glovo suavizada con 20 votos a la media del bombo (sin votos = neutro); ≥95 % pesa ×1, 90-95 % ×0,75, <90 % ×0,5, multiplicado con la promo (`ratingWeight` en `index.html`).
- Cocina penalizada: pesa ¼ en los 2 sorteos siguientes a su último sorteo ganado, ½ en los 2 siguientes, ¾ en otros 2, y entera desde el séptimo (tabla `PENALTY` en `index.html`).

## Ganadores y cuarentena

Cada sorteo se registra como un issue del repo (botón "Registrar ganador" tras el sorteo, o "Salió elegido" en cualquier tarjeta si se usó el bombo físico). El issue lleva en el cuerpo `tienda: <slug>` y `fecha: AAAA-MM-DD`. La página lee los issues abiertos y deja en cuarentena a los ganadores de los últimos 6 sorteos. Para anular un sorteo, cerrar el issue. Para cargar ganadores antiguos, crear el issue a mano con la fecha real.
