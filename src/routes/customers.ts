import { Router } from "express";
import { z } from "zod";
import type { RowDataPacket } from "mysql2/promise";
import { exec, query } from "../db";
import { asyncHandler, HttpError, parse, parseId } from "../http";
import { requireRole, tenantId } from "../middleware/auth";
import { toCustomer, type CustomerRow } from "../mappers";
import { digitsOnly, GSTIN_REGEX } from "../utils";

const router = Router();

const customerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(150),
  phone: z
    .string()
    .trim()
    .max(20)
    .refine((v) => {
      const n = digitsOnly(v).length;
      return n >= 10 && n <= 15;
    }, "Enter a valid phone number (10 digits)"),
  address: z
    .string()
    .trim()
    .max(255)
    .optional()
    .transform((v) => (v ? v : undefined)),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine(
      (v) => v === undefined || GSTIN_REGEX.test(v),
      "Invalid GSTIN (15 characters)",
    ),
});

const statsSql = `
  SELECT c.id, c.distributor_id, c.name, c.phone, c.address, c.gstin,
    (SELECT COUNT(*) FROM invoices i WHERE i.customer_id = c.id) AS invoice_count,
    (SELECT COALESCE(SUM(i.total - i.received), 0) FROM invoices i WHERE i.customer_id = c.id) AS due
  FROM customers c`;

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const rows = await query<CustomerRow>(
      `${statsSql} WHERE c.distributor_id = ? ORDER BY c.name`,
      [tenantId(req)],
    );
    res.json(rows.map(toCustomer));
  }),
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const did = tenantId(req);
    const b = parse(customerSchema, req.body);
    const r = await exec(
      "INSERT INTO customers (distributor_id, name, phone, phone_digits, address, gstin) VALUES (?, ?, ?, ?, ?, ?)",
      [
        did,
        b.name,
        b.phone,
        digitsOnly(b.phone),
        b.address ?? null,
        b.gstin ?? null,
      ],
    );
    const rows = await query<CustomerRow>(
      `${statsSql} WHERE c.id = ? AND c.distributor_id = ?`,
      [r.insertId, did],
    );
    res.status(201).json(toCustomer(rows[0]));
  }),
);

router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const did = tenantId(req);
    const id = parseId(req.params.id);
    const b = parse(customerSchema, req.body);
    await exec(
      "UPDATE customers SET name = ?, phone = ?, phone_digits = ?, address = ?, gstin = ? WHERE id = ? AND distributor_id = ?",
      [
        b.name,
        b.phone,
        digitsOnly(b.phone),
        b.address ?? null,
        b.gstin ?? null,
        id,
        did,
      ],
    );
    const rows = await query<CustomerRow>(
      `${statsSql} WHERE c.id = ? AND c.distributor_id = ?`,
      [id, did],
    );
    if (!rows[0]) throw new HttpError(404, "Customer not found");
    res.json(toCustomer(rows[0]));
  }),
);

router.delete(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const did = tenantId(req);
    const id = parseId(req.params.id);
    const used = await query<RowDataPacket>(
      "SELECT 1 FROM invoices WHERE customer_id = ? AND distributor_id = ? LIMIT 1",
      [id, did],
    );
    if (used.length > 0)
      throw new HttpError(
        409,
        "This customer has invoices, so it cannot be deleted",
      );
    const r = await exec(
      "DELETE FROM customers WHERE id = ? AND distributor_id = ?",
      [id, did],
    );
    if (r.affectedRows === 0) throw new HttpError(404, "Customer not found");
    res.json({ id });
  }),
);

export default router;
