// Votación del Jueves de Gloria (Google Apps Script). Vive en Google; esta copia es la de referencia.
//
// Montaje, una sola vez y con la cuenta de la empresa:
//   1. script.google.com → Proyecto nuevo → pega este fichero entero → guarda.
//   2. Elige la función setup → Ejecutar → acepta los permisos.
//   3. En el registro de ejecución salen dos enlaces: el del chat (va a FORM en scripts/vote.js) y el de la hoja.
//   4. En la hoja: Archivo → Compartir → Publicar en la web → pestaña "resultados", formato CSV → Publicar.
//      Ese enlace va a VOTES_CSV en scripts/winners.py.
//
// El formulario recoge el correo verificado (solo cuentas de la empresa), pero la hoja solo guarda recuentos:
// tally() se queda con el último voto de cada persona en cada sorteo y escribe cuántos hay de cada opción.

const OPTIONS = { '¡Repetiríamos!': 'repetir', 'Aprobado': 'aprobado', 'Ni fu ni fa': 'nifu', 'Nunca más': 'nuncamas' };

function setup() {
  const form = FormApp.create('Jueves de Gloria · ¿Qué tal la comida?')
    .setDescription('Un voto por persona: si vuelves a votar, cuenta el último. El resultado pesa en los próximos sorteos.')
    .setEmailCollectionType(FormApp.EmailCollectionType.VERIFIED)
    .setRequireLogin(true)
    .setConfirmationMessage('¡Anotado! La Dirección toma nota.');
  if (form.setPublished) form.setPublished(true);   // los formularios nuevos creados por script nacen sin publicar
  const sorteo = form.addTextItem().setTitle('Sorteo').setHelpText('Viene rellenado desde el chat; no lo cambies.').setRequired(true);
  form.addMultipleChoiceItem().setTitle('¿Qué os pareció?').setChoiceValues(Object.keys(OPTIONS)).setRequired(true);

  const ss = SpreadsheetApp.create('Jueves de Gloria · resultados');
  ss.getSheets()[0].setName('resultados');
  PropertiesService.getScriptProperties().setProperties({ form: form.getId(), sheet: ss.getId() });
  ScriptApp.newTrigger('tally').forForm(form).onFormSubmit().create();
  tally();

  Logger.log('Enlace para el chat: ' + form.createResponse().withItemResponse(sorteo.createResponse('SORTEO')).toPrefilledUrl());
  Logger.log('Hoja de resultados: ' + ss.getUrl());
}

function tally() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);   // dos votos a la vez: que no se pisen al escribir
  const p = PropertiesService.getScriptProperties(), keys = Object.values(OPTIONS), last = {}, counts = {};
  // las respuestas llegan en orden: el último voto de cada persona en cada sorteo pisa al anterior
  FormApp.openById(p.getProperty('form')).getResponses().forEach(r => {
    const [s, v] = r.getItemResponses().map(i => i.getResponse());
    const n = parseInt(s, 10);
    if (n > 0 && OPTIONS[v]) last[r.getRespondentEmail() + '|' + n] = { n, k: OPTIONS[v] };
  });
  Object.values(last).forEach(({ n, k }) => {
    counts[n] = counts[n] || Object.fromEntries(keys.map(x => [x, 0]));
    counts[n][k]++;
  });
  const rows = [['sorteo', ...keys], ...Object.keys(counts).sort((a, b) => b - a).map(n => [n, ...keys.map(k => counts[n][k])])];
  const sh = SpreadsheetApp.openById(p.getProperty('sheet')).getSheetByName('resultados');
  sh.clearContents();
  sh.getRange(1, 1, rows.length, keys.length + 1).setValues(rows);
  lock.releaseLock();
}
