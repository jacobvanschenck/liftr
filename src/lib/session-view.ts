import { all, db, one } from './db';
import { formatLoad } from './dates';
import type { Member } from './types';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

type ExerciseMeta = {
  id: string;
  targetSetCount: number;
  targetRepMin: number | null;
  targetRepMax: number | null;
};

type SetRow = {
  id: string;
  position: number;
  repetitions: number;
  load: number;
};

export function repTargetLabel(
  targetRepMin: number | null,
  targetRepMax: number | null,
): string {
  if (targetRepMin !== null && targetRepMax !== null) return `${targetRepMin}–${targetRepMax} reps`;
  if (targetRepMin !== null) return `${targetRepMin}+ reps`;
  if (targetRepMax !== null) return `≤${targetRepMax} reps`;
  return 'reps';
}

/**
 * Re-renders the set list and the per-exercise progress line after an htmx set
 * add/edit/delete. Keeping this as plain HTML (rather than a JSON response)
 * follows the AHA pattern and avoids a client store.
 */
export async function renderSetFragment(
  member: Member,
  sessionExerciseId: string,
  error: string | null = null,
): Promise<string | null> {
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

  const sets = await all<SetRow>(
    db()
      .prepare(
        `SELECT id, position, repetitions, load
         FROM completed_sets
         WHERE session_exercise_id = ?
         ORDER BY position ASC`,
      )
      .bind(sessionExerciseId),
  );

  const targetCount = Number(meta.targetSetCount);
  const repLabel = repTargetLabel(
    meta.targetRepMin === null ? null : Number(meta.targetRepMin),
    meta.targetRepMax === null ? null : Number(meta.targetRepMax),
  );
  const progress = `${sets.length} of ${targetCount} sets · ${repLabel}`;

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
  const totalSets = Number(totals?.totalSets ?? 0);
  const targetSets = Number(totals?.targetSets ?? 0);

  const setRows = sets
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
            hx-target="#sets-list-${escapeHtml(sessionExerciseId)}"
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

  return `
    <div id="sets-list-${escapeHtml(sessionExerciseId)}">
      ${error ? `<div class="form-error" style="margin-bottom:8px" role="alert">${escapeHtml(error)}</div>` : ''}
      ${setRows || '<p class="tiny muted" style="padding:8px 2px">No sets logged yet.</p>'}
    </div>
    <div id="progress-${escapeHtml(sessionExerciseId)}" hx-swap-oob="outerHTML" class="logger-target">
      ${escapeHtml(progress)}
    </div>
    <span id="session-total" hx-swap-oob="outerHTML">${totalSets}/${targetSets} sets</span>
    <span id="finish-total" hx-swap-oob="outerHTML">${totalSets} of ${targetSets}</span>
  `;
}
