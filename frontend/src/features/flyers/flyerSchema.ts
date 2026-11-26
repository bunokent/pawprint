import { z } from "zod";
import type { Mode } from "@/features/flyers/api";
import { dateTimeLocalSchema, emailSchema, phoneSchema } from "@/lib/validation";

/**
 * Flyer details schema — lost/found flyers need a location and a real, non-future
 * last-seen date; outreach flyers don't show those fields. Contacts are optional,
 * but any value supplied must be a usable phone number or email address.
 *
 * Shared by the builder wizard and the owner-only edit page so both screens enforce
 * exactly the same rules before calling the API.
 */
export function flyerSchemaFor(mode: Mode) {
  const needsWhereAndWhen = mode === "emergency" || mode === "found";
  const location = z.string().trim().max(255, "Keep the location under 255 characters.");
  return z.object({
    last_seen_location: needsWhereAndWhen
      ? location.min(1, mode === "found" ? "Add the location where you found the pet." : "Add where you last saw the pet.")
      : location.optional().or(z.literal("")),
    last_seen_date: dateTimeLocalSchema(
      needsWhereAndWhen
        ? mode === "found" ? "Add the date and time you found the pet." : "Add the last seen date and time."
        : undefined,
    ),
    distinctive_markings: z.string().trim().max(1000, "Keep the description under 1000 characters.").optional().or(z.literal("")),
    contact_phone: phoneSchema(),
    contact_email: emailSchema("Enter a valid email.").optional().or(z.literal("")),
  });
}

export type FlyerValues = z.infer<ReturnType<typeof flyerSchemaFor>>;
