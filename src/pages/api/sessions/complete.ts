import type { APIContext } from 'astro';
import { completeSession } from '../../../lib/sessions';
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
    await completeSession(member, formString(form, 'sessionId'));
    return redirect('/routines');
  } catch (error) {
    return redirectWithError('/session', errorMessage(error));
  }
}
