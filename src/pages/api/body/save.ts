import type { APIContext } from 'astro';
import { saveBodyEntry } from '../../../lib/body';
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

  const values: { metricId: string; value: number | null }[] = [];
  for (const [key, raw] of form.entries()) {
    if (!key.startsWith('value:') || typeof raw !== 'string') continue;
    const metricId = key.slice('value:'.length);
    const trimmed = raw.trim();
    values.push({ metricId, value: trimmed === '' ? null : Number(trimmed) });
  }

  try {
    await saveBodyEntry(member, date, values);
    return redirect(`/body?date=${encodeURIComponent(date)}`);
  } catch (error) {
    return redirectWithError(`/body?date=${encodeURIComponent(date)}`, errorMessage(error));
  }
}
