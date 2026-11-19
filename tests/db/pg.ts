import EmbeddedPostgres from 'embedded-postgres'
import pg from 'pg'
import { createServer } from 'node:net'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SUPABASE_STUB } from './harness'

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'supabase', 'migrations')

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port
      s.close(() => resolve(port))
    })
    s.on('error', reject)
  })
}

export interface RealDb {
  /** Koneksi superuser (melewati RLS) */
  admin: pg.Pool
  createUser(email: string, role?: 'ADMIN' | 'WAREHOUSE' | 'VIEWER'): Promise<string>
  /** Satu panggilan sebagai pengguna (RLS berlaku). Transaksi di-commit jika sukses. */
  callAs(userId: string | null, sql: string, params?: unknown[], role?: 'authenticated' | 'anon'): Promise<pg.QueryResult>
  stop(): Promise<void>
}

/** Postgres sungguhan (multi-koneksi) untuk menguji konkurensi, kunci baris, dan deadlock. */
export async function startRealDb(): Promise<RealDb> {
  const dir = mkdtempSync(join(tmpdir(), 'whistle-pg-'))
  const port = await freePort()
  const server = new EmbeddedPostgres({
    databaseDir: dir,
    user: 'postgres',
    password: 'whistle',
    port,
    persistent: false,
    onLog: () => {},
    onError: () => {},
  })
  await server.initialise()
  await server.start()

  const admin = new pg.Pool({ host: '127.0.0.1', port, user: 'postgres', password: 'whistle', database: 'postgres', max: 30 })
  // Saat server dimatikan, koneksi menganggur menerima FATAL 57P01 ("terminating connection due to
  // administrator command"). Itu normal; tanpa handler, pg melempar error yang tidak tertangani.
  admin.on('error', () => {})
  await admin.query(SUPABASE_STUB)
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
  for (const f of files) await admin.query(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))

  return {
    admin,
    async createUser(email, role = 'VIEWER') {
      const r = await admin.query(`insert into auth.users (email) values ($1) returning id`, [email])
      const id = r.rows[0].id as string
      if (role !== 'VIEWER') await admin.query(`update public.user_roles set role = $1 where user_id = $2`, [role, id])
      return id
    },
    async callAs(userId, sql, params = [], role = 'authenticated') {
      const c = await admin.connect()
      c.on('error', () => {})
      try {
        await c.query('begin')
        await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(userId ? { sub: userId } : {})])
        await c.query(`set local role ${role}`)
        const res = await c.query(sql, params)
        await c.query('commit')
        return res
      } catch (e) {
        await c.query('rollback').catch(() => {})
        throw e
      } finally {
        c.release()
      }
    },
    async stop() {
      await admin.end().catch(() => {})
      await server.stop().catch(() => {})
      try {
        // Windows kadang masih mengunci berkas Postgres sesaat setelah berhenti
        rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
      } catch {
        // direktori sementara di folder temp OS; sisa berkas tidak memengaruhi hasil tes
      }
    },
  }
}
