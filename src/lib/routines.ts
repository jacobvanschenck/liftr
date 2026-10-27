import { all, db, one, uuid } from './db';
import { AppError } from './errors';
import { cleanName, normalizeName } from './text';
import type {
  EquipmentCategory,
  Member,
  Routine,
  RoutineExercise,
  RoutineSummary,
} from './types';

export type RoutineItemInput = {
  exerciseId: string;
  targetSetCount: number;
  targetRepMin: number | null;
  targetRepMax: number | null;
};

export async function listRoutines(member: Member): Promise<RoutineSummary[]> {
  const rows = await all<{ id: string; name: string; exerciseCount: number }>(
    db()
      .prepare(
        `SELECT r.id, r.name, COUNT(re.exercise_id) AS exerciseCount
         FROM routines r
         LEFT JOIN routine_exercises re ON re.routine_id = r.id
         WHERE r.family_id = ? AND r.archived_at IS NULL
         GROUP BY r.id
         ORDER BY r.name COLLATE NOCASE ASC`,
      )
      .bind(member.familyId),
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    exerciseCount: Number(row.exerciseCount),
  }));
}

type RoutineRow = {
  id: string;
  name: string;
  exerciseId: string;
  exerciseName: string;
  equipmentCategory: EquipmentCategory;
  position: number;
  targetSetCount: number;
  targetRepMin: number | null;
  targetRepMax: number | null;
};

export async function getRoutine(member: Member, id: string): Promise<Routine | null> {
  const routine = await one<{ id: string; name: string }>(
    db()
      .prepare(
        `SELECT id, name FROM routines
         WHERE id = ? AND family_id = ? AND archived_at IS NULL`,
      )
      .bind(id, member.familyId),
  );
  if (routine === null) return null;

  const rows = await all<RoutineRow>(
    db()
      .prepare(
        `SELECT r.id,
                r.name,
                e.id AS exerciseId,
                e.name AS exerciseName,
                e.equipment_category AS equipmentCategory,
                re.position,
                re.target_set_count AS targetSetCount,
                re.target_rep_min AS targetRepMin,
                re.target_rep_max AS targetRepMax
         FROM routines r
         JOIN routine_exercises re ON re.routine_id = r.id
         JOIN exercises e ON e.id = re.exercise_id
         WHERE r.id = ? AND r.family_id = ? AND r.archived_at IS NULL
         ORDER BY re.position ASC`,
      )
      .bind(id, member.familyId),
  );

  const exercises: RoutineExercise[] = rows.map((row) => ({
    exerciseId: row.exerciseId,
    name: row.exerciseName,
    equipmentCategory: row.equipmentCategory,
    targetSetCount: Number(row.targetSetCount),
    targetRepMin: row.targetRepMin === null ? null : Number(row.targetRepMin),
    targetRepMax: row.targetRepMax === null ? null : Number(row.targetRepMax),
  }));

  return { id: routine.id, name: routine.name, exercises };
}

function validateRoutineName(raw: string): { name: string; normalizedName: string } {
  const name = cleanName(raw);
  if (name.length === 0) throw new AppError('Enter a routine name.');
  if (name.length > 80) throw new AppError('Routine names must be 80 characters or fewer.');
  return { name, normalizedName: normalizeName(name) };
}

