import type { APIContext } from 'astro';
import { addSet, updateSet } from '../../../../lib/sessions';
import { errorMessage } from '../../../../lib/errors';
import {
  formNumber,
  formString,
  isMember,
  requireApiMember,
} from '../../../../lib/http';
import { renderSetFragment } from '../../../../lib/session-view';

export async function POST(context: APIContext): Promise<Response> {
  const member = requireApiMember(context);
  if (!isMember(member)) return member;

  const form = await context.request.formData();
  const sessionExerciseId = formString(form, 'sessionExerciseId');
  const setId = formString(form, 'setId').trim();
  const repetitions = formNumber(form, 'reps');
  const load = formNumber(form, 'load');

  let error: string | null = null;
  try {
    if (setId === '') {
      await addSet(member, sessionExerciseId, repetitions, load);
    } else {
      await updateSet(member, setId, repetitions, load);
    }
  } catch (caught) {
    error = errorMessage(caught);
  }

  const fragment = await renderSetFragment(member, sessionExerciseId, error);
  if (fragment === null) return new Response('Exercise not found', { status: 404 });
  return new Response(fragment, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
