import { all, db, one, uuid } from './db';
import { formatLoad } from './dates';
import { AppError } from './errors';
import { BAR_WEIGHT, decomposeBarbell, type PlateCounts } from './plates';
import { normalizeName } from './text';
import type {
  ActiveSession,
  CompletedSet,
  EquipmentCategory,
  Member,
  SessionExercise,
} from './types';

const MAX_SETS_PER_EXERCISE = 20;
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

type ExerciseMeta = {
  id: string;
  targetSetCount: number;
  targetRepMin: number | null;
  targetRepMax: number | null;
};

type OwnedSet = {
  setId: string;
  sessionExerciseId: string;
  sessionId: string;
  status: string;
};

export type SetLoggerConfig = {
  category: EquipmentCategory;
  plates: PlateCounts;
  manual: boolean;
  manualLoad: number;
  reps: number;
};

export type SessionLoggerExercise = SessionExercise & {
  progressLabel: string;
  loggerConfig: SetLoggerConfig;
};

export type SessionLoggerView = {
  id: string;
  routineName: string;
  trainingDate: string;
  exercises: SessionLoggerExercise[];
  totalSets: number;
  targetSets: number;
  firstIncompleteIndex: number;
};

export type SetFragmentView = {
  id: string;
  sets: CompletedSet[];
  progressLabel: string;
  totalSets: number;
  targetSets: number;
};

export type SetCommand =
  | {
      type: 'add';
      sessionExerciseId: string;
      repetitions: number;
      load: number;
    }
  | {
      type: 'update';
      setId: string;
      repetitions: number;
      load: number;
    }
  | {
      type: 'delete';
      setId: string;
    };

export type SetCommandResult = {
  fragment: SetFragmentView;
  error: string | null;
};

