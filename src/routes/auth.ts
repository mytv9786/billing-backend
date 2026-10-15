import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type { RowDataPacket } from "mysql2/promise";
import { exec, query } from "../db";
import { asyncHandler, HttpError, parse } from "../http";
import {
  authenticate,
  currentUser,
  findAuthUser,
  signToken,
} from "../middleware/auth";
import { toDistributor, type DistributorRow } from "../mappers";
import type { AuthUser } from "../types";

const router = Router();

// User unda ledo teliyakunda undadaniki (timing), dummy hash tho compare chestam
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Try again later" },
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(1, "Enter password").max(200),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Enter current password").max(200),
  newPassword: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(72),
});

interface HashRow extends RowDataPacket {
  id: number;
  password_hash: string;
}

async function buildSession(user: AuthUser) {
  let distributor = null;
  if (user.distributorId !== null) {
    const rows = await query<DistributorRow>(
      "SELECT id, name, invoice_prefix, gstin, phone, address, active FROM distributors WHERE id = ?",
      [user.distributorId],
    );
    distributor = rows[0] ? toDistributor(rows[0]) : null;
  }
  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      distributorId: user.distributorId,
    },
    distributor,
  };
}

router.post(
  "/login",
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = parse(loginSchema, req.body);
    const rows = await query<HashRow>(
      "SELECT id, password_hash FROM users WHERE email = ?",
      [email],
    );
    const row = rows[0];
    const ok = await bcrypt.compare(password, row?.password_hash ?? DUMMY_HASH);
    if (!row || !ok) throw new HttpError(401, "Invalid email or password");

    const user = await findAuthUser(row.id);
    if (!user || !user.active)
      throw new HttpError(403, "This account is disabled");
    if (!user.distributorActive)
      throw new HttpError(
        403,
        "This distributor account is disabled. Contact support",
      );

    res.json({
      token: signToken(user.id, user.tokenVersion),
      ...(await buildSession(user)),
    });
  }),
);

// Page refresh ayyaka session restore cheyadaniki
router.get(
  "/me",
  authenticate,
  asyncHandler(async (req, res) => {
    res.json(await buildSession(currentUser(req)));
  }),
);

router.post(
  "/change-password",
  authenticate,
  asyncHandler(async (req, res) => {
    const me = currentUser(req);
    const body = parse(changePasswordSchema, req.body);
    const rows = await query<HashRow>(
      "SELECT id, password_hash FROM users WHERE id = ?",
      [me.id],
    );
    const ok = rows[0]
      ? await bcrypt.compare(body.currentPassword, rows[0].password_hash)
      : false;
    if (!ok) throw new HttpError(400, "Current password is incorrect");
    if (body.currentPassword === body.newPassword)
      throw new HttpError(400, "New password must be different");

    await exec(
      "UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?",
      [await bcrypt.hash(body.newPassword, 10), me.id],
    );
    // Ee device ki kotha token isthunnam, migilina devices logout avtayi
    const fresh = await findAuthUser(me.id);
    if (!fresh) throw new HttpError(401, "Account not found");
    res.json({ ok: true, token: signToken(fresh.id, fresh.tokenVersion) });
  }),
);

export default router;
