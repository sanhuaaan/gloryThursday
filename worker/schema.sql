-- Un voto por persona y sorteo: votar otra vez lo sustituye. voter = sha256 del correo, nunca el correo.
CREATE TABLE IF NOT EXISTS votes (
  raffle  INTEGER NOT NULL,
  voter   TEXT    NOT NULL,
  verdict TEXT    NOT NULL,
  at      TEXT    NOT NULL,
  PRIMARY KEY (raffle, voter)
);
