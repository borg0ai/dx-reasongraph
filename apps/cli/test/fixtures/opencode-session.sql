-- OpenCodeAdapter reads session_v2 and session_message.
-- The legacy `session` table is a decoy and must not be discovered.
CREATE TABLE session (
  id TEXT PRIMARY KEY,
  directory TEXT
);
CREATE TABLE session_v2 (
  id TEXT PRIMARY KEY,
  directory TEXT,
  path TEXT
);
CREATE TABLE session_message (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  type TEXT,
  seq INTEGER,
  time_created INTEGER,
  time_updated INTEGER,
  data TEXT
);

INSERT INTO session (id, directory) VALUES ('ses_legacy_decoy', '__REPO__');
INSERT INTO session_v2 (id, directory, path) VALUES ('ses_opencode', '__REPO__', '');
INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES (
  'msg_skip',
  'ses_opencode',
  'synthetic',
  0,
  500,
  500,
  '{"text":"SYNTHETIC_INSTRUCTION"}'
);
INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES (
  'msg_first',
  'ses_opencode',
  'user',
  1,
  1000,
  1000,
  '{"text":"Keep the first guest token rule."}'
);
