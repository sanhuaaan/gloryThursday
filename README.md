# gloryThursday

Bombo de bingo para decidir dónde pedimos la comida en la oficina de Zuatzu (Juan Fermín Gilisagasti, Donostia).

- `index.html`: la página. Abrir en el navegador, sin build.
- `data/stores.json`: restaurantes de Glovo que sí llegan a la oficina, y los que no.
- `data/slugs.txt`: tiendas a comprobar (slugs de Glovo Donostia).
- `scripts/sweep.py`: regenera `stores.json` consultando Glovo con las coordenadas de la oficina.

Para actualizar los datos:

```bash
python3 scripts/sweep.py
```

Nota: `index.html` lleva los datos embebidos en la constante `DATA`; tras un barrido hay que volcar `data/stores.json` ahí.