async function validateItems(
  member: Member,
  items: RoutineItemInput[],
): Promise<RoutineItemInput[]> {
  if (items.length === 0) throw new AppError('Add at least one exercise to a routine.');
  if (items.length > 30) throw new AppError('Routines can contain at most 30 exercises.');

  const seen = new Set<string>();
  const cleaned: RoutineItemInput[] = [];

  for (const item of items) {
    if (!Number.isInteger(item.targetSetCount) || item.targetSetCount < 1) {
      throw new AppError('Target set counts must be whole numbers of at least one.');
    }
    if ((item.targetRepMin === null) !== (item.targetRepMax === null)) {
      throw new AppError('Enter both ends of a target rep range.');
    }
    if (
      item.targetRepMin !== null &&
      item.targetRepMax !== null &&
      (!Number.isInteger(item.targetRepMin) ||
        !Number.isInteger(item.targetRepMax) ||
        item.targetRepMin < 1 ||
        item.targetRepMax < item.targetRepMin)
    ) {
      throw new AppError('Target rep ranges must be positive whole numbers in ascending order.');
    }
    if (seen.has(item.exerciseId)) {
      throw new AppError('Each exercise can appear only once in a routine.');
    }
    seen.add(item.exerciseId);

    const exercise = await one<{ id: string }>(
      db()
        .prepare(
          `SELECT id FROM exercises
           WHERE id = ? AND family_id = ? AND archived_at IS NULL`,
        )
        .bind(item.exerciseId, member.familyId),
    );
    if (exercise === null) {
      throw new AppError('Every routine exercise must belong to your active shared catalog.');
    }

    cleaned.push({
      exerciseId: item.exerciseId,
      targetSetCount: item.targetSetCount,
      targetRepMin: item.targetRepMin,
      targetRepMax: item.targetRepMax,
    });
  }

  return cleaned;
}

async function assertUniqueName(
  member: Member,
  normalizedName: string,
  exceptId?: string,
): Promise<void> {
  const existing = await one<{ id: string }>(
    db()
      .prepare('SELECT id FROM routines WHERE family_id = ? AND normalized_name = ?')
      .bind(member.familyId, normalizedName),
  );
  if (existing !== null && existing.id !== exceptId) {
    throw new AppError('A routine with that name already exists.');
  }
}

export async function createRoutine(
  member: Member,
  rawName: string,
  items: RoutineItemInput[],
): Promise<string> {
  const { name, normalizedName } = validateRoutineName(rawName);
  await assertUniqueName(member, normalizedName);
  const cleaned = await validateItems(member, items);

  const routineId = uuid();
  const statements = [
    db()
      .prepare(
        `INSERT INTO routines (id, family_id, name, normalized_name, archived_at, created_at)
         VALUES (?, ?, ?, ?, NULL, ?)`,
      )
      .bind(routineId, member.familyId, name, normalizedName, Date.now()),
    ...cleaned.map((item, position) =>
      db()
        .prepare(
          `INSERT INTO routine_exercises
            (routine_id, exercise_id, position, target_set_count, target_rep_min, target_rep_max)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          routineId,
          item.exerciseId,
          position,
          item.targetSetCount,
          item.targetRepMin,
          item.targetRepMax,
        ),
    ),
  ];
  await db().batch(statements);
  return routineId;
}

export async function updateRoutine(
  member: Member,
  id: string,
  rawName: string,
  items: RoutineItemInput[],
): Promise<void> {
  const routine = await one<{ id: string }>(
    db()
      .prepare(
        `SELECT id FROM routines
         WHERE id = ? AND family_id = ? AND archived_at IS NULL`,
      )
      .bind(id, member.familyId),
  );
  if (routine === null) throw new AppError('Routine not found.', 404);

  const { name, normalizedName } = validateRoutineName(rawName);
  await assertUniqueName(member, normalizedName, id);
  const cleaned = await validateItems(member, items);

  const statements = [
    db()
      .prepare('UPDATE routines SET name = ?, normalized_name = ? WHERE id = ? AND family_id = ?')
      .bind(name, normalizedName, id, member.familyId),
    db().prepare('DELETE FROM routine_exercises WHERE routine_id = ?').bind(id),
    ...cleaned.map((item, position) =>
      db()
        .prepare(
          `INSERT INTO routine_exercises
            (routine_id, exercise_id, position, target_set_count, target_rep_min, target_rep_max)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          item.exerciseId,
          position,
          item.targetSetCount,
          item.targetRepMin,
          item.targetRepMax,
        ),
    ),
  ];
  await db().batch(statements);
}