async function loadActiveSession(member: Member): Promise<ActiveSession | null> {
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

function repTargetLabel(
  targetRepMin: number | null,
  targetRepMax: number | null,
): string {
  if (targetRepMin !== null && targetRepMax !== null) return `${targetRepMin}–${targetRepMax} reps`;
  if (targetRepMin !== null) return `${targetRepMin}+ reps`;
  if (targetRepMax !== null) return `≤${targetRepMax} reps`;
  return 'reps';
}

function progressLabel(exercise: SessionExercise): string {
  return `${exercise.sets.length} of ${exercise.targetSetCount} sets · ${repTargetLabel(
    exercise.targetRepMin,
    exercise.targetRepMax,
  )}`;
}

function buildLoggerConfig(exercise: SessionExercise): SetLoggerConfig {
  const lastSet = exercise.sets.at(-1) ?? exercise.previousSet;
  const fallback = exercise.equipmentCategory === 'barbell' ? BAR_WEIGHT : 20;
  const initialLoad = lastSet?.load ?? fallback;
  const plates =
    exercise.equipmentCategory === 'barbell' ? decomposeBarbell(initialLoad) : {};
  return {
    category: exercise.equipmentCategory,
    plates: plates ?? {},
    manual: exercise.equipmentCategory === 'barbell' && plates === null,
    manualLoad: initialLoad,
    reps: lastSet?.repetitions ?? exercise.targetRepMin ?? 10,
  };
}

export async function loadSessionLogger(member: Member): Promise<SessionLoggerView | null> {
  const session = await loadActiveSession(member);
  if (session === null) return null;

  const exercises: SessionLoggerExercise[] = session.exercises.map((exercise) => ({
    ...exercise,
    progressLabel: progressLabel(exercise),
    loggerConfig: buildLoggerConfig(exercise),
  }));

  return {
    id: session.id,
    routineName: session.routineName,
    trainingDate: session.trainingDate,
    exercises,
    totalSets: exercises.reduce((total, exercise) => total + exercise.sets.length, 0),
    targetSets: exercises.reduce((total, exercise) => total + exercise.targetSetCount, 0),
    firstIncompleteIndex: exercises.findIndex(
      (exercise) => exercise.sets.length < exercise.targetSetCount,
    ),
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * The set rows are shared by the initial page and the htmx fragment. Keeping
 * the markup here means a set-row change can only land in one place.
 */
export function renderSetList(exercise: Pick<SessionExercise, 'id' | 'sets'>): string {
  const rows = exercise.sets
    .map(
      (set, index) => `
      <div class="set-row">
        <span class="set-index">${index + 1}</span>
        <span class="set-value">${formatLoad(Number(set.load))} lb × ${Number(set.repetitions)}</span>
        <span class="set-actions">
          <button
            class="icon-button"
            type="button"
            aria-label="Edit set ${index + 1}"
            title="Edit set"
            @click='beginEdit(${Number(set.load)}, ${Number(set.repetitions)}, ${JSON.stringify(set.id)})'
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          </button>
          <button
            class="icon-button danger"
            type="button"
            aria-label="Delete set ${index + 1}"
            title="Delete set"
            hx-post="/api/sessions/set/${encodeURIComponent(set.id)}/delete"
            hx-target="#sets-list-${escapeHtml(exercise.id)}"
            hx-swap="outerHTML"
            hx-confirm="Delete this set?"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
            </svg>
          </button>
        </span>
      </div>`,
    )
    .join('');

  return rows || '<p class="tiny muted" style="padding:8px 2px">No sets logged yet.</p>';
}

export function renderSetFragment(
  view: SetFragmentView,
  error: string | null,
): string {
  return `
    <div id="sets-list-${escapeHtml(view.id)}">
      ${error ? `<div class="form-error" style="margin-bottom:8px" role="alert">${escapeHtml(error)}</div>` : ''}
      ${renderSetList(view)}
    </div>
    <div id="progress-${escapeHtml(view.id)}" hx-swap-oob="outerHTML" class="logger-target">
      ${escapeHtml(view.progressLabel)}
    </div>
    <span id="session-total" hx-swap-oob="outerHTML">${view.totalSets}/${view.targetSets} sets</span>
    <span id="finish-total" hx-swap-oob="outerHTML">${view.totalSets} of ${view.targetSets}</span>
  `;
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

async function ownedSet(member: Member, setId: string): Promise<OwnedSet> {
  const row = await one<OwnedSet>(
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

async function addSet(
  member: Member,
  sessionExerciseId: string,
  repetitions: number,
  load: number,
): Promise<void> {
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
  const now = Date.now();
  await db()
    .prepare(
      `INSERT INTO completed_sets
        (id, session_exercise_id, position, repetitions, load, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(uuid(), sessionExerciseId, position, values.repetitions, values.load, now, now)
    .run();
}

async function updateOwnedSet(
  setId: string,
  repetitions: number,
  load: number,
): Promise<void> {
  const values = validatePerformance(repetitions, load);
  await db()
    .prepare(
      'UPDATE completed_sets SET repetitions = ?, load = ?, updated_at = ? WHERE id = ?',
    )
    .bind(values.repetitions, values.load, Date.now(), setId)
    .run();
}

async function deleteOwnedSet(owned: OwnedSet): Promise<void> {
  if (owned.status === 'completed' && (await sessionSetCount(owned.sessionId)) <= 1) {
    throw new AppError('A completed session needs at least one recorded set.');
  }
  await db().prepare('DELETE FROM completed_sets WHERE id = ?').bind(owned.setId).run();
}

async function loadExerciseFragment(
  member: Member,
  sessionExerciseId: string,
): Promise<SetFragmentView | null> {
  const meta = await one<ExerciseMeta>(
    db()
      .prepare(
        `SELECT se.id,
                se.target_set_count AS targetSetCount,
                se.target_rep_min AS targetRepMin,
                se.target_rep_max AS targetRepMax
         FROM session_exercises se
         JOIN sessions s ON s.id = se.session_id
         WHERE se.id = ? AND s.member_id = ?`,
      )
      .bind(sessionExerciseId, member.id),
  );
  if (meta === null) return null;

  const sets = (
    await all<CompletedSet>(
      db()
        .prepare(
          `SELECT id, position, repetitions, load
           FROM completed_sets
           WHERE session_exercise_id = ?
           ORDER BY position ASC`,
        )
        .bind(sessionExerciseId),
    )
  ).map((set) => ({
    id: set.id,
    position: Number(set.position),
    repetitions: Number(set.repetitions),
    load: Number(set.load),
  }));

  const totals = await one<{ totalSets: number; targetSets: number }>(
    db()
      .prepare(
        `SELECT
           (SELECT COUNT(*)
            FROM completed_sets cs
            JOIN session_exercises x ON x.id = cs.session_exercise_id
            WHERE x.session_id = se.session_id) AS totalSets,
           (SELECT COALESCE(SUM(y.target_set_count), 0)
            FROM session_exercises y
            WHERE y.session_id = se.session_id) AS targetSets
         FROM session_exercises se
         WHERE se.id = ?`,
      )
      .bind(sessionExerciseId),
  );

  const targetCount = Number(meta.targetSetCount);
  return {
    id: meta.id,
    sets,
    progressLabel: `${sets.length} of ${targetCount} sets · ${repTargetLabel(
      meta.targetRepMin === null ? null : Number(meta.targetRepMin),
      meta.targetRepMax === null ? null : Number(meta.targetRepMax),
    )}`,
    totalSets: Number(totals?.totalSets ?? 0),
    targetSets: Number(totals?.targetSets ?? 0),
  };
}

/**
 * Apply one set command and return the refreshed exercise fragment. User
 * errors become an inline message; missing exercises/sets return null so the
 * route can answer 404. Unexpected errors still surface as server errors.
 */
export async function applySetCommand(
  member: Member,
  command: SetCommand,
): Promise<SetCommandResult | null> {
  let sessionExerciseId: string | null = null;

  try {
    if (command.type === 'add') {
      sessionExerciseId = command.sessionExerciseId;
      await addSet(member, command.sessionExerciseId, command.repetitions, command.load);
    } else {
      const owned = await ownedSet(member, command.setId);
      sessionExerciseId = owned.sessionExerciseId;
      if (command.type === 'update') {
        await updateOwnedSet(command.setId, command.repetitions, command.load);
      } else {
        await deleteOwnedSet(owned);
      }
    }
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    if (error.status === 404 || sessionExerciseId === null) return null;

    const fragment = await loadExerciseFragment(member, sessionExerciseId);
    return fragment === null ? null : { fragment, error: error.message };
  }

  if (sessionExerciseId === null) return null;
  const fragment = await loadExerciseFragment(member, sessionExerciseId);
  return fragment === null ? null : { fragment, error: null };
}
