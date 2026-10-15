import { config } from "./config";

export const round2 = (n: number): number =>
  Math.round((n + Number.EPSILON) * 100) / 100;

// Server UTC lo unna, IST date correct ga vastundi
export function todayISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: config.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export const digitsOnly = (v: string): string => v.replace(/\D/g, "");

export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
