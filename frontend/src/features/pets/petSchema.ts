import { z } from "zod";
import type { Mode } from "@/features/flyers/api";
import { ageSchema } from "@/lib/validation";

export const SPECIES = ["dog", "cat", "bird", "horse", "other"] as const;
export type Species = (typeof SPECIES)[number];

const petSchemaBase = z.object({
  name: z.string().trim().max(120, "Keep the name under 120 characters.").optional().or(z.literal("")),
  // The builder auto-detects species; the owner edit form lets it be corrected.
  species: z.enum(SPECIES).optional(),
  breed: z.string().trim().max(120, "Keep the breed under 120 characters.").optional().or(z.literal("")),
  color: z.string().trim().max(120, "Keep the color under 120 characters.").optional().or(z.literal("")),
  age: ageSchema().optional().or(z.literal("")),
  temperament_tags: z.string().trim().max(600, "Keep personality tags under 600 characters.").optional().or(z.literal("")),
});
export type PetValues = z.infer<typeof petSchemaBase>;

/**
 * Pet form schema — a name is required for lost/adoptable pets, but a found-pet
 * report has no name (the owner is unknown), so the field is hidden there.
 * Shared by the builder and the owner-only edit form.
 */
export function petSchemaFor(mode: Mode) {
  return petSchemaBase.superRefine((v, ctx) => {
    if (mode === "found") return;
    if (!v.name?.trim()) {
      ctx.addIssue({ code: "custom", path: ["name"], message: "Give the pet a name." });
    }
    // Count before parseTags() truncates, so an overlong list is rejected.
    const tags = (v.temperament_tags ?? "").split(",").map((tag) => tag.trim()).filter(Boolean);
    if (tags.length > 12) {
      ctx.addIssue({ code: "custom", path: ["temperament_tags"], message: "Use at most 12 personality tags." });
    }
    if (tags.some((tag) => tag.length > 40)) {
      ctx.addIssue({ code: "custom", path: ["temperament_tags"], message: "Keep each personality tag under 40 characters." });
    }
  });
}

/** Comma-separated UI text → the string[] the pet API expects. */
export function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 12);
}
