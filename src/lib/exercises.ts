import { all, db, one, uuid } from './db';
import { AppError } from './errors';
import { estimateOneRepMax } from './dashboard';
import { cleanName, normalizeName } from './text';
import type {
  EquipmentCategory,
  Exercise,
  Member,
} from './types';

const EQUIPMENT = new Set<EquipmentCategory>(['dumbbell', 'barbell', 'machine']);

type ExerciseRow = {
  id: string;
  familyId: string;
  name: string;
  normalizedName: string;
  equipmentCategory: EquipmentCategory;
  isCore: number;
  archivedAt: number | null;
  createdAt: number;
};

const EXERCISE_COLUMNS = `
  id,
  family_id AS familyId,
  name,
  normalized_name AS normalizedName,
  equipment_category AS equipmentCategory,
  is_core AS isCore,
  archived_at AS archivedAt,
  created_at AS createdAt
`;

function toExercise(row: ExerciseRow): Exercise {
  return { ...row, isCore: row.isCore === 1 };
}

export async function listExercises(member: Member): Promise<Exercise[]> {
  const rows = await all<ExerciseRow>(
    db()
      .prepare(
        `SELECT ${EXERCISE_COLUMNS}
         FROM exercises
         WHERE family_id = ? AND archived_at IS NULL
         ORDER BY is_core DESC, name COLLATE NOCASE ASC`,
      )
      .bind(member.familyId),
  );
  return rows.map(toExercise);
}

export async function getExercise(member: Member, id: string): Promise<Exercise | null> {
  const row = await one<ExerciseRow>(
    db()
      .prepare(
        `SELECT ${EXERCISE_COLUMNS}
         FROM exercises
         WHERE id = ? AND family_id = ? AND archived_at IS NULL`,
      )
      .bind(id, member.familyId),
  );
  return row === null ? null : toExercise(row);
}

export type ExercisePerformance = {
  estimatedOneRepMax: number;
  repetitions: number;
  load: number;
  trainingDate: string;
  routineName: string | null;
};

export type ExerciseHistoryEntry = {
  sessionId: string;
  trainingDate: string;
  routineName: string | null;
  bestEstimatedOneRepMax: number;
  heaviestLoad: number;
  sets: { repetitions: number; load: number; estimatedOneRepMax: number }[];
};

export type ExerciseDetail = {
  exercise: Exercise;
  stats: {
    best: ExercisePerformance | null;
    heaviest: ExercisePerformance | null;
    totalSessions: number;
    totalSets: number;
    totalVolume: number;
    lastTrained: string | null;
  };
  history: ExerciseHistoryEntry[];
  chart: { date: string; value: number }[];
};

type DetailRow = {
  sessionId: string;
  trainingDate: string;
  routineName: string | null;
  repetitions: number;
  load: number;
};

export async function getExerciseDetail(
  member: Member,
  id: string,
): Promise<ExerciseDetail | null> {
  const exercise = await getExercise(member, id);
  if (exercise === null) return null;

  const rows = await all<DetailRow>(
    db()
      .prepare(
        `WITH recent AS (
           SELECT id, training_date, routine_name, started_at
           FROM sessions
           WHERE member_id = ? AND status = 'completed'
           ORDER BY training_date DESC, started_at DESC
           LIMIT 80
         )
         SELECT recent.id AS sessionId,
                recent.training_date AS trainingDate,
                recent.routine_name AS routineName,
                cs.repetitions,
                cs.load
         FROM recent
         JOIN session_exercises se ON se.session_id = recent.id
         JOIN completed_sets cs ON cs.session_exercise_id = se.id
         WHERE se.exercise_id = ?
            OR (se.exercise_id IS NULL AND lower(trim(se.exercise_name)) = ?)
         ORDER BY recent.training_date DESC, recent.started_at DESC, se.position ASC, cs.position ASC`,
      )
      .bind(member.id, exercise.id, exercise.normalizedName),
  );

  const bySession = new Map<string, ExerciseHistoryEntry>();
  for (const row of rows) {
    let entry = bySession.get(row.sessionId);
    if (entry === undefined) {
      entry = {
        sessionId: row.sessionId,
        trainingDate: row.trainingDate,
        routineName: row.routineName,
        bestEstimatedOneRepMax: 0,
        heaviestLoad: 0,
        sets: [],
      };
      bySession.set(row.sessionId, entry);
    }
    const estimatedOneRepMax = estimateOneRepMax(row.load, row.repetitions);
    entry.sets.push({
      repetitions: row.repetitions,
      load: row.load,
      estimatedOneRepMax,
    });
    if (estimatedOneRepMax > entry.bestEstimatedOneRepMax) {
      entry.bestEstimatedOneRepMax = estimatedOneRepMax;
    }
    if (row.load > entry.heaviestLoad) entry.heaviestLoad = row.load;
  }

  const history = [...bySession.values()];
  let best: ExercisePerformance | null = null;
  let heaviest: ExercisePerformance | null = null;
  let totalSets = 0;
  let totalVolume = 0;

  for (const entry of history) {
    const bestSet = entry.sets.reduce((winner, set) =>
      set.estimatedOneRepMax > winner.estimatedOneRepMax ? set : winner,
    );
    const heaviestSet = entry.sets.reduce((winner, set) =>
      set.load > winner.load ? set : winner,
    );

    if (best === null || bestSet.estimatedOneRepMax > best.estimatedOneRepMax) {
      best = {
        estimatedOneRepMax: bestSet.estimatedOneRepMax,
        repetitions: bestSet.repetitions,
        load: bestSet.load,
        trainingDate: entry.trainingDate,
        routineName: entry.routineName,
      };
    }
    if (heaviest === null || heaviestSet.load > heaviest.load) {
      heaviest = {
        estimatedOneRepMax: heaviestSet.estimatedOneRepMax,
        repetitions: heaviestSet.repetitions,
        load: heaviestSet.load,
        trainingDate: entry.trainingDate,
        routineName: entry.routineName,
      };
    }
    totalSets += entry.sets.length;
    totalVolume += entry.sets.reduce((total, set) => total + set.load * set.repetitions, 0);
  }

  return {
    exercise,
    stats: {
      best,
      heaviest,
      totalSessions: history.length,
      totalSets,
      totalVolume,
      lastTrained: history[0]?.trainingDate ?? null,
    },
    history: history.slice(0, 20),
    chart: history
      .slice(0, 12)
      .reverse()
      .map((entry) => ({ date: entry.trainingDate, value: entry.bestEstimatedOneRepMax })),
  };
}

