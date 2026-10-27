import { all, db } from './db';
import { normalizeName } from './text';
import type { EquipmentCategory, Member } from './types';

export function estimateOneRepMax(load: number, repetitions: number): number {
  // Epley's estimate, with a single rep returning the lifted load exactly.
  return repetitions === 1 ? load : load * (1 + repetitions / 30);
}

type CoreExerciseRow = {
  id: string;
  name: string;
  normalizedName: string;
  equipmentCategory: EquipmentCategory;
};

type SessionRow = {
  id: string;
  trainingDate: string;
  routineName: string | null;
  startedAt: number;
};

type SetRow = {
  sessionId: string;
  trainingDate: string;
  routineName: string | null;
  sessionExerciseId: string;
  exerciseId: string | null;
  exerciseName: string;
  repetitions: number;
  load: number;
};

export type LatestPerformance = {
  estimatedOneRepMax: number;
  repetitions: number;
  load: number;
  trainingDate: string;
  routineName: string | null;
};

export type DashboardData = {
  strengthScore: number | null;
  coreCount: number;
  trackedCount: number;
  thisWeekSessions: number;
  scoreUpdatedAt: string | null;
  lastSession: { routineName: string | null; trainingDate: string } | null;
  coreExercises: {
    id: string;
    name: string;
    equipmentCategory: EquipmentCategory;
    latest: LatestPerformance | null;
  }[];
  history: { trainingDate: string; strengthScore: number }[];
};

export async function getDashboard(member: Member, weekStart: string): Promise<DashboardData> {
  const coreExercises = await all<CoreExerciseRow>(
    db()
      .prepare(
        `SELECT id, name, normalized_name AS normalizedName, equipment_category AS equipmentCategory
         FROM exercises
         WHERE family_id = ? AND archived_at IS NULL AND is_core = 1
         ORDER BY name COLLATE NOCASE ASC`,
      )
      .bind(member.familyId),
  );

  const recentSessions = await all<SessionRow>(
    db()
      .prepare(
        `SELECT id, training_date AS trainingDate, routine_name AS routineName, started_at AS startedAt
         FROM sessions
         WHERE member_id = ? AND status = 'completed'
         ORDER BY training_date DESC, started_at DESC
         LIMIT 80`,
      )
      .bind(member.id),
  );

  const setRows = await all<SetRow>(
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
                se.id AS sessionExerciseId,
                se.exercise_id AS exerciseId,
                se.exercise_name AS exerciseName,
                cs.repetitions,
                cs.load
         FROM recent
         JOIN session_exercises se ON se.session_id = recent.id
         JOIN completed_sets cs ON cs.session_exercise_id = se.id
         ORDER BY recent.training_date ASC, recent.started_at ASC, se.position ASC, cs.position ASC`,
      )
      .bind(member.id),
  );

  const coreById = new Map(coreExercises.map((exercise) => [exercise.id, exercise]));
  const coreByName = new Map(coreExercises.map((exercise) => [exercise.normalizedName, exercise]));
  const latestByExercise = new Map<string, LatestPerformance>();
  const historyByDate = new Map<string, number>();

  let currentSessionId: string | null = null;
  let currentTrainingDate = '';
  let currentRoutineName: string | null = null;
  const sessionBests = new Map<string, LatestPerformance>();

  const flushSession = () => {
    if (sessionBests.size === 0) return;
    // The dashboard shows the most recent performance for each core lift, not
    // the all-time best. That keeps the score and the delta honest on a deload
    // or an off day, and matches the old app.
    for (const [exerciseId, best] of sessionBests) {
      latestByExercise.set(exerciseId, best);
    }
    const score = coreExercises.reduce(
      (total, exercise) => total + (latestByExercise.get(exercise.id)?.estimatedOneRepMax ?? 0),
      0,
    );
    historyByDate.set(currentTrainingDate, score);
    sessionBests.clear();
  };

  for (const row of setRows) {
    if (row.sessionId !== currentSessionId) {
      flushSession();
      currentSessionId = row.sessionId;
      currentTrainingDate = row.trainingDate;
      currentRoutineName = row.routineName;
    }

    const core =
      (row.exerciseId !== null ? coreById.get(row.exerciseId) : undefined) ??
      coreByName.get(normalizeName(row.exerciseName));
    if (core === undefined) continue;

    const estimatedOneRepMax = estimateOneRepMax(row.load, row.repetitions);
    const best = sessionBests.get(core.id);
    if (best === undefined || estimatedOneRepMax > best.estimatedOneRepMax) {
      sessionBests.set(core.id, {
        estimatedOneRepMax,
        repetitions: row.repetitions,
        load: row.load,
        trainingDate: row.trainingDate,
        routineName: currentRoutineName,
      });
    }
  }
  flushSession();

  const history = [...historyByDate.entries()]
    .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
    .slice(-12)
    .map(([trainingDate, strengthScore]) => ({ trainingDate, strengthScore }));

  let scoreUpdatedAt: string | null = null;
  for (const latest of latestByExercise.values()) {
    if (scoreUpdatedAt === null || latest.trainingDate > scoreUpdatedAt) {
      scoreUpdatedAt = latest.trainingDate;
    }
  }

  const strengthScore =
    latestByExercise.size === 0
      ? null
      : coreExercises.reduce(
          (total, exercise) =>
            total + (latestByExercise.get(exercise.id)?.estimatedOneRepMax ?? 0),
          0,
        );

  return {
    strengthScore,
    coreCount: coreExercises.length,
    trackedCount: latestByExercise.size,
    thisWeekSessions: recentSessions.filter((session) => session.trainingDate >= weekStart).length,
    scoreUpdatedAt,
    lastSession:
      recentSessions[0] === undefined
        ? null
        : {
            routineName: recentSessions[0].routineName,
            trainingDate: recentSessions[0].trainingDate,
          },
    coreExercises: coreExercises.map((exercise) => ({
      id: exercise.id,
      name: exercise.name,
      equipmentCategory: exercise.equipmentCategory,
      latest: latestByExercise.get(exercise.id) ?? null,
    })),
    history,
  };
}
