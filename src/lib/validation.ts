import { z } from "zod";

export const httpUrlSchema = z
  .string()
  .url()
  .refine((url) => /^https?:\/\//i.test(url), {
    message: "Must be an http(s) URL",
  });

/**
 * Money and text fields a host fills in on a listing, with limits a real
 * Fylde Coast stay never reaches and messages that name the field - shared
 * by listing create and edit. Without the ceilings a mistyped price
 * overflowed the database column (a bare 500) or went live at a silly
 * figure.
 */
export const listingFieldSchemas = {
  title: z.string().trim().min(3, "Title must be at least 3 characters").max(120, "Title must be 120 characters or fewer"),
  description: z
    .string()
    .trim()
    .min(10, "Description must be at least 10 characters")
    .max(5000, "Description must be 5,000 characters or fewer"),
  pricePerNightCents: z
    .number()
    .int()
    .positive("Price per night must be more than £0")
    .max(1_000_000, "Price per night can't be more than £10,000"),
  cleaningFeeCents: z
    .number()
    .int()
    .min(0, "Cleaning fee can't be negative")
    .max(100_000, "Cleaning fee can't be more than £1,000"),
  securityDepositCents: z
    .number()
    .int()
    .min(0, "Security deposit can't be negative")
    .max(500_000, "Security deposit can't be more than £5,000"),
};

/**
 * A phone number a host could actually ring: digits with the usual
 * spaces, dashes, brackets and a leading +, 7 to 15 digits in all (the
 * international maximum). Deliberately not stricter - guests come from
 * anywhere and write numbers many ways.
 */
export function isPlausiblePhone(value: string): boolean {
  const trimmed = value.trim();
  if (!/^\+?[\d\s\-().]+$/.test(trimmed)) return false;
  const digits = trimmed.replace(/\D/g, "").length;
  return digits >= 7 && digits <= 15;
}
