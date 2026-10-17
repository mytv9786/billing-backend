const bcrypt = require("bcryptjs");
const mysql = require("mysql2/promise");
require("dotenv").config();

async function main() {
  // మీ .env లోని Aiven క్లౌడ్ డేటాబేస్ వివరాలతో నేరుగా కనెక్ట్ అవుతుంది
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false }, // Aiven SSL కోసం ఇది ముఖ్యం
  });

  try {
    console.log("Connecting to Aiven Cloud DB...");

    // 1. ఒక కొత్త డెమో డిస్ట్రిబ్యూటర్ ను క్రియేట్ చేయండి
    const [distResult] = await pool.execute(
      "INSERT INTO distributors (name, invoice_prefix, invoice_seq, active) VALUES (?, ?, ?, ?)",
      ["Vishwa Distributors", "VD", 0, 1],
    );
    const distributorId = distResult.insertId || 1;
    console.log(`✓ Distributor created with ID: ${distributorId}`);

    // 2. మీ బ్యాకెండ్ లాగిన్ కోడ్ కి మ్యాచ్ అయ్యేలా పాస్ వర్డ్ హాష్ చేయండి
    const hash = await bcrypt.hash("superadmin123", 10);

    // 3. సూపర్ అడ్మిన్ యూజర్ ను ఇన్సర్ట్ చేయండి (active=1, token_version=0)
    await pool.execute(
      "INSERT INTO users (distributor_id, name, email, password_hash, role, active, token_version) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        distributorId,
        "Vishwa Super Admin",
        "superadmin@billpro.com",
        hash,
        "super_admin",
        1,
        0,
      ],
    );

    console.log("--------------------------------------------------");
    console.log("✓ SUPER USER CREATED SUCCESSFULLY IN CLOUD DB!");
    console.log("Email: superadmin@billpro.com");
    console.log("Password: superadmin123");
    console.log("--------------------------------------------------");
  } catch (e) {
    console.error("X Error creating super user:", e);
  } finally {
    await pool.end();
  }
}

main();
