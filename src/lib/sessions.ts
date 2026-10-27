import { all, db, one, uuid } from './db';
import { isValidCalendarDate } from './dates';
import { AppError } from './errors';
import { normalizeName } from './text';
import type {
  ActiveSession,
  CompletedSet,
  EquipmentCategory,
  Member,
  SessionExercise,
} from './types';

const MAX_SETS_PER_EXERCISE = 20;
const MAX_SESSION_EXERCISES = 30;
const PREVIOUS_SESSION_LIMIT = 80;

type SessionRow = {
  id: string;
  routineName: string | null;
  trainingDate: string;
};

type SessionExerciseRow = {
  id: string;
  exerciseId: string | null;
  exerciseName: string;
  equipmentCategory: EquipmentCategory;
  position: number;
  targetSetCount: number;
  targetRepMin: number | null;
  targetRepMax: number | null;
  setId: string | null;
  setPosition: number | null;
  repetitions: number | null;
  load: number | null;
};

type PreviousRow = {
  trainingDate: string;
  exerciseId: string | null;
  exerciseName: string;
  repetitions: number;
  load: number;
};

export async function getActiveSession(member: Member): Promise<ActiveSession | null> {
  const session = await one<SessionRow>(
    db()
      .prepare(
        `SELECT id, routine_name AS routineName, training_date AS trainingDate
         FROM sessions
         WHERE member_id = ? AND status = 'inProgress'
         ORDER BY started_at DESC
         LIMIT 1`,
      )
      .bind(member.id),
  );
  if (session === null) return null;

  const rows = await all<SessionExerciseRow>(
    db()
      .prepare(
        `SELECT se.id,
                se.exercise_id AS exerciseId,
                se.exercise_name AS exerciseName,
                se.equipment_category AS equipmentCategory,
                se.position,
                se.target_set_count AS targetSetCount,
                se.target_rep_min AS targetRepMin,
                se.target_rep_max AS targetRepMax,
                cs.id AS setId,
                cs.position AS setPosition,
                cs.repetitions,
                cs.load
         FROM session_exercises se
         LEFT JOIN completed_sets cs ON cs.session_exercise_id = se.id
         WHERE se.session_id = ?
         ORDER BY se.position ASC, cs.position ASC`,
      )
      .bind(session.id),
  );

  const exercises: SessionExercise[] = [];
  const byExerciseId = new Map<string, SessionExercise>();

  for (const row of rows) {
    let exercise = byExerciseId.get(row.id);
    if (exercise === undefined) {
      exercise = {
        id: row.id,
        exerciseId: row.exerciseId,
        name: row.exerciseName,
        equipmentCategory: row.equipmentCategory,
        position: Number(row.position),
        targetSetCount: Number(row.targetSetCount),
        targetRepMin: row.targetRepMin === null ? null : Number(row.targetRepMin),
        targetRepMax: row.targetRepMax === null ? null : Number(row.targetRepMax),
        sets: [],
        previousSet: null,
      };
      byExerciseId.set(row.id, exercise);
      exercises.push(exercise);
    }
    if (row.setId !== null && row.repetitions !== null && row.load !== null) {
      exercise.sets.push({
        id: row.setId,
        position: Number(row.setPosition),
        repetitions: Number(row.repetitions),
        load: Number(row.load),
      });
    }
  }

  const needsPrevious = exercises.filter((exercise) => exercise.sets.length === 0);
  if (needsPrevious.length > 0) {
    const previousRows = await all<PreviousRow>(
      db()
        .prepare(
          `WITH recent AS (
             SELECT id, training_date, started_at
             FROM sessions
             WHERE member_id = ? AND status = 'completed'
             ORDER BY training_date DESC, started_at DESC
             LIMIT ?
           )
           SELECT recent.training_date AS trainingDate,
                  se.exercise_id AS exerciseId,
                  se.exercise_name AS exerciseName,
                  cs.repetitions,
                  cs.load
           FROM recent
           JOIN session_exercises se ON se.session_id = recent.id
           JOIN completed_sets cs ON cs.session_exercise_id = se.id
           ORDER BY recent.training_date DESC, recent.started_at DESC,
                    se.position ASC, cs.position DESC`,
        )
        .bind(member.id, PREVIOUS_SESSION_LIMIT),
    );

    for (const exercise of needsPrevious) {
      const normalized = normalizeName(exercise.name);
      const match = previousRows.find(
        (row) =>
          (exercise.exerciseId !== null && row.exerciseId === exercise.exerciseId) ||
          (row.exerciseId === null && normalizeName(row.exerciseName) === normalized),
      );
      if (match !== undefined) {
        exercise.previousSet = {
          repetitions: Number(match.repetitions),
          load: Number(match.load),
        };
      }
    }
  }

  return {
    id: session.id,
    routineName: session.routineName ?? 'Session',
    trainingDate: session.trainingDate,
    exercises,
  };
}

