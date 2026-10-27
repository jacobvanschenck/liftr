import type { APIContext } from 'astro';
import { createRoutine, type RoutineItemInput } from '../../../lib/routines';
import { errorMessage } from '../../../lib/errors';
import {
  formString,
  isMember,
  redirect,
  redirectWithDraft,
  requireApiMember,
} from '../../../lib/http';

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  return Number(value);
}

export function parseRoutineItems(raw: string): RoutineItemInput[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('Routine exercises are invalid.');
  return parsed.map((item) => {
    if (typeof item !== 'object' || item === null) {
      throw new Error('Routine exercises are invalid.');
    }
    const value = item as Record<string, unknown>;
    return {
      exerciseId: String(value.exerciseId ?? ''),
      targetSetCount: Number(value.targetSetCount),
      targetRepMin: nullableNumber(value.targetRepMin),
      targetRepMax: nullableNumber(value.targetRepMax),
    };
  });
}

export async function POST(context: APIContext): Promise<Response> {
  const member = requireApiMember(context);
  if (!isMember(member)) return member;

  const form = await context.request.formData();
  const name = formString(form, 'name');
  const itemsRaw = formString(form, 'items');

  try {
    const items = parseRoutineItems(itemsRaw);
    await createRoutine(member, name, items);
    return redirect('/routines');
  } catch (error) {
    return redirectWithDraft('/routines/new', name, itemsRaw, errorMessage(error));
  }
}
