import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

// Tạo lại database authz_test từ db/0001..0003 trước mỗi lần chạy test,
// để mọi test bắt đầu từ cùng dữ liệu demo (SPEC §15).
export default async function setup(): Promise<void> {
  const url = new URL(process.env.DATABASE_URL ?? 'postgres://authz:authz@localhost:5433/authz_test');
  const dbName = url.pathname.slice(1);
  const admin = new URL(url);
  admin.pathname = '/postgres';

  const adminClient = new pg.Client({ connectionString: admin.toString() });
  await adminClient.connect();
  await adminClient.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await adminClient.query(`CREATE DATABASE ${dbName}`);
  await adminClient.end();

  const dbDir = join(import.meta.dirname, '../../../db');
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  for (const file of readdirSync(dbDir).filter((f) => /^\d+_.*\.sql$/.test(f)).sort()) {
    await client.query(readFileSync(join(dbDir, file), 'utf8'));
  }
  await client.end();
}
