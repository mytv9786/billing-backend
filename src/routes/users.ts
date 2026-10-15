import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { exec, query } from "../db";
import { asyncHandler, HttpError, parse, parseId } from "../http";
import { currentUser, tenantId } from "../middleware/auth";
import { toUser, type UserRow } from "../mappers";

const router = Router();

const createSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(190),
  password: z.string().min(6, "Password must be at least 6 characters").max(72),
  role: z.enum(["cashier", "sales"]),
});

const cols = "id, distributor_id, name, email, role, active";

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const rows = await query<UserRow>(
      `SELECT ${cols} FROM users WHERE distributor_id = ?
       ORDER BY FIELD(role, 'admin', 'cashier', 'sales'), name`,
      [tenantId(req)],
    );
    res.json(rows.map(toUser));
  }),
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const did = tenantId(req);
    const b = parse(createSchema, req.body);
    const hash = await bcrypt.hash(b.password, 10);
    const r = await exec(
      "INSERT INTO users (distributor_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)",
      [did, b.name, b.email, hash, b.role],
    );
    const rows = await query<UserRow>(
      `SELECT ${cols} FROM users WHERE id = ? AND distributor_id = ?`,
      [r.insertId, did],
    );
    res.status(201).json(toUser(rows[0]));
  }),
);

router.patch(
  "/:id/active",
  asyncHandler(async (req, res) => {
    const did = tenantId(req);
    const id = parseId(req.params.id);
    const { active } = parse(z.object({ active: z.boolean() }), req.body);
    if (id === currentUser(req).id)
      throw new HttpError(400, "You cannot disable your own account");
    // distributor_id condition valla veru distributor user ni touch cheyalem
    // const r = await exec(
    //   "UPDATE users SET active = ? WHERE id = ? AND distributor_id = ?",
    //   [active ? 1 : 0, id, did],
    // );
    const r = await exec(
      "UPDATE users SET active = ? WHERE id = ? AND distributor_id = ? AND role <> 'admin'",
      [active ? 1 : 0, id, did],
    );
    if (r.affectedRows === 0) throw new HttpError(404, "User not found");
    res.json({ id, active });
  }),
);

router.patch(
  "/:id/password",
  asyncHandler(async (req, res) => {
    const did = tenantId(req);
    const id = parseId(req.params.id);
    if (id === currentUser(req).id)
      throw new HttpError(400, "Use Change password for your own account");
    const { password } = parse(
      z.object({
        password: z
          .string()
          .min(8, "Password must be at least 8 characters")
          .max(72),
      }),
      req.body,
    );
    // const r = await exec(
    //   "UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ? AND distributor_id = ?",
    //   [await bcrypt.hash(password, 10), id, did],
    // );
    const r = await exec(
      "UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ? AND distributor_id = ? AND role <> 'admin'",
      [await bcrypt.hash(password, 10), id, did],
    );
    if (r.affectedRows === 0) throw new HttpError(404, "User not found");
    res.json({ ok: true });
  }),
);

export default router;
