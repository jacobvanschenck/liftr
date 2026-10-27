import type { APIContext } from 'astro';
import { updateRoutine } from '../../../../lib/routines';
import { errorMessage } from '../../../../lib/errors';
import {
  formString,
  isMember,
  redirect,
  redirectWithDraft,
  requireApiMember,
} from '../../../../lib/http';
import { parseRoutineItems } from '../create';

export async function POST(context: APIContext): Promise<Response> {
  const member = requireApiMember(context);
  if (!isMember(member)) return member;

  const id = context.params.id ?? '';
  const form = await context.request.formData();
  const name = formString(form, 'name');
  const itemsRaw = formString(form, 'items');

  try {
    const items = parseRoutineItems(itemsRaw);
    await updateRoutine(member, id, name, items);
    return redirect('/routines');
  } catch (error) {
    return redirectWithDraft(`/routines/${id}/edit`, name, itemsRaw, errorMessage(error));
  }
}
