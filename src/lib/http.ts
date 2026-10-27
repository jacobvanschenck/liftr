import type { APIContext } from 'astro';
import type { Member } from './types';

export function isHtmx(request: Request): boolean {
  return request.headers.get('HX-Request') === 'true';
}

export function redirect(location: string, status = 303): Response {
  return new Response(null, { status, headers: { Location: location } });
}

export function redirectWithError(location: string, message: string): Response {
  const url = new URL(location, 'https://liftr.local');
  url.searchParams.set('error', message);
  return redirect(`${url.pathname}${url.search}`);
}

export function redirectWithDraft(
  location: string,
  name: string,
  items: string,
  message: string,
): Response {
  const params = new URLSearchParams({ error: message, name, items });
  return redirect(`${location}?${params.toString()}`);
}

export function unauthorized(context: APIContext): Response {
  if (isHtmx(context.request)) {
    return new Response(null, { status: 401, headers: { 'HX-Redirect': '/sign-in' } });
  }
  return redirect('/sign-in');
}

export function requireApiMember(context: APIContext): Member | Response {
  return context.locals.member ?? unauthorized(context);
}

export function isMember(value: Member | Response): value is Member {
  return !(value instanceof Response);
}

export function formString(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
}

export function formNumber(form: FormData, key: string): number {
  return Number(formString(form, key));
}

export function formNullableNumber(form: FormData, key: string): number | null {
  const raw = formString(form, key).trim();
  if (raw === '') return null;
  return Number(raw);
}

export function formBoolean(form: FormData, key: string): boolean {
  return form.get(key) === '1' || form.get(key) === 'on' || form.get(key) === 'true';
}

export function sameOriginRedirect(context: APIContext, fallback: string): string {
  const referer = context.request.headers.get('referer');
  if (referer) {
    try {
      const url = new URL(referer);
      if (url.origin === new URL(context.request.url).origin) {
        return `${url.pathname}${url.search}`;
      }
    } catch {
      // Fall through.
    }
  }
  return fallback;
}
