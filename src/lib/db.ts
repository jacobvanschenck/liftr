import { env } from 'cloudflare:workers';

export function db(): D1Database {
  return env.DB;
}

export async function one<T>(statement: D1PreparedStatement): Promise<T | null> {
  return (await statement.first<T>()) ?? null;
}

export async function all<T>(statement: D1PreparedStatement): Promise<T[]> {
  const result = await statement.all<T>();
  return result.results ?? [];
}

export async function run(statement: D1PreparedStatement): Promise<D1Result> {
  return statement.run();
}

export function uuid(): string {
  return crypto.randomUUID();
}
