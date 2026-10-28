import { all, db, one, uuid } from './db';
import { isValidCalendarDate } from './dates';
import { AppError } from './errors';
import type { EquipmentCategory, Member } from './types';

const MAX_SESSION_EXERCISES = 30;

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
  await db()
    .prepare('DELETE FROM sessions WHERE id = ? AND member_id = ?')
    .bind(sessionId, member.id)
    .run();
}