function validateName(raw: string): string {
  const name = cleanName(raw);
  if (name.length === 0) throw new AppError('Enter an exercise name.');
  if (name.length > 80) throw new AppError('Exercise names must be 80 characters or fewer.');
  return name;
}

function validateEquipment(value: string): EquipmentCategory {
  if (!EQUIPMENT.has(value as EquipmentCategory)) {
    throw new AppError('Choose dumbbell, barbell, or machine.');
  }
  return value as EquipmentCategory;
}

export async function createExercise(
  member: Member,
  rawName: string,
  rawEquipment: string,
): Promise<string> {
  const name = validateName(rawName);
  const normalizedName = normalizeName(name);
  const equipmentCategory = validateEquipment(rawEquipment);

  const existing = await one<{ id: string }>(
    db()
      .prepare('SELECT id FROM exercises WHERE family_id = ? AND normalized_name = ?')
      .bind(member.familyId, normalizedName),
  );
  if (existing !== null) throw new AppError('An exercise with that name already exists.');

  const id = uuid();
  await db()
    .prepare(
      `INSERT INTO exercises
        (id, family_id, name, normalized_name, equipment_category, is_core, archived_at, created_at)
       VALUES (?, ?, ?, ?, ?, 0, NULL, ?)`,
    )
    .bind(id, member.familyId, name, normalizedName, equipmentCategory, Date.now())
    .run();
  return id;
}

export async function updateExercise(
  member: Member,
  id: string,
  rawName: string,
  rawEquipment: string,
  isCore: boolean,
): Promise<void> {
  const exercise = await getExercise(member, id);
  if (exercise === null) throw new AppError('Exercise not found.', 404);

  const name = validateName(rawName);
  const normalizedName = normalizeName(name);
  const equipmentCategory = validateEquipment(rawEquipment);

  const existing = await one<{ id: string }>(
    db()
      .prepare('SELECT id FROM exercises WHERE family_id = ? AND normalized_name = ?')
      .bind(member.familyId, normalizedName),
  );
  if (existing !== null && existing.id !== id) {
    throw new AppError('An exercise with that name already exists.');
  }

  await db()
    .prepare(
      `UPDATE exercises
       SET name = ?, normalized_name = ?, equipment_category = ?, is_core = ?
       WHERE id = ? AND family_id = ?`,
    )
    .bind(name, normalizedName, equipmentCategory, isCore ? 1 : 0, id, member.familyId)
    .run();
}

export async function setExerciseCore(
  member: Member,
  id: string,
  isCore: boolean,
): Promise<void> {
  const exercise = await getExercise(member, id);
  if (exercise === null) throw new AppError('Exercise not found.', 404);
  await db()
    .prepare('UPDATE exercises SET is_core = ? WHERE id = ? AND family_id = ?')
    .bind(isCore ? 1 : 0, id, member.familyId)
    .run();
}
