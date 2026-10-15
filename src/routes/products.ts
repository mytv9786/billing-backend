import { Router } from "express";
import { z } from "zod";
import type { RowDataPacket } from "mysql2/promise";
import { exec, query } from "../db";
import { asyncHandler, HttpError, parse, parseId } from "../http";
import { requireRole, tenantId } from "../middleware/auth";
import { toProduct, type ProductRow } from "../mappers";
import { round2 } from "../utils";

const router = Router();

const productSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(150),
  sku: z.string().trim().toUpperCase().min(1, "SKU is required").max(50),
  price: z
    .number()
    .min(0, "Price must be 0 or more")
    .max(10_000_000, "Price is too large"),
  taxPercent: z
    .number()
    .min(0, "GST cannot be negative")
    .max(100, "GST cannot be more than 100%"),
  stock: z
    .number()
    .int("Stock must be a whole number")
    .min(0, "Stock cannot be negative")
    .max(1_000_000, "Stock is too large"),
});

const cols = "id, distributor_id, name, sku, price, tax_percent, stock";

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const rows = await query<ProductRow>(
      `SELECT ${cols} FROM products WHERE distributor_id = ? ORDER BY name`,
      [tenantId(req)],
    );
    res.json(rows.map(toProduct));
  }),
);

router.post(
  "/",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const did = tenantId(req);
    const b = parse(productSchema, req.body);
    const r = await exec(
      "INSERT INTO products (distributor_id, name, sku, price, tax_percent, stock) VALUES (?, ?, ?, ?, ?, ?)",
      [did, b.name, b.sku, round2(b.price), round2(b.taxPercent), b.stock],
    );
    const rows = await query<ProductRow>(
      `SELECT ${cols} FROM products WHERE id = ? AND distributor_id = ?`,
      [r.insertId, did],
    );
    res.status(201).json(toProduct(rows[0]));
  }),
);

router.put(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const did = tenantId(req);
    const id = parseId(req.params.id);
    const b = parse(productSchema, req.body);
    await exec(
      "UPDATE products SET name = ?, sku = ?, price = ?, tax_percent = ?, stock = ? WHERE id = ? AND distributor_id = ?",
      [b.name, b.sku, round2(b.price), round2(b.taxPercent), b.stock, id, did],
    );
    const rows = await query<ProductRow>(
      `SELECT ${cols} FROM products WHERE id = ? AND distributor_id = ?`,
      [id, did],
    );
    if (!rows[0]) throw new HttpError(404, "Product not found");
    res.json(toProduct(rows[0]));
  }),
);

router.delete(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const did = tenantId(req);
    const id = parseId(req.params.id);
    const used = await query<RowDataPacket>(
      `SELECT 1 FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
       WHERE ii.product_id = ? AND i.distributor_id = ? LIMIT 1`,
      [id, did],
    );
    if (used.length > 0)
      throw new HttpError(
        409,
        "This product is used in invoices, so it cannot be deleted",
      );
    const r = await exec(
      "DELETE FROM products WHERE id = ? AND distributor_id = ?",
      [id, did],
    );
    if (r.affectedRows === 0) throw new HttpError(404, "Product not found");
    res.json({ id });
  }),
);

export default router;
