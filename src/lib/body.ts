import { all, db, one, uuid } from './db';
import { isValidCalendarDate } from './dates';
import { AppError } from './errors';
import type { BodyEntry, BodyMetric, BodySeries, Member } from './types';

const HISTORY_ENTRY_LIMIT = 90;
const CHART_POINT_LIMIT = 90;
const VALUE_READ_LIMIT = 400;
const MAX_VALUES_PER_ENTRY = 20;

const UNIT_BOUNDS = {
  lb: { min: 1, max: 1000 },
  in: { min: 5, max: 100 },
} as const;

export type BodyOverview = {
  metrics: BodyMetric[];
  today: BodyEntry;
  history: BodyEntry[];
  series: BodySeries[];
};

type MetricRow = {
  id: string;
  key: string;
  label: string;
  unit: 'lb' | 'in';
  position: number;
  isActive: number;
};

type ValueRow = {
  metricId: string;
  date: string;
  value: number;
};

export async function getBodyOverview(member: Member, today: string): Promise<BodyOverview> {
  if (!isValidCalendarDate(today)) throw new AppError("Today's date is invalid.");

  const metricRows = await all<MetricRow>(
    db()
      .prepare(
        `SELECT id, key, label, unit, position, is_active AS isActive
         FROM body_metrics
         WHERE family_id = ?
         ORDER BY position ASC
         LIMIT 20`,
      )
      .bind(member.familyId),
  );

  const rows = await all<ValueRow>(
    db()
      .prepare(
        `SELECT metric_id AS metricId, date, value
         FROM body_values
         WHERE member_id = ?
         ORDER BY date DESC
         LIMIT ?`,
      )
      .bind(member.id, VALUE_READ_LIMIT),
  );

  const byDate = new Map<string, { metricId: string; value: number }[]>();
  for (const row of rows) {
    const values = byDate.get(row.date);
    const value = { metricId: row.metricId, value: Number(row.value) };
    if (values === undefined) byDate.set(row.date, [value]);
    else values.push(value);
  }

  const history = [...byDate.entries()]
    .sort(([dateA], [dateB]) => dateB.localeCompare(dateA))
    .slice(0, HISTORY_ENTRY_LIMIT)
    .map(([date, values]) => ({ date, values }));

  const visibleMetricIds = new Set(history.flatMap((entry) => entry.values.map((v) => v.metricId)));
  const metrics: BodyMetric[] = metricRows.map((row) => ({
    id: row.id,
    key: row.key,
    label: row.label,
    unit: row.unit,
    position: Number(row.position),
    isActive: row.isActive === 1,
  }));

  const chartedMetrics = metrics.filter(
    (metric) => metric.isActive || visibleMetricIds.has(metric.id),
  );

  const series: BodySeries[] = [];
  for (const metric of chartedMetrics) {
    const points = await all<{ date: string; value: number }>(
      db()
        .prepare(
          `SELECT date, value
           FROM body_values
           WHERE member_id = ? AND metric_id = ?
           ORDER BY date DESC
           LIMIT ?`,
        )
        .bind(member.id, metric.id, CHART_POINT_LIMIT),
    );
    series.push({
      metricId: metric.id,
      points: points
        .map((point) => ({ date: point.date, value: Number(point.value) }))
        .reverse(),
    });
  }

  return {
    metrics,
    today: { date: today, values: byDate.get(today) ?? [] },
    history,
    series,
  };
}

function validateValue(metric: BodyMetric, raw: number): number {
  if (!Number.isFinite(raw)) throw new AppError(`${metric.label} must be a number.`);
  const bounds = UNIT_BOUNDS[metric.unit];
  if (raw < bounds.min || raw > bounds.max) {
    throw new AppError(
      `${metric.label} must be between ${bounds.min} and ${bounds.max} ${metric.unit}.`,
    );
  }
  return Math.round(raw * 100) / 100;
}

export async function saveBodyEntry(
  member: Member,
  date: string,
  values: { metricId: string; value: number | null }[],
): Promise<void> {
  if (!isValidCalendarDate(date)) throw new AppError('Entry date is invalid.');
  if (values.length === 0) throw new AppError('Change a measurement before saving.');
  if (values.length > MAX_VALUES_PER_ENTRY) throw new AppError('Too many measurements in one entry.');

  const seen = new Set<string>();
  for (const item of values) {
    if (seen.has(item.metricId)) throw new AppError('Each measurement can only be saved once.');
    seen.add(item.metricId);
  }

  const statements: D1PreparedStatement[] = [];
  for (const item of values) {
    const row = await one<MetricRow>(
      db()
        .prepare(
          `SELECT id, key, label, unit, position, is_active AS isActive
           FROM body_metrics
           WHERE id = ? AND family_id = ?`,
        )
        .bind(item.metricId, member.familyId),
    );
    if (row === null) throw new AppError('That measurement is no longer available.', 404);
    if (item.value !== null && row.isActive !== 1) {
      throw new AppError(`${row.label} is no longer tracked.`);
    }

    if (item.value === null) {
      statements.push(
        db()
          .prepare('DELETE FROM body_values WHERE member_id = ? AND metric_id = ? AND date = ?')
          .bind(member.id, item.metricId, date),
      );
      continue;
    }

    const metric: BodyMetric = {
      id: row.id,
      key: row.key,
      label: row.label,
      unit: row.unit,
      position: Number(row.position),
      isActive: row.isActive === 1,
    };
    const value = validateValue(metric, item.value);

    statements.push(
      db()
        .prepare(
          `INSERT INTO body_values (id, member_id, metric_id, date, value, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (member_id, metric_id, date)
           DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        )
        .bind(uuid(), member.id, item.metricId, date, value, Date.now()),
    );
  }

  await db().batch(statements);
}

export async function deleteBodyEntry(member: Member, date: string): Promise<void> {
  if (!isValidCalendarDate(date)) throw new AppError('Entry date is invalid.');
  await db()
    .prepare('DELETE FROM body_values WHERE member_id = ? AND date = ?')
    .bind(member.id, date)
    .run();
}
