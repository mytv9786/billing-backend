import { Router } from "express";
import { z } from "zod";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { query, withTransaction, type SqlParam } from "../db";
import { asyncHandler, HttpError, parse, parseId } from "../http";
import { currentUser, requireRole, tenantId } from "../middleware/auth";
import { round2, todayISO } from "../utils";

const router = Router();

const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date (YYYY-MM-DD)");

const paymentSchema = z.object({
  amount: z.number().positive("Enter a valid amount").max(100_000_000),
  mode: z.enum(["cash", "upi", "card"]),
});

const createSchema = z.object({
  customerId: z.number().int().positive("Select a customer"),
  items: z
    .array(
      z.object({
        productId: z.number().int().positive(),
        qty: z
          .number()
          .int()
          .min(1, "Quantity must be at least 1")
          .max(100_000),
      }),
    )
    .min(1, "Add at least one product")
    .max(200),
  discount: z.number().min(0, "Invalid discount").max(100_000_000).default(0),
  payment: paymentSchema.optional(),
});

const listSchema = z.object({
  status: z.enum(["paid", "partial", "unpaid"]).optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

interface InvoiceRow extends RowDataPacket {
  id: number;
  distributor_id: number;
  invoice_no: string;
  customer_id: number;
  customer_name: string;
  created_by: number | null;
  billed_by: string | null;
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  received: number;
  invoice_date: string;
}

interface ProductLockRow extends RowDataPacket {
  id: number;
  name: string;
  price: number;
  tax_percent: number;
  stock: number;
}

const listSql = `
  SELECT i.id, i.distributor_id, i.invoice_no, i.customer_id, c.name AS customer_name,
    i.created_by, u.name AS billed_by, i.subtotal, i.tax, i.discount, i.total, i.received, i.invoice_date
  FROM invoices i
  JOIN customers c ON c.id = i.customer_id
  LEFT JOIN users u ON u.id = i.created_by`;

const toInvoice = (r: InvoiceRow) => ({
  id: r.id,
  distributorId: r.distributor_id,
  no: r.invoice_no,
  customerId: r.customer_id,
  customer: r.customer_name,
  createdBy: r.created_by ?? undefined,
  billedBy: r.billed_by ?? undefined,
  subtotal: r.subtotal,
  tax: r.tax,
  discount: r.discount,
  total: r.total,
  received: r.received,
  date: r.invoice_date,
});

async function getDetail(did: number, id: number) {
  const rows = await query<InvoiceRow>(
    `${listSql} WHERE i.id = ? AND i.distributor_id = ?`,
    [id, did],
  );
  if (!rows[0]) return null;
  const items = await query<RowDataPacket>(
    `SELECT ii.product_id, p.name, ii.qty, ii.price, ii.tax_percent
     FROM invoice_items ii JOIN products p ON p.id = ii.product_id
     WHERE ii.invoice_id = ? ORDER BY ii.id`,
    [id],
  );
  const payments = await query<RowDataPacket>(
    "SELECT id, amount, mode, payment_date FROM payments WHERE invoice_id = ? AND distributor_id = ? ORDER BY id",
    [id, did],
  );
  return {
    ...toInvoice(rows[0]),
    items: items.map((r) => ({
      productId: r.product_id as number,
      name: r.name as string,
      qty: r.qty as number,
      price: r.price as number,
      taxPercent: r.tax_percent as number,
    })),
    payments: payments.map((r) => ({
      id: r.id as number,
      amount: r.amount as number,
      mode: r.mode as string,
      date: r.payment_date as string,
    })),
  };
}

// Dashboard cards ki (anni roles)
router.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const rows = await query<RowDataPacket>(
      `SELECT COUNT(*) AS cnt, COALESCE(SUM(total), 0) AS billed, COALESCE(SUM(received), 0) AS received
       FROM invoices WHERE distributor_id = ?`,
      [tenantId(req)],
    );
    const billed = Number(rows[0].billed);
    const received = Number(rows[0].received);
    res.json({
      count: Number(rows[0].cnt),
      billed,
      received,
      due: round2(billed - received),
    });
  }),
);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const f = parse(listSchema, req.query);
    const where: string[] = ["i.distributor_id = ?"];
    const params: SqlParam[] = [tenantId(req)];

    if (f.status === "paid")
      where.push("i.received > 0 AND i.received >= i.total");
    if (f.status === "partial")
      where.push("i.received > 0 AND i.received < i.total");
    if (f.status === "unpaid") where.push("i.received <= 0");
    if (f.from) {
      where.push("i.invoice_date >= ?");
      params.push(f.from);
    }
    if (f.to) {
      where.push("i.invoice_date <= ?");
      params.push(f.to);
    }
    if (f.q) {
      const like = `%${f.q.replace(/[\\%_]/g, "\\$&")}%`;
      where.push("(i.invoice_no LIKE ? OR c.name LIKE ?)");
      params.push(like, like);
    }

    // limit/offset validated integers, so safe ga direct ga pettochu
    const rows = await query<InvoiceRow>(
      `${listSql} WHERE ${where.join(" AND ")} ORDER BY i.id DESC LIMIT ${f.limit} OFFSET ${f.offset}`,
      params,
    );
    res.json(rows.map(toInvoice));
  }),
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const detail = await getDetail(tenantId(req), parseId(req.params.id));
    if (!detail) throw new HttpError(404, "Invoice not found");
    res.json(detail);
  }),
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const did = tenantId(req);
    const me = currentUser(req);
    const body = parse(createSchema, req.body);

    // Same product rendu sarlu pettina qty merge chestam
    const qtyById = new Map<number, number>();
    body.items.forEach((it) =>
      qtyById.set(it.productId, (qtyById.get(it.productId) ?? 0) + it.qty),
    );
    const ids = [...qtyById.keys()].sort((a, b) => a - b);

    const invoiceId = await withTransaction(async (conn) => {
      const [cust] = await conn.execute<RowDataPacket[]>(
        "SELECT id FROM customers WHERE id = ? AND distributor_id = ?",
        [body.customerId, did],
      );
      if (cust.length === 0) throw new HttpError(400, "Customer not found");

      // Products lock chestam (id order lo, deadlock raakunda), appudu stock safe
      const ph = ids.map(() => "?").join(",");
      const [prods] = await conn.execute<ProductLockRow[]>(
        `SELECT id, name, price, tax_percent, stock FROM products
         WHERE distributor_id = ? AND id IN (${ph}) ORDER BY id FOR UPDATE`,
        [did, ...ids],
      );
      if (prods.length !== ids.length)
        throw new HttpError(400, "Some products were not found");

      let subtotal = 0;
      let tax = 0;
      const lines = prods.map((p) => {
        const qty = qtyById.get(p.id) ?? 0;
        if (qty > p.stock)
          throw new HttpError(
            409,
            `Not enough stock for ${p.name} (available ${p.stock})`,
          );
        const amount = round2(qty * p.price); // price DB nundi, client nundi kaadu
        subtotal = round2(subtotal + amount);
        tax = round2(tax + round2((amount * p.tax_percent) / 100));
        return {
          productId: p.id,
          qty,
          price: p.price,
          taxPercent: p.tax_percent,
        };
      });

      const discount = round2(body.discount);
      if (discount > round2(subtotal + tax))
        throw new HttpError(400, "Invalid discount");
      const total = round2(subtotal + tax - discount);

      const received = body.payment ? round2(body.payment.amount) : 0;
      if (received > total)
        throw new HttpError(400, "Received amount cannot be more than total");

      // Atomic invoice number: distributor row lock avtundi, so duplicates raavu
      await conn.execute(
        "UPDATE distributors SET invoice_seq = LAST_INSERT_ID(invoice_seq + 1) WHERE id = ?",
        [did],
      );
      const [seqRows] = await conn.execute<RowDataPacket[]>(
        "SELECT LAST_INSERT_ID() AS seq, (SELECT invoice_prefix FROM distributors WHERE id = ?) AS prefix",
        [did],
      );
      const invoiceNo = `${seqRows[0].prefix as string}-${String(seqRows[0].seq).padStart(3, "0")}`;

      const today = todayISO();
      const [ins] = await conn.execute<ResultSetHeader>(
        `INSERT INTO invoices
         (distributor_id, invoice_no, customer_id, created_by, subtotal, tax, discount, total, received, invoice_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          did,
          invoiceNo,
          body.customerId,
          me.id,
          subtotal,
          tax,
          discount,
          total,
          received,
          today,
        ],
      );

      for (const l of lines) {
        await conn.execute(
          "INSERT INTO invoice_items (invoice_id, product_id, qty, price, tax_percent) VALUES (?, ?, ?, ?, ?)",
          [ins.insertId, l.productId, l.qty, l.price, l.taxPercent],
        );
        const [upd] = await conn.execute<ResultSetHeader>(
          "UPDATE products SET stock = stock - ? WHERE id = ? AND distributor_id = ? AND stock >= ?",
          [l.qty, l.productId, did, l.qty],
        );
        if (upd.affectedRows === 0)
          throw new HttpError(409, "Stock changed. Please try again");
      }

      if (body.payment) {
        await conn.execute(
          "INSERT INTO payments (distributor_id, invoice_id, amount, mode, payment_date, created_by) VALUES (?, ?, ?, ?, ?, ?)",
          [did, ins.insertId, received, body.payment.mode, today, me.id],
        );
      }
      return ins.insertId;
    });

    res.status(201).json(await getDetail(did, invoiceId));
  }),
);

router.post(
  "/:id/payments",
  requireRole("admin", "cashier"),
  asyncHandler(async (req, res) => {
    const did = tenantId(req);
    const me = currentUser(req);
    const id = parseId(req.params.id);
    const body = parse(paymentSchema, req.body);
    const amount = round2(body.amount);

    await withTransaction(async (conn) => {
      const [rows] = await conn.execute<RowDataPacket[]>(
        "SELECT total, received FROM invoices WHERE id = ? AND distributor_id = ? FOR UPDATE",
        [id, did],
      );
      const inv = rows[0];
      if (!inv) throw new HttpError(404, "Invoice not found");

      const received = Number(inv.received);
      const due = round2(Number(inv.total) - received);
      if (due <= 0)
        throw new HttpError(400, "This invoice is already fully paid");
      if (amount > due)
        throw new HttpError(400, `Amount cannot be more than due (₹${due})`);

      await conn.execute(
        "INSERT INTO payments (distributor_id, invoice_id, amount, mode, payment_date, created_by) VALUES (?, ?, ?, ?, ?, ?)",
        [did, id, amount, body.mode, todayISO(), me.id],
      );
      await conn.execute("UPDATE invoices SET received = ? WHERE id = ?", [
        round2(received + amount),
        id,
      ]);
    });

    res.status(201).json(await getDetail(did, id));
  }),
);

export default router;
