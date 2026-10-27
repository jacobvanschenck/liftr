import type { APIContext } from 'astro';
import { createExercise } from '../../../lib/exercises';
import { errorMessage } from '../../../lib/errors';
import {
  formString,
  isMember,
  redirect,
  redirectWithError,
  requireApiMember,
} from '../../../lib/http';

export async function POST(context: APIContext): Promise<Response> {
  const member = requireApiMember(context);
  if (!isMember(member)) return member;

  const form = await context.request.formData();
  const name = formString(form, 'name');
  const equipmentCategory = formString(form, 'equipmentCategory');

  try {
    await createExercise(member, name, equipmentCategory);
    return redirect('/exercises?created=1');
  } catch (error) {
    return redirectWithError('/exercises', errorMessage(error));
  }
}