export async function getActiveSessionSummary(
  member: Member,
): Promise<{ routineName: string; trainingDate: string } | null> {
  const row = await one<{ routineName: string | null; trainingDate: string }>(
    db()
      .prepare(
        `SELECT routine_name AS routineName, training_date AS trainingDate
         FROM sessions
         WHERE member_id = ? AND status = 'inProgress'
         ORDER BY started_at DESC
         LIMIT 1`,
      )
      .bind(member.id),
  );
  return row === null
    ? null
    : { routineName: row.routineName ?? 'Session', trainingDate: row.trainingDate };
}

export async function startSession(
  member: Member,
  routineId: string,
  trainingDate: string,
): Promise<string> {
  if (!isValidCalendarDate(trainingDate)) throw new AppError('Training date is invalid.');

  const existing = await one<{ id: string }>(
    db()
      .prepare(
        `SELECT id FROM sessions
         WHERE member_id = ? AND status = 'inProgress'
         LIMIT 1`,
      )
      .bind(member.id),
  );
  if (existing !== null) throw new AppError('Finish or resume your in-progress session first.');

  const routine = await one<{ id: string; name: string }>(
    db()
      .prepare(
        `SELECT id, name FROM routines
         WHERE id = ? AND family_id = ? AND archived_at IS NULL`,
      )
      .bind(routineId, member.familyId),
  );
  if (routine === null) throw new AppError('Routine is unavailable.');

  const items = await all<{
    exerciseId: string;
    name: string;
    equipmentCategory: EquipmentCategory;
    targetSetCount: number;
    targetRepMin: number | null;
    targetRepMax: number | null;
  }>(
    db()
      .prepare(
        `SELECT re.exercise_id AS exerciseId,
                e.name,
                e.equipment_category AS equipmentCategory,
                re.target_set_count AS targetSetCount,
                re.target_rep_min AS targetRepMin,
                re.target_rep_max AS targetRepMax
         FROM routine_exercises re
         JOIN exercises e ON e.id = re.exercise_id
         WHERE re.routine_id = ? AND e.archived_at IS NULL
         ORDER BY re.position ASC
         LIMIT ?`,
      )
      .bind(routine.id, MAX_SESSION_EXERCISES),
  );
  if (items.length === 0) throw new AppError('This routine has no exercises.');

  const sessionId = uuid();
  const statements = [
    db()
      .prepare(
        `INSERT INTO sessions
          (id, member_id, routine_id, routine_name, training_date, status, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, 'inProgress', ?, NULL)`,
      )
      .bind(sessionId, member.id, routine.id, routine.name, trainingDate, Date.now()),
    ...items.map((item, position) =>
      db()
        .prepare(
          `INSERT INTO session_exercises
            (id, session_id, exercise_id, exercise_name, equipment_category, position,
             target_set_count, target_rep_min, target_rep_max)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          uuid(),
          sessionId,
          item.exerciseId,
          item.name,
          item.equipmentCategory,
          position,
          item.targetSetCount,
          item.targetRepMin,
          item.targetRepMax,
        ),
    ),
  ];
  await db().batch(statements);
  return sessionId;
}

function validatePerformance(
  repetitions: number,
  load: number,
): { repetitions: number; load: number } {
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 1000) {
    throw new AppError('Reps must be a whole number between 1 and 1000.');
  }
  if (!Number.isFinite(load) || load <= 0 || load > 10000) {
    throw new AppError('Load must be a positive weight in pounds.');
  }
  return { repetitions, load: Math.round(load * 100) / 100 };
}

async function ownedSessionExercise(
  member: Member,
  id: string,
): Promise<{ sessionExerciseId: string; sessionId: string; status: string }> {
  const row = await one<{ sessionExerciseId: string; sessionId: string; status: string }>(
    db()
      .prepare(
        `SELECT se.id AS sessionExerciseId, s.id AS sessionId, s.status
         FROM session_exercises se
         JOIN sessions s ON s.id = se.session_id
         WHERE se.id = ? AND s.member_id = ?`,
      )
      .bind(id, member.id),
  );
  if (row === null) throw new AppError('Exercise not found.', 404);
  return row;
}

async function ownedSet(
  member: Member,
  setId: string,
): Promise<{ setId: string; sessionExerciseId: string; sessionId: string; status: string }> {
  const row = await one<{
    setId: string;
    sessionExerciseId: string;
    sessionId: string;
    status: string;
  }>(
    db()
      .prepare(
        `SELECT cs.id AS setId, se.id AS sessionExerciseId, s.id AS sessionId, s.status
         FROM completed_sets cs
         JOIN session_exercises se ON se.id = cs.session_exercise_id
         JOIN sessions s ON s.id = se.session_id
         WHERE cs.id = ? AND s.member_id = ?`,
      )
      .bind(setId, member.id),
  );
  if (row === null) throw new AppError('Set not found.', 404);
  return row;
}

async function sessionSetCount(sessionId: string): Promise<number> {
  const row = await one<{ count: number }>(
    db()
      .prepare(
        `SELECT COUNT(*) AS count
         FROM completed_sets cs
         JOIN session_exercises se ON se.id = cs.session_exercise_id
         WHERE se.session_id = ?`,
      )
      .bind(sessionId),
  );
  return Number(row?.count ?? 0);
}

async function ownedSession(
  member: Member,
  sessionId: string,
): Promise<{ id: string; status: string }> {
  const row = await one<{ id: string; status: string }>(
    db()
      .prepare('SELECT id, status FROM sessions WHERE id = ? AND member_id = ?')
      .bind(sessionId, member.id),
  );
  if (row === null) throw new AppError('Session not found.', 404);
  return row;
}

export async function addSet(
  member: Member,
  sessionExerciseId: string,
  repetitions: number,
  load: number,
): Promise<CompletedSet> {
  const owned = await ownedSessionExercise(member, sessionExerciseId);
  if (owned.status !== 'inProgress') throw new AppError('This session is already complete.');

  const values = validatePerformance(repetitions, load);
  const existing = await all<{ position: number }>(
    db()
      .prepare(
        'SELECT position FROM completed_sets WHERE session_exercise_id = ? ORDER BY position ASC',
      )
      .bind(sessionExerciseId),
  );
  if (existing.length >= MAX_SETS_PER_EXERCISE) {
    throw new AppError(
      `An exercise can record at most ${MAX_SETS_PER_EXERCISE} sets per session.`,
    );
  }

  const position = existing.reduce((highest, set) => Math.max(highest, set.position), -1) + 1;
  const id = uuid();
  const now = Date.now();
  await db()
    .prepare(
      `INSERT INTO completed_sets
        (id, session_exercise_id, position, repetitions, load, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, sessionExerciseId, position, values.repetitions, values.load, now, now)
    .run();

  return { id, position, repetitions: values.repetitions, load: values.load };
}

export async function updateSet(
  member: Member,
  setId: string,
  repetitions: number,
  load: number,
): Promise<void> {
  await ownedSet(member, setId);
  const values = validatePerformance(repetitions, load);
  await db()
    .prepare(
      'UPDATE completed_sets SET repetitions = ?, load = ?, updated_at = ? WHERE id = ?',
    )
    .bind(values.repetitions, values.load, Date.now(), setId)
    .run();
}

export async function deleteSet(member: Member, setId: string): Promise<void> {
  const owned = await ownedSet(member, setId);
  if (owned.status === 'completed' && (await sessionSetCount(owned.sessionId)) <= 1) {
    throw new AppError('A completed session needs at least one recorded set.');
  }
  await db().prepare('DELETE FROM completed_sets WHERE id = ?').bind(setId).run();
}

export async function completeSession(member: Member, sessionId: string): Promise<void> {
  const session = await ownedSession(member, sessionId);
  if (session.status !== 'inProgress') throw new AppError('This session is already complete.');
  if ((await sessionSetCount(sessionId)) === 0) {
    throw new AppError('Record at least one set before completing the session.');
  }
  await db()
    .prepare(
      `UPDATE sessions SET status = 'completed', completed_at = ?
       WHERE id = ? AND member_id = ?`,
    )
    .bind(Date.now(), sessionId, member.id)
    .run();
}

export async function discardSession(member: Member, sessionId: string): Promise<void> {
  const session = await ownedSession(member, sessionId);
  if (session.status !== 'inProgress') {
    throw new AppError('Only an in-progress session can be discarded.');
  }
  await db().prepare('DELETE FROM sessions WHERE id = ? AND member_id = ?').bind(sessionId, member.id).run();
}
