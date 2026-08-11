import db, { dbDriver } from '../database.js';
import { sqliteSqlToPostgres, qmarkToDollar } from './sql-dialect.js';

export function runSql(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

export function getSql(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row || null);
    });
  });
}

export function allSql(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

/** Exclusive checkout / lock races — SQLite BEGIN IMMEDIATE; Postgres BEGIN */
export async function withImmediateTransaction(fn) {
  const begin = dbDriver === 'postgres' ? 'BEGIN' : 'BEGIN IMMEDIATE';
  await runSql(begin);
  try {
    const result = await fn({ runSql, getSql, allSql });
    await runSql('COMMIT');
    return result;
  } catch (err) {
    try {
      await runSql('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  }
}

/** Dev helper — normalize SQL the same way Postgres driver does */
export function debugNormalizeSql(sql) {
  return qmarkToDollar(sqliteSqlToPostgres(sql));
}

export { dbDriver };
