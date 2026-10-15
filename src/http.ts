import type {
  ErrorRequestHandler,
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from "express";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// Async errors ni error handler ki pampistundi
export const asyncHandler =
  (
    fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
  ): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

type Parseable<T> = {
  safeParse(
    data: unknown,
  ):
    | { success: true; data: T }
    | { success: false; error: { issues: { message: string }[] } };
};

export function parse<T>(schema: Parseable<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success)
    throw new HttpError(400, r.error.issues[0]?.message ?? "Invalid input");
  return r.data;
}

export function parseId(v: unknown): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, "Invalid id");
  return n;
}

const duplicateMessages: [string, string][] = [
  ["uq_distributor_prefix", "This prefix is already used"],
  ["uq_user_email", "This email is already registered"],
  ["uq_product_sku", "This SKU already exists"],
  ["uq_customer_phone", "A customer with this phone already exists"],
  ["uq_invoice_no", "Invoice number conflict. Try again"],
];

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  const e = err as { code?: string; sqlMessage?: string; type?: string };
  if (e.code === "ER_DUP_ENTRY") {
    const hit = duplicateMessages.find(([key]) =>
      (e.sqlMessage ?? "").includes(key),
    );
    res.status(409).json({ error: hit ? hit[1] : "Already exists" });
    return;
  }
  if (e.type === "entity.parse.failed") {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Something went wrong" });
};
