import type { APIContext } from 'astro';
import {
  applySetCommand,
  renderSetFragment,
  type SetCommand,
} from '../../../../lib/session-logger';
import {
  formNumber,
  formString,
  isMember,
  requireApiMember,
} from '../../../../lib/http';

export async function POST(context: APIContext): Promise<Response> {
  const member = requireApiMember(context);
  if (!isMember(member)) return member;

  const form = await context.request.formData();
  const sessionExerciseId = formString(form, 'sessionExerciseId');
  const setId = formString(form, 'setId').trim();
  const repetitions = formNumber(form, 'reps');
  const load = formNumber(form, 'load');

  const command: SetCommand =
    setId === ''
      ? { type: 'add', sessionExerciseId, repetitions, load }
      : { type: 'update', setId, repetitions, load };

  const result = await applySetCommand(member, command);
  if (result === null) {
    return new Response(command.type === 'update' ? 'Set not found' : 'Exercise not found', {
      status: 404,
    });
  }

  return new Response(renderSetFragment(result.fragment, result.error), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
