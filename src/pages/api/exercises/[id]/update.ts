import type { APIContext } from 'astro';
import { updateExercise } from '../../../../lib/exercises';
import { errorMessage } from '../../../../lib/errors';
import {
  formBoolean,
  formString,
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
    await updateExercise(
      member,
      id,
      formString(form, 'name'),
      formString(form, 'equipmentCategory'),
      formBoolean(form, 'isCore'),
    );
    return redirect(`/exercises/${id}`);
  } catch (error) {
    return redirectWithError(`/exercises/${id}/edit`, errorMessage(error));
  }
}
