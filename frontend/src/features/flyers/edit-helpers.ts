/** Pure helpers shared by the owner-only flyer edit UI and its tests. */

/** The API exposes the creator id directly, so ownership is a direct id match. */
export function isFlyerOwner(
  flyer: { creator: string } | null | undefined,
  user: { id: string } | null | undefined,
): boolean {
  return Boolean(flyer && user && flyer.creator === user.id);
}

const pad = (value: number) => String(value).padStart(2, "0");

/** ISO timestamp → the local `YYYY-MM-DDTHH:mm` value a datetime-local input needs. */
export function toDateTimeLocal(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** datetime-local value → ISO timestamp; blank/invalid values become null. */
export function toIsoDateTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** API tag array → the comma-separated text used by the pet form inputs. */
export function tagsText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value.filter((tag): tag is string => typeof tag === "string" && Boolean(tag.trim())).join(", ");
}

/** A saved storage key is required before an edit can be submitted. */
export function hasPhotoInput(key: string | null | undefined): boolean {
  return Boolean(key && key.trim());
}

/** Resolved flyers are final: their flyer and pet details cannot be edited. */
export function isFlyerEditable(flyer: { status?: string | null } | null | undefined): boolean {
  return Boolean(flyer && flyer.status !== "resolved");
}
