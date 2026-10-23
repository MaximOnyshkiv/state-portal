// Unified DB layer: Postgres when DATABASE_URL is set, otherwise SQLite (better-sqlite3).
const path = require('path'), fs = require('fs');
const PG = !!process.env.DATABASE_URL;
let pool, sdb;
const conv = (sql) => { let i = 0; return sql.replace(/\?/g, () => '$' + (++i)); };
async function init(schemaFn, dbName) {
  if (PG) {
    const { Pool } = require('pg');
    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false } });
    for (const s of schemaFn(true)) await pool.query(s);
  } else {
    const Database = require('better-sqlite3');
    const file = process.env.SQLITE_PATH || path.join(__dirname, '..', 'data', dbName);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    sdb = new Database(file); sdb.pragma('journal_mode = WAL');
    for (const s of schemaFn(false)) sdb.exec(s);
  }
}
async function all(sql, p = []) { if (PG) return (await pool.query(conv(sql), p)).rows; return sdb.prepare(sql).all(...p); }
async function get(sql, p = []) { return (await all(sql, p))[0]; }
async function run(sql, p = []) {
  if (PG) { const r = await pool.query(conv(sql) + (/^\s*insert/i.test(sql) && !/returning/i.test(sql) && !/into\s+(sessions|kv|sso_used)\b/i.test(sql) ? ' RETURNING id' : ''), p); return { changes: r.rowCount, id: r.rows[0] && r.rows[0].id }; }
  const r = sdb.prepare(sql).run(...p); return { changes: r.changes, id: Number(r.lastInsertRowid) };
}
module.exports = { init, all, get, run, isPg: PG };
