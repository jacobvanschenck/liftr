-- Liftr initial schema.
-- IDs are TEXT: migrated Convex document ids for history, UUIDs for new rows.
-- Dates are calendar strings (YYYY-MM-DD); timestamps are epoch milliseconds.

CREATE TABLE families (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE members (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id),
  auth_user_id TEXT UNIQUE,
  email TEXT,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Chicago',
  created_at INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX members_family_email ON members(family_id, email);

CREATE TABLE exercises (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id),
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  equipment_category TEXT NOT NULL CHECK (equipment_category IN ('dumbbell', 'barbell', 'machine')),
  is_core INTEGER NOT NULL DEFAULT 0 CHECK (is_core IN (0, 1)),
  archived_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (family_id, normalized_name)
) STRICT;

CREATE INDEX exercises_family_active ON exercises(family_id, archived_at);

CREATE TABLE routines (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id),
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  archived_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (family_id, normalized_name)
) STRICT;

CREATE INDEX routines_family_active ON routines(family_id, archived_at);

CREATE TABLE routine_exercises (
  routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  exercise_id TEXT NOT NULL REFERENCES exercises(id),
  position INTEGER NOT NULL,
  target_set_count INTEGER NOT NULL CHECK (target_set_count >= 1),
  target_rep_min INTEGER,
  target_rep_max INTEGER,
  PRIMARY KEY (routine_id, position),
  CHECK (
    (target_rep_min IS NULL AND target_rep_max IS NULL) OR
    (target_rep_min IS NOT NULL AND target_rep_max IS NOT NULL AND
     target_rep_min >= 1 AND target_rep_max >= target_rep_min)
  )
) STRICT;

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id),
  routine_id TEXT REFERENCES routines(id),
  routine_name TEXT,
  training_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('inProgress', 'completed')),
  started_at INTEGER NOT NULL,
  completed_at INTEGER
) STRICT;

CREATE INDEX sessions_member_status ON sessions(member_id, status);
CREATE INDEX sessions_member_completed_date ON sessions(member_id, status, training_date);

CREATE TABLE session_exercises (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  exercise_id TEXT REFERENCES exercises(id),
  exercise_name TEXT NOT NULL,
  equipment_category TEXT NOT NULL CHECK (equipment_category IN ('dumbbell', 'barbell', 'machine')),
  position INTEGER NOT NULL,
  target_set_count INTEGER NOT NULL CHECK (target_set_count >= 1),
  target_rep_min INTEGER,
  target_rep_max INTEGER,
  UNIQUE (session_id, position)
) STRICT;

CREATE INDEX session_exercises_session ON session_exercises(session_id, position);
CREATE INDEX session_exercises_exercise ON session_exercises(exercise_id);

CREATE TABLE completed_sets (
  id TEXT PRIMARY KEY,
  session_exercise_id TEXT NOT NULL REFERENCES session_exercises(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  repetitions INTEGER NOT NULL CHECK (repetitions BETWEEN 1 AND 1000),
  load REAL NOT NULL CHECK (load >= 0 AND load <= 10000),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX completed_sets_exercise ON completed_sets(session_exercise_id, position);

CREATE TABLE body_metrics (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id),
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  unit TEXT NOT NULL CHECK (unit IN ('lb', 'in')),
  position INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  UNIQUE (family_id, key)
) STRICT;

CREATE TABLE body_values (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id),
  metric_id TEXT NOT NULL REFERENCES body_metrics(id),
  date TEXT NOT NULL,
  value REAL NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (member_id, metric_id, date)
) STRICT;

CREATE INDEX body_values_member_date ON body_values(member_id, date);
