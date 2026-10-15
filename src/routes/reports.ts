import { Router } from "express";
import { z } from "zod";
import type { RowDataPacket } from "mysql2/promise";
import { query, type SqlParam } from "../db";
import { asyncHandler, parse } from "../http";
import { tenantId } from "../middleware/auth";
import { round2 } from "../utils";

const router = Router();

const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date (YYYY-MM-DD)");
const rangeSchema = z.object({
  from: dateStr.optional(),
  to: dateStr.optional(),
  group: z.enum(["day", "month"]).default("day"),
});

router.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const did = tenantId(req);
    const f = parse(rangeSchema, req.query);

    const params: SqlParam[] = [did];
    let range = "";
    if (f.from) {
      range += " AND i.invoice_date >= ?";
      params.push(f.from);
    }
    if (f.to) {
      range += " AND i.invoice_date <= ?";
      params.push(f.to);
    }
    const base = `WHERE i.distributor_id = ?${range}`;
    const keyExpr =
      f.group === "month"
        ? "DATE_FORMAT(i.invoice_date, '%Y-%m')"
        : "i.invoice_date";

    const [totals, series, employees, products, dues] = await Promise.all([
      query<RowDataPacket>(
        `SELECT COUNT(*) AS cnt, COALESCE(SUM(i.total), 0) AS billed, COALESCE(SUM(i.received), 0) AS received
         FROM invoices i ${base}`,
        params,
      ),
      // query<RowDataPacket>(
      //   `SELECT ${keyExpr} AS k, SUM(i.total) AS total FROM invoices i ${base} GROUP BY k ORDER BY k`,
      //   params,
      // ),
      query<RowDataPacket>(
        `SELECT ${keyExpr} AS k, SUM(i.total) AS total, SUM(i.received) AS received
         FROM invoices i ${base} GROUP BY k ORDER BY k`,
        params,
      ),
      query<RowDataPacket>(
        `SELECT i.created_by AS user_id, u.name, COUNT(*) AS cnt, SUM(i.total) AS billed, SUM(i.received) AS received
         FROM invoices i LEFT JOIN users u ON u.id = i.created_by ${base}
         GROUP BY i.created_by, u.name ORDER BY billed DESC`,
        params,
      ),
      query<RowDataPacket>(
        `SELECT ii.product_id, p.name, SUM(ii.qty) AS qty, SUM(ii.qty * ii.price) AS revenue
         FROM invoice_items ii
         JOIN invoices i ON i.id = ii.invoice_id
         JOIN products p ON p.id = ii.product_id ${base}
         GROUP BY ii.product_id, p.name ORDER BY revenue DESC LIMIT 5`,
        params,
      ),
      // Outstanding dues: all time, range tho sambandham ledu
      query<RowDataPacket>(
        `SELECT c.id, c.name, SUM(i.total - i.received) AS due
         FROM invoices i JOIN customers c ON c.id = i.customer_id
         WHERE i.distributor_id = ?
         GROUP BY c.id, c.name HAVING due > 0 ORDER BY due DESC LIMIT 5`,
        [did],
      ),
    ]);

    const billed = Number(totals[0].billed);
    const received = Number(totals[0].received);

    res.json({
      range: { from: f.from ?? null, to: f.to ?? null, group: f.group },
      totals: {
        count: Number(totals[0].cnt),
        billed,
        received,
        due: round2(billed - received),
      },
      series: series.map((r) => ({
        key: String(r.k),
        total: Number(r.total),
        received: Number(r.received),
      })),
      byEmployee: employees.map((r) => ({
        userId: (r.user_id as number | null) ?? null,
        name: (r.name as string | null) ?? null,
        count: Number(r.cnt),
        billed: Number(r.billed),
        received: Number(r.received),
      })),
      topProducts: products.map((r) => ({
        productId: r.product_id as number,
        name: r.name as string,
        qty: Number(r.qty),
        revenue: Number(r.revenue),
      })),
      topDues: dues.map((r) => ({
        customerId: r.id as number,
        name: r.name as string,
        due: Number(r.due),
      })),
    });
  }),
);

export default router;
