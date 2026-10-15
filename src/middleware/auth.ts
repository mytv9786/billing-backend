import type { Request, RequestHandler } from "express";
import jwt from "jsonwebtoken";
import type { RowDataPacket } from "mysql2/promise";
import { config } from "../config";
import { query } from "../db";
import { asyncHandler, HttpError } from "../http";
import type { AuthUser, Role } from "../types";

interface AuthRow extends RowDataPacket {
  id: number;
  name: string;
  email: string;
  role: Role;
  active: number;
  token_version: number;
  distributor_id: number | null;
  d_active: number | null;
}

export async function findAuthUser(id: number): Promise<AuthUser | null> {
  const rows = await query<AuthRow>(
    `SELECT u.id, u.name, u.email, u.role, u.active, u.token_version, u.distributor_id, d.active AS d_active
     FROM users u LEFT JOIN distributors d ON d.id = u.distributor_id
     WHERE u.id = ?`,
    [id],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    role: r.role,
    distributorId: r.distributor_id,
    active: !!r.active,
    tokenVersion: r.token_version,
    distributorActive: r.distributor_id === null ? true : !!r.d_active,
  };
}

export const signToken = (userId: number, tokenVersion: number): string =>
  jwt.sign({ sub: String(userId), tv: tokenVersion }, config.jwtSecret, {
    algorithm: "HS256",
    expiresIn: config.jwtExpires as jwt.SignOptions["expiresIn"],
  });

// Token valid ayina, prati request ki DB lo user, distributor, token version check chestam
export const authenticate = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new HttpError(401, "Not authenticated");

  let userId: number;
  let tv: number;
  try {
    const payload = jwt.verify(token, config.jwtSecret, {
      algorithms: ["HS256"],
    }) as jwt.JwtPayload;
    userId = Number(payload.sub);
    tv = Number(payload.tv);
  } catch {
    throw new HttpError(401, "Session expired. Please log in again");
  }
  if (!Number.isInteger(userId)) throw new HttpError(401, "Invalid token");

  const user = await findAuthUser(userId);
  if (!user) throw new HttpError(401, "Account not found");
  // Password marite token_version perugutundi, paata tokens ikkade reject avtayi
  if (user.tokenVersion !== tv)
    throw new HttpError(401, "Session expired. Please log in again");
  if (!user.active) throw new HttpError(403, "This account is disabled");
  if (!user.distributorActive)
    throw new HttpError(
      403,
      "This distributor account is disabled. Contact support",
    );

  req.user = user;
  next();
});

export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role))
      return next(new HttpError(403, "You do not have permission"));
    next();
  };

// Tenant data routes ki: super admin ki access ledu
export const requireTenant: RequestHandler = (req, _res, next) => {
  if (!req.user || req.user.distributorId === null)
    return next(new HttpError(403, "You do not have permission"));
  next();
};

export function currentUser(req: Request): AuthUser {
  if (!req.user) throw new HttpError(401, "Not authenticated");
  return req.user;
}

export function tenantId(req: Request): number {
  const id = currentUser(req).distributorId;
  if (id === null) throw new HttpError(403, "You do not have permission");
  return id;
}
