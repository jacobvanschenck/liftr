import { clerkMiddleware } from '@clerk/astro/server';
import { env } from 'cloudflare:workers';
import { findMemberByAuthUserId, findMemberById, provisionMember } from './lib/members';

/**
 * Clerk verifies the session and sets the first-party session cookie; then we
 * resolve the domain member. The two real members are seeded by the import, so
 * provisioning is only a first-sign-in safety net.
 */
export const onRequest = clerkMiddleware(async (auth, context, next) => {
  context.locals.member = null;

  const { userId } = auth();
  if (userId) {
    context.locals.member =
      (await findMemberByAuthUserId(userId)) ?? (await provisionMember(context, userId));
  } else if (env.DEV_AUTH_BYPASS === '1') {
    // Local-only shortcut for testing authenticated pages without a browser
    // session. Production never sets DEV_AUTH_BYPASS.
    const devMemberId = context.cookies.get('liftr_dev_member')?.value;
    if (devMemberId) {
      context.locals.member = await findMemberById(devMemberId);
    }
  }

  return next();
});
