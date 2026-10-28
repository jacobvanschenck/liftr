import type { APIContext } from 'astro';
import { applySetCommand, renderSetFragment } from '../../../../../lib/session-logger';
import { isMember, requireApiMember } from '../../../../../lib/http';

export async function POST(context: APIContext): Promise<Response> {
  const member = requireApiMember(context);
  if (!isMember(member)) return member;

  const setId = context.params.id ?? '';
  const result = await applySetCommand(member, { type: 'delete', setId });
  if (result === null) return new Response('Set not found', { status: 404 });

  return new Response(renderSetFragment(result.fragment, result.error), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
