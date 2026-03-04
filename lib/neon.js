import { neon } from '@neondatabase/serverless';

let sqlClient = null;

export function getNeonSql() {
  const url = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL || '';
  if (!url) return null;
  if (!sqlClient) sqlClient = neon(url);
  return sqlClient;
}
