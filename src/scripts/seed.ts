import bcrypt from "bcryptjs";
import type { RowDataPacket } from "mysql2/promise";
import { exec, pool, query } from "../db";

async function main() {
  if (process.env.NODE_ENV === "production")
    throw new Error("Seeding is disabled in production");

  console.log("Creating tables if they do not exist...");

  // 1. Distributors Table క్రియేషన్
  await exec(`
    CREATE TABLE IF NOT EXISTS distributors (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      invoice_prefix VARCHAR(50) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 2. Users Table క్రియేషన్
  await exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      distributor_id INT NULL,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(50) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (distributor_id) REFERENCES distributors(id) ON DELETE SET NULL
    )
  `);

  // 3. Products Table క్రియేషన్
  await exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INT AUTO_INCREMENT PRIMARY KEY,
      distributor_id INT NOT NULL,
      name VARCHAR(255) NOT NULL,
      sku VARCHAR(100) NOT NULL,
      price DECIMAL(10,2) NOT NULL,
      tax_percent DECIMAL(5,2) NOT NULL,
      stock INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (distributor_id) REFERENCES distributors(id) ON DELETE CASCADE
    )
  `);

  // 4. Customers Table క్రియేషన్
  await exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      distributor_id INT NOT NULL,
      name VARCHAR(255) NOT NULL,
      phone VARCHAR(50) NOT NULL,
      phone_digits VARCHAR(50) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (distributor_id) REFERENCES distributors(id) ON DELETE CASCADE
    )
  `);

  console.log("Tables created successfully! Checking existing data...");

  const existing = await query<RowDataPacket>(
    "SELECT id FROM distributors LIMIT 1",
  );
  if (existing.length > 0) {
    console.log("Database already seeded with tables and initial rows.");
    return;
  }

  // డేటా ఇన్సర్ట్ చేయడం
  await exec("INSERT INTO distributors (name, invoice_prefix) VALUES (?, ?)", [
    "Sri Sai Distributors",
    "INV",
  ]);
  await exec("INSERT INTO distributors (name, invoice_prefix) VALUES (?, ?)", [
    "Krishna Agencies",
    "KA",
  ]);

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
  console.log("Seeded 2 distributors and 4 users into Cloud DB");
}

main()
  .then(() => pool.end())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
