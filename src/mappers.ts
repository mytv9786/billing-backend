import type { RowDataPacket } from "mysql2/promise";

export interface DistributorRow extends RowDataPacket {
  id: number;
  name: string;
  invoice_prefix: string;
  gstin: string | null;
  phone: string | null;
  address: string | null;
  active: number;
}

// DB snake_case nundi frontend camelCase types ki
export const toDistributor = (r: DistributorRow) => ({
  id: r.id,
  name: r.name,
  invoicePrefix: r.invoice_prefix,
  gstin: r.gstin ?? undefined,
  phone: r.phone ?? undefined,
  address: r.address ?? undefined,
  active: !!r.active,
});

export interface UserRow extends RowDataPacket {
  id: number;
  distributor_id: number | null;
  name: string;
  email: string;
  role: "super_admin" | "admin" | "cashier" | "sales";
  active: number;
}

export const toUser = (r: UserRow) => ({
  id: r.id,
  distributorId: r.distributor_id,
  name: r.name,
  email: r.email,
  role: r.role,
  active: !!r.active,
});

export interface ProductRow extends RowDataPacket {
  id: number;
  distributor_id: number;
  name: string;
  sku: string;
  price: number;
  tax_percent: number;
  stock: number;
}

export const toProduct = (r: ProductRow) => ({
  id: r.id,
  distributorId: r.distributor_id,
  name: r.name,
  sku: r.sku,
  price: r.price,
  taxPercent: r.tax_percent,
  stock: r.stock,
});

export interface CustomerRow extends RowDataPacket {
  id: number;
  distributor_id: number;
  name: string;
  phone: string;
  address: string | null;
  gstin: string | null;
  invoice_count: number;
  due: number;
}

export const toCustomer = (r: CustomerRow) => ({
  id: r.id,
  distributorId: r.distributor_id,
  name: r.name,
  phone: r.phone,
  address: r.address ?? undefined,
  gstin: r.gstin ?? undefined,
  invoiceCount: r.invoice_count,
  due: r.due,
});
