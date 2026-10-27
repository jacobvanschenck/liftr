import type { APIContext } from 'astro';
import { startSession } from '../../../lib/sessions';
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
  try {
    await startSession(
      member,
      formString(form, 'routineId'),
      formString(form, 'trainingDate'),
    );
    return redirect('/session');
  } catch (error) {
    return redirectWithError('/routines', errorMessage(error));
  }
}
