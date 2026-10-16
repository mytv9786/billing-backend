import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

const jwtSecret = required("JWT_SECRET");
if (jwtSecret.length < 32)
  throw new Error("JWT_SECRET must be at least 32 characters");

export const config = {
  port: Number(process.env.PORT ?? 4000),
  db: {
    host: process.env.DB_HOST ?? "localhost",
    port: Number(process.env.DB_PORT ?? 3306),
    user: required("DB_USER"),
    password: process.env.DB_PASSWORD ?? "",
    database: process.env.DB_NAME ?? "billpro",
    ssl: {
      rejectUnauthorized: false, // Aiven Cloud MySQL కి కనెక్ట్ అవ్వడానికి ఇది కచ్చితంగా ఉండాలి
    },
  },
  jwtSecret,
  jwtExpires: process.env.JWT_EXPIRES ?? "12h",
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:5173")
    .split(",")
    .map((s) => s.trim()),
  timezone: process.env.APP_TIMEZONE ?? "Asia/Kolkata",
};
