-- Un voto por persona y sorteo: votar otra vez lo sustituye. voter = sha256 del correo, nunca el correo.
CREATE TABLE IF NOT EXISTS votes (
  raffle  INTEGER NOT NULL,
  voter   TEXT    NOT NULL,
  verdict TEXT    NOT NULL,
  at      TEXT    NOT NULL,
  PRIMARY KEY (raffle, voter)
);

-- Antojo de la oficina: las cocinas (JSON, hasta 3) que cada persona marca para el sorteo siguiente al ganador nº `after_raffle`.
CREATE TABLE IF NOT EXISTS cravings (
  after_raffle INTEGER NOT NULL,
  voter  TEXT    NOT NULL,
  groups TEXT    NOT NULL,
  at     TEXT    NOT NULL,
  PRIMARY KEY (after_raffle, voter)
);
