import bcrypt from "bcryptjs";
import type { RowDataPacket } from "mysql2/promise";
import { exec, pool, query } from "../db";

async function main() {
  if (process.env.NODE_ENV === "production")
    throw new Error("Seeding is disabled in production");

  const existing = await query<RowDataPacket>(
    "SELECT id FROM distributors LIMIT 1",
  );
  if (existing.length > 0) {
    console.log("Already seeded");
    return;
  }

  await exec("INSERT INTO distributors (name, invoice_prefix) VALUES (?, ?)", [
    "Sri Sai Distributors",
    "INV",
  ]);
  await exec("INSERT INTO distributors (name, invoice_prefix) VALUES (?, ?)", [
    "Krishna Agencies",
    "KA",
  ]);

  // Order important: ids frontend mock data tho match avtayi (1 to 4)
  const users: [number | null, string, string, string, string][] = [
    [null, "Platform Owner", "super@billpro.com", "super123", "super_admin"],
    [1, "Anil Kumar", "anil@srisai.com", "admin123", "admin"],
    [1, "Priya", "priya@srisai.com", "cash123", "cashier"],
    [2, "Krishna Rao", "krishna@agencies.com", "admin123", "admin"],
  ];
  for (const [did, name, email, password, role] of users) {
    await exec(
      "INSERT INTO users (distributor_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)",
      [did, name, email, await bcrypt.hash(password, 10), role],
    );
  }
  console.log("Seeded 2 distributors and 4 users");
}

main()
  .then(() => pool.end())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
