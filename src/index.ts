import express from "express";
import cors from "cors";
import helmet from "helmet";
import { config } from "./config";
import { errorHandler } from "./http";

import { authenticate, requireRole, requireTenant } from "./middleware/auth";

import authRouter from "./routes/auth";
import distributorsRouter from "./routes/distributors";
import usersRouter from "./routes/users";
import productsRouter from "./routes/products";
import customersRouter from "./routes/customers";
import invoicesRouter from "./routes/invoices";
import reportsRouter from "./routes/reports";

const app = express();
app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin: config.corsOrigins }));
app.use(express.json({ limit: "100kb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/auth", authRouter);
app.use(
  "/api/distributors",
  authenticate,
  requireRole("super_admin"),
  distributorsRouter,
);
app.use(
  "/api/users",
  authenticate,
  requireTenant,
  requireRole("admin"),
  usersRouter,
);
app.use("/api/products", authenticate, requireTenant, productsRouter);
app.use("/api/customers", authenticate, requireTenant, customersRouter);
app.use("/api/invoices", authenticate, requireTenant, invoicesRouter);
app.use(
  "/api/reports",
  authenticate,
  requireTenant,
  requireRole("admin"),
  reportsRouter,
);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`API running on http://localhost:${config.port}`);
});
