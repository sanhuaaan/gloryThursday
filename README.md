# Jueves de Gloria

Bombo de bingo para decidir dónde pedimos la comida en la oficina de Zuatzu (Juan Fermín Gilisagasti, Donostia).

- `index.html`: la página. Abrir en el navegador, sin build.
- `data/stores.json`: restaurantes de Glovo que sí llegan a la oficina, y los que no.
- `data/slugs.txt`: tiendas a comprobar (slugs de Glovo Donostia).
- `scripts/sweep.py`: regenera `stores.json` consultando Glovo con las coordenadas de la oficina y lo inyecta en `index.html`.
- `.github/workflows/sweep.yml`: lanza el barrido cada media hora (y a mano desde Actions) y commitea el resultado.
- `scripts/remind.py` + `.github/workflows/remind.yml`: aviso a Google Chat el miércoles anterior al segundo jueves de mes (08:00 Madrid), con última ganadora, cuarentena y cocinas penalizadas. La URL del webhook va en el secreto `CHAT_WEBHOOK`.

Para actualizar los datos:

```bash
python3 scripts/sweep.py
```

La página lee `data/stores.json` al abrirse y proyecta el estado de cada tienda sobre la hora real del visitante (Glovo no expone horario semanal ni permite CORS desde otros dominios). Si el fichero no carga, usa los datos embebidos en `index.html`.

## Reglas del sorteo

- Dos fases: primero una cocina, luego un sitio al azar dentro de ella.
- Cuarentena de sitio: los ganadores de los últimos 6 sorteos no entran.
- Cocina penalizada: pesa ½ durante los 2 meses siguientes a su último sorteo ganado, ¾ hasta el cuarto mes, y entera después (tabla `PENALTY` en `index.html`).

## Ganadores y cuarentena

Cada sorteo se registra como un issue del repo (botón "Registrar ganador" tras el sorteo, o "Salió elegido" en cualquier tarjeta si se usó el bombo físico). El issue lleva en el cuerpo `tienda: <slug>` y `fecha: AAAA-MM-DD`. La página lee los issues abiertos y deja en cuarentena a los ganadores de los últimos 6 sorteos. Para anular un sorteo, cerrar el issue. Para cargar ganadores antiguos, crear el issue a mano con la fecha real.
