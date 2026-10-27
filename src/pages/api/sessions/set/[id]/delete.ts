import type { APIContext } from 'astro';
import { db, one } from '../../../../../lib/db';
import { errorMessage } from '../../../../../lib/errors';
import { isMember, requireApiMember } from '../../../../../lib/http';
import { deleteSet } from '../../../../../lib/sessions';
import { renderSetFragment } from '../../../../../lib/session-view';

export async function POST(context: APIContext): Promise<Response> {
  const member = requireApiMember(context);
  if (!isMember(member)) return member;

  const setId = context.params.id ?? '';
  const owned = await one<{ sessionExerciseId: string }>(
    db()
      .prepare(
        `SELECT se.id AS sessionExerciseId
         FROM completed_sets cs
         JOIN session_exercises se ON se.id = cs.session_exercise_id
         JOIN sessions s ON s.id = se.session_id
         WHERE cs.id = ? AND s.member_id = ?`,
      )
      .bind(setId, member.id),
  );
  if (owned === null) return new Response('Set not found', { status: 404 });

  let error: string | null = null;
  try {
    await deleteSet(member, setId);
  } catch (caught) {
    error = errorMessage(caught);
  }

  const fragment = await renderSetFragment(member, owned.sessionExerciseId, error);
  if (fragment === null) return new Response('Exercise not found', { status: 404 });
  return new Response(fragment, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
