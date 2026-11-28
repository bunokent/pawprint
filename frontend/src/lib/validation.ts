import { z } from "zod";

/** `datetime-local` inputs emit `YYYY-MM-DDTHH:mm` (seconds when a step is set). */
const DATE_TIME_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const PHONE_CHARACTERS = /^[+()\d\s.-]+$/;
// Philippine mobiles are 9XX XXXXXXX; landlines use area code 2 or 3X–8X.
// Both may be typed with 0, 63 or +63 in front. The backend is authoritative.
const PH_MOBILE_DIGITS = /^(?:63|0)?9\d{9}$/;
const PH_LANDLINE_DIGITS = /^(?:63|0)?(?:2|[3-8]\d)\d{7,8}$/;
export const PHONE_ERROR = "Enter a valid Philippine phone number (e.g. 0917 123 4567).";

/** Small allowance for clock skew between the browser and the device. */
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

export function isValidDateTimeLocal(value: string): boolean {
  const parts = DATE_TIME_LOCAL.exec(value);
  if (!parts) return false;
  // The seconds group is optional; treat a missing group as zero (not NaN).
  const [year, month, day, hour, minute, second] = parts.slice(1).map((part) => Number(part ?? 0));
  // JS Date maps years 0–99 to 1900–1999, so reject them explicitly.
  if (year < 1900) return false;
  const date = new Date(year, month - 1, day, hour, minute, second ?? 0);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day &&
    date.getHours() === hour &&
    date.getMinutes() === minute &&
    date.getSeconds() === (second ?? 0)
  );
}

export function isFutureDateTimeLocal(value: string): boolean {
  return new Date(value).getTime() > Date.now() + FUTURE_TOLERANCE_MS;
}

/**
 * Date & time field shared by lost/found flyer details. Optional by default;
 * pass `requiredMessage` for modes where the detail is essential. Rejects
 * impossible calendar values and future timestamps (e.g. a typo'ed year).
 */
export function dateTimeLocalSchema(requiredMessage?: string) {
  const base = z.string().trim();
  return (requiredMessage ? base.min(1, requiredMessage) : base)
    .refine((value) => value === "" || isValidDateTimeLocal(value), "Enter a valid date and time.")
    .refine(
      (value) => value === "" || !isFutureDateTimeLocal(value),
      "The date and time cannot be in the future.",
    );
}

/** Philippine mobile/landline shapes, allowing the separators people actually type. */
export function isValidPhone(value: string): boolean {
  if (!PHONE_CHARACTERS.test(value)) return false;
  const digits = value.replace(/\D/g, "");
  return PH_MOBILE_DIGITS.test(digits) || PH_LANDLINE_DIGITS.test(digits);
}

export function phoneSchema(message = PHONE_ERROR) {
  return z
    .string()
    .trim()
    .max(32, "Keep the phone number under 32 characters.")
    .refine((value) => value === "" || isValidPhone(value), message);
}

/** Trims before validating so " name@x.com " is accepted as an email. */
export function emailSchema(message = "Enter a valid email.") {
  return z.string().trim().pipe(z.email(message));
}

/** Whole years only — mirrors the backend's 0–50 constraint. */
export function ageSchema(message = "Enter an age from 0 to 50 years.") {
  return z.string().trim().regex(/^(?:[0-9]|[1-4]\d|50)$/, message);
}
