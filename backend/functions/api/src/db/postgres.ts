import { Pool } from 'pg';

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      host: process.env.DB_HOST!,
      database: process.env.DB_NAME || 'babynames',
      user: process.env.DB_USER || 'babynames',
      password: process.env.DB_PASSWORD!,
      port: 5432,
      max: 2,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
      ssl: false,
    });
  }
  return pool;
}
