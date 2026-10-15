export type Role = "super_admin" | "admin" | "cashier" | "sales";

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: Role;
  distributorId: number | null;
  active: boolean;
  distributorActive: boolean;
  tokenVersion: number;
}
