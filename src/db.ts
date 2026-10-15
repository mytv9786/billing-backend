import mysql from "mysql2/promise";
import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";
import { config } from "./config";

export type SqlParam = string | number | boolean | null | Date;

export const pool: Pool = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  connectionLimit: 10,
  decimalNumbers: true, // DECIMAL ni number ga isthundi (string kaadu)
  dateStrings: true, // DATE ni "YYYY-MM-DD" string ga isthundi (timezone shift raadu)
});

export async function query<T extends RowDataPacket>(
  sql: string,
  params: SqlParam[] = [],
): Promise<T[]> {
  const [rows] = await pool.execute<T[]>(sql, params);
  return rows;
}

export async function exec(
  sql: string,
  params: SqlParam[] = [],
): Promise<ResultSetHeader> {
  const [result] = await pool.execute<ResultSetHeader>(sql, params);
  return result;
}

export async function withTransaction<T>(
  fn: (conn: PoolConnection) => Promise<T>,
): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
