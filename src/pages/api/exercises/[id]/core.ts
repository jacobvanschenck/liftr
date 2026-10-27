import type { APIContext } from 'astro';
import { setExerciseCore } from '../../../../lib/exercises';
import { errorMessage } from '../../../../lib/errors';
import {
  formBoolean,
  isMember,
  redirect,
  redirectWithError,
  requireApiMember,
} from '../../../../lib/http';

export async function POST(context: APIContext): Promise<Response> {
  const member = requireApiMember(context);
  if (!isMember(member)) return member;

  const form = await context.request.formData();
  const id = context.params.id ?? '';

  try {
    await setExerciseCore(member, id, formBoolean(form, 'isCore'));
    return redirect('/exercises');
  } catch (error) {
    return redirectWithError('/exercises', errorMessage(error));
  }
}
