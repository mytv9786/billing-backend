import type { RowDataPacket } from "mysql2/promise";
import { exec, pool, query } from "../db";

async function main() {
  if (process.env.NODE_ENV === "production")
    throw new Error("Seeding is disabled in production");

  const dist = await query<RowDataPacket>(
    "SELECT id FROM distributors ORDER BY id",
  );
  if (dist.length < 2) throw new Error("Run npm run seed first");
  const existing = await query<RowDataPacket>(
    "SELECT id FROM products LIMIT 1",
  );
  if (existing.length > 0) {
    console.log("Demo data already exists");
    return;
  }
  const d1 = dist[0].id as number;
  const d2 = dist[1].id as number;

  const products: [number, string, string, number, number, number][] = [
    [d1, "Wireless Mouse", "WM-101", 500, 18, 24],
    [d1, "USB Cable", "UC-205", 200, 18, 8],
    [d1, "Keyboard", "KB-330", 850, 18, 0],
    [d1, "Power Strip", "PS-410", 420, 12, 40],
    [d2, "LED Bulb 9W", "LB-09", 90, 12, 120],
    [d2, "Extension Board", "EB-05", 350, 18, 6],
  ];
  for (const p of products) {
    await exec(
      "INSERT INTO products (distributor_id, name, sku, price, tax_percent, stock) VALUES (?, ?, ?, ?, ?, ?)",
      p,
    );
  }

  const customers: [number, string, string][] = [
    [d1, "Ravi Traders", "98480 12345"],
    [d1, "Lakshmi Stores", "99890 54321"],
    [d1, "Suresh Electricals", "90000 11122"],
    [d2, "Venkat Mobiles", "98765 43210"],
    [d2, "Anand Hardware", "97000 22211"],
  ];
  for (const [did, name, phone] of customers) {
    await exec(
      "INSERT INTO customers (distributor_id, name, phone, phone_digits) VALUES (?, ?, ?, ?)",
      [did, name, phone, phone.replace(/\D/g, "")],
    );
  }
  console.log("Seeded 6 products and 5 customers");
}

main()
  .then(() => pool.end())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
