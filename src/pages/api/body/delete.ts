import type { APIContext } from 'astro';
import { deleteBodyEntry } from '../../../lib/body';
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
  const date = formString(form, 'date');

  try {
    await deleteBodyEntry(member, date);
    return redirect(`/body?date=${encodeURIComponent(date)}`);
  } catch (error) {
    return redirectWithError(`/body?date=${encodeURIComponent(date)}`, errorMessage(error));
  }
}
