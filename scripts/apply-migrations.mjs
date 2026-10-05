#!/usr/bin/env node
/**
 * Apply the SQL migrations in `supabase/migrations` in filename order.
 *
 * Usage:
 *   node scripts/apply-migrations.mjs                     # apply everything
 *   node scripts/apply-migrations.mjs --dry-run           # list what would run
 *   node scripts/apply-migrations.mjs --database-url=...  # override the env var
 *
 * The connection string is read from (in order):
 *   SUPABASE_DB_URL, DATABASE_URL, POSTGRES_URL
 *
 * Two execution paths are supported so this works on a laptop as well as in CI:
 *   1. The `pg` driver, when it is installed (`npm i -D pg`).
 *   2. The `psql` binary, when it is available on PATH.
 *
 * Applied migrations are recorded in `public.schema_migrations`, so the script
 * is safe to re-run.
 */

import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';

const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase', 'migrations');

function parseArgs(argv) {
  const options = { dryRun: false, databaseUrl: null, verbose: false };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--verbose') options.verbose = true;
    else if (arg.startsWith('--database-url=')) options.databaseUrl = arg.slice('--database-url='.length);
  }
  return options;
}

function resolveDatabaseUrl(explicit) {
  return (
    explicit ??
    process.env.SUPABASE_DB_URL ??
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    null
  );
}

async function loadMigrations() {
  const files = (await readdir(MIGRATIONS_DIR)).filter((file) => file.endsWith('.sql')).sort();
  const migrations = [];
  for (const file of files) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    migrations.push({
      name: file,
      sql,
      checksum: createHash('sha256').update(sql).digest('hex').slice(0, 16),
    });
  }
  return migrations;
}

async function importPg() {
  try {
    const module = await import('pg');
    return module.default ?? module;
  } catch {
    return null;
  }
}

function runPsql(databaseUrl, sql) {
  return new Promise((resolve, reject) => {
    const child = spawn('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-q', '-f', '-'], {
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`psql exited with code ${code}`))));
    child.stdin.write(sql);
    child.stdin.end();
  });
}

const BOOTSTRAP_SQL = `
create table if not exists public.schema_migrations (
  name       text primary key,
  checksum   text not null,
  applied_at timestamptz not null default now()
);
`;

async function main() {
  const options = parseArgs(process.argv);
  const databaseUrl = resolveDatabaseUrl(options.databaseUrl);
  const migrations = await loadMigrations();

  if (migrations.length === 0) {
    console.error('No migrations found in supabase/migrations.');
    process.exit(1);
  }

  console.log(`Found ${migrations.length} migration(s):`);
  for (const migration of migrations) {
    console.log(`  • ${migration.name}  (sha256:${migration.checksum})`);
  }

  if (options.dryRun) {
    console.log('\n--dry-run: nothing was applied.');
    return;
  }

  if (!databaseUrl) {
    console.error(
      [
        '',
        'A database connection string is required.',
        '',
        'Set SUPABASE_DB_URL (Supabase dashboard → Project settings → Database → Connection string),',
        'then run this script again, or paste the migration files into the Supabase SQL editor.',
        'See README.md → “Database setup” for the step-by-step guide.',
        '',
      ].join('\n'),
    );
    process.exit(1);
  }

  const pg = await importPg();
  const apply = async (sql) => {
    if (pg) {
      const client = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
      await client.connect();
      try {
        await client.query(sql);
      } finally {
        await client.end();
      }
      return;
    }
    await runPsql(databaseUrl, sql);
  };

  await apply(BOOTSTRAP_SQL);

  const applied = new Set();
  if (pg) {
    const client = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
    await client.connect();
    try {
      const result = await client.query('select name, checksum from public.schema_migrations');
      for (const row of result.rows) {
        applied.add(row.name);
        const match = migrations.find((migration) => migration.name === row.name);
        if (match && match.checksum !== row.checksum) {
          console.error(
            `Migration ${row.name} was modified after it was applied (checksum mismatch). Create a new migration instead of editing history.`,
          );
          process.exit(1);
        }
      }
    } finally {
      await client.end();
    }
  }

  let count = 0;
  for (const migration of migrations) {
    if (applied.has(migration.name)) {
      if (options.verbose) console.log(`= ${migration.name} already applied`);
      continue;
    }
    process.stdout.write(`→ applying ${migration.name} … `);
    try {
      await apply(migration.sql);
      await apply(
        `insert into public.schema_migrations (name, checksum) values ('${migration.name}', '${migration.checksum}') on conflict (name) do nothing;`,
      );
      console.log('done');
      count += 1;
    } catch (error) {
      console.log('failed');
      console.error(`\n${migration.name} failed: ${error.message}`);
      console.error('Migrations run in order and are not transactional as a batch — fix the error and re-run.');
      process.exit(1);
    }
  }

  console.log(
    count === 0
      ? '\nDatabase is already up to date.'
      : `\nApplied ${count} migration(s). Row-level security, functions and realtime are now in place.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
