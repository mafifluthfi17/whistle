import { PGlite } from '@electric-sql/pglite'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'supabase', 'migrations')

// Meniru lingkungan Supabase: role anon/authenticated, schema auth, dan auth.uid().
const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated;
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'), '')::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
`

export type DbRole = 'authenticated' | 'anon'

export interface TestDb {
  db: PGlite
  createUser(email: string, role?: 'ADMIN' | 'WAREHOUSE' | 'VIEWER', name?: string): Promise<string>
  /** Jalankan fn sebagai pengguna tertentu (RLS berlaku), lalu kembali ke superuser. */
  as<T>(userId: string | null, fn: () => Promise<T>, role?: DbRole): Promise<T>
}

export async function createTestDb(): Promise<TestDb> {
  const db = new PGlite()
  await db.exec(SUPABASE_STUB)
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
  for (const f of files) await db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))

  return {
    db,
    async createUser(email, role = 'VIEWER', name = email) {
      const r = await db.query<{ id: string }>(
        `insert into auth.users (email, raw_user_meta_data) values ($1, jsonb_build_object('full_name', $2::text)) returning id`,
        [email, name],
      )
      const id = r.rows[0].id
      if (role !== 'VIEWER') await db.query(`update public.user_roles set role = $1 where user_id = $2`, [role, id])
      return id
    },
    async as(userId, fn, role = 'authenticated') {
      const claims = JSON.stringify(userId ? { sub: userId } : {})
      await db.query(`select set_config('request.jwt.claims', $1, false)`, [claims])
      await db.exec(`set role ${role}`)
      try {
        return await fn()
      } finally {
        await db.exec('reset role')
        await db.query(`select set_config('request.jwt.claims', '', false)`)
      }
    },
  }
}
