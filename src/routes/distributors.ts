import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { exec, query, withTransaction } from "../db";
import { asyncHandler, HttpError, parse, parseId } from "../http";
//import { toDistributor, type DistributorRow } from "../mappers";
import {
  toDistributor,
  toUser,
  type DistributorRow,
  type UserRow,
} from "../mappers";

const router = Router();

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const createSchema = z.object({
  name: z.string().trim().min(1, "Distributor name is required").max(150),
  invoicePrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2,5}$/, "Invoice prefix: 2 to 5 letters (ex: INV, KA)"),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(GSTIN_REGEX, "Invalid GSTIN")
    .optional(),
  phone: z.string().trim().max(20).optional(),
  address: z.string().trim().max(255).optional(),
  admin: z.object({
    name: z.string().trim().min(1, "Admin name is required").max(100),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email("Enter a valid admin email")
      .max(190),
    password: z
      .string()
      .min(6, "Password must be at least 6 characters")
      .max(72),
  }),
});

interface StatsRow extends DistributorRow {
  staff: number;
  invoices: number;
  billed: number;
}

const statsSql = `
  SELECT d.id, d.name, d.invoice_prefix, d.gstin, d.phone, d.address, d.active,
    (SELECT COUNT(*) FROM users u WHERE u.distributor_id = d.id) AS staff,
    (SELECT COUNT(*) FROM invoices i WHERE i.distributor_id = d.id) AS invoices,
    (SELECT COALESCE(SUM(i.total), 0) FROM invoices i WHERE i.distributor_id = d.id) AS billed
  FROM distributors d`;

const toWithStats = (r: StatsRow) => ({
  ...toDistributor(r),
  staff: r.staff,
  invoices: r.invoices,
  billed: r.billed,
});

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const rows = await query<StatsRow>(`${statsSql} ORDER BY d.id`);
    res.json(rows.map(toWithStats));
  }),
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const b = parse(createSchema, req.body);
    const hash = await bcrypt.hash(b.admin.password, 10);

    const id = await withTransaction(async (conn) => {
      const [r] = await conn.execute<ResultSetHeader>(
        "INSERT INTO distributors (name, invoice_prefix, gstin, phone, address) VALUES (?, ?, ?, ?, ?)",
        [
          b.name,
          b.invoicePrefix,
          b.gstin ?? null,
          b.phone ?? null,
          b.address ?? null,
        ],
      );
      await conn.execute(
        "INSERT INTO users (distributor_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, 'admin')",
        [r.insertId, b.admin.name, b.admin.email, hash],
      );
      return r.insertId;
    });

    const rows = await query<StatsRow>(`${statsSql} WHERE d.id = ?`, [id]);
    res.status(201).json(toWithStats(rows[0]));
  }),
);

router.patch(
  "/:id/active",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const { active } = parse(z.object({ active: z.boolean() }), req.body);
    const r = await exec("UPDATE distributors SET active = ? WHERE id = ?", [
      active ? 1 : 0,
      id,
    ]);
    if (r.affectedRows === 0) throw new HttpError(404, "Distributor not found");
    res.json({ id, active });
  }),
);

const adminSchema = z.object({
  name: z.string().trim().min(1, "Admin name is required").max(100),
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(190),
  password: z.string().min(8, "Password must be at least 8 characters").max(72),
});

const passwordSchema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters").max(72),
});

const adminCols = "id, distributor_id, name, email, role, active";

router.get(
  "/:id/admins",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const rows = await query<UserRow>(
      `SELECT ${adminCols} FROM users WHERE distributor_id = ? AND role = 'admin' ORDER BY id`,
      [id],
    );
    res.json(rows.map(toUser));
  }),
);

router.post(
  "/:id/admins",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const b = parse(adminSchema, req.body);
    const dist = await query<RowDataPacket>(
      "SELECT id FROM distributors WHERE id = ?",
      [id],
    );
    if (dist.length === 0) throw new HttpError(404, "Distributor not found");

    const r = await exec(
      "INSERT INTO users (distributor_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, 'admin')",
      [id, b.name, b.email, await bcrypt.hash(b.password, 10)],
    );
    const rows = await query<UserRow>(
      `SELECT ${adminCols} FROM users WHERE id = ?`,
      [r.insertId],
    );
    res.status(201).json(toUser(rows[0]));
  }),
);

router.patch(
  "/:id/admins/:userId/active",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const userId = parseId(req.params.userId);
    const { active } = parse(z.object({ active: z.boolean() }), req.body);

    if (!active) {
      // Last active admin ni disable cheste distributor lock out avtundi
      const others = await query<RowDataPacket>(
        "SELECT id FROM users WHERE distributor_id = ? AND role = 'admin' AND active = 1 AND id <> ?",
        [id, userId],
      );
      if (others.length === 0)
        throw new HttpError(
          400,
          "At least one admin must stay active. Disable the distributor instead",
        );
    }

    const r = await exec(
      "UPDATE users SET active = ? WHERE id = ? AND distributor_id = ? AND role = 'admin'",
      [active ? 1 : 0, userId, id],
    );
    if (r.affectedRows === 0) throw new HttpError(404, "Admin not found");
    res.json({ id: userId, active });
  }),
);

router.patch(
  "/:id/admins/:userId/password",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const userId = parseId(req.params.userId);
    const { password } = parse(passwordSchema, req.body);

    const r = await exec(
      "UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ? AND distributor_id = ? AND role = 'admin'",
      [await bcrypt.hash(password, 10), userId, id],
    );
    if (r.affectedRows === 0) throw new HttpError(404, "Admin not found");
    res.json({ ok: true });
  }),
);

export default router;
