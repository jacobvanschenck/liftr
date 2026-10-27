import { clerkClient } from '@clerk/astro/server';
import type { APIContext } from 'astro';
import { env } from 'cloudflare:workers';
import { db, one, uuid } from './db';
import type { Member } from './types';

type MemberRow = {
  id: string;
  familyId: string;
  authUserId: string | null;
  email: string | null;
  name: string;
  timezone: string;
  createdAt: number;
};

const MEMBER_COLUMNS = `
  id,
  family_id AS familyId,
  auth_user_id AS authUserId,
  email,
  name,
  timezone,
  created_at AS createdAt
`;

export async function findMemberByAuthUserId(authUserId: string): Promise<Member | null> {
  return one<MemberRow>(
    db()
      .prepare(`SELECT ${MEMBER_COLUMNS} FROM members WHERE auth_user_id = ?`)
      .bind(authUserId),
  );
}

export async function findMemberById(id: string): Promise<Member | null> {
  return one<MemberRow>(
    db().prepare(`SELECT ${MEMBER_COLUMNS} FROM members WHERE id = ?`).bind(id),
  );
}

function allowedAuthUserIds(): string[] {
  return String(env.ALLOWED_CLERK_USER_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

export function isAllowedAuthUserId(authUserId: string): boolean {
  return allowedAuthUserIds().includes(authUserId);
}

/**
 * First sign-in safety net. The two real members are seeded by the migration,
 * so this only runs if a member row is missing (fresh database or a new
 * allowlisted Clerk user).
 */
export async function provisionMember(
  context: APIContext,
  authUserId: string,
): Promise<Member | null> {
  if (!isAllowedAuthUserId(authUserId)) return null;

  const existing = await findMemberByAuthUserId(authUserId);
  if (existing !== null) return existing;

  let email: string | null = null;
  let name = 'Liftr member';
  try {
    const user = await clerkClient(context).users.getUser(authUserId);
    email = user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? null;
    name = user.firstName?.trim() || user.fullName?.trim() || name;
  } catch {
    // The session is valid; a profile fetch failure should not lock the user out.
  }

  const family = await one<{ id: string; slug: string }>(
    db().prepare('SELECT id, slug FROM families ORDER BY created_at ASC LIMIT 1'),
  );
  if (family === null) return null;

  const id = uuid();
  await db()
    .prepare(
      `INSERT INTO members (id, family_id, auth_user_id, email, name, timezone, created_at)
       VALUES (?, ?, ?, ?, ?, 'America/Chicago', ?)`,
    )
    .bind(id, family.id, authUserId, email, name, Date.now())
    .run();

  return findMemberById(id);
}
