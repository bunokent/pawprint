import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Display name for a pet — found-pet reports have no name (the owner is
 * unknown), so they fall back to "Found pet".
 */
export function petDisplayName(pet: { name?: string | null }, mode?: string | null): string {
  const name = pet.name?.trim();
  return name || (mode === "found" ? "Found pet" : "Pet");
}
