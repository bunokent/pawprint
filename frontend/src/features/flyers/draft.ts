import { HIGH_CONFIDENCE, type Pet, type PhotoUploadResult } from "@/features/pets/api";
import type { Species } from "@/features/pets/petSchema";
import type { Mode } from "@/features/flyers/api";

/** One versioned key so old/incompatible drafts are discarded instead of crashing the wizard. */
const DRAFT_KEY = "pawprint:flyer-draft:v1";
const DRAFT_VERSION = 1;

export type DraftStep = 0 | 1 | 2;

export interface Coordinates {
  lat: number;
  lng: number;
}

/** Strings mirror the HTML inputs — Zod parses them at submit time. */
export interface PetDraftValues {
  name?: string;
  species?: Species;
  breed?: string;
  color?: string;
  age?: string;
  temperament_tags?: string;
}

export interface FlyerDraftValues {
  last_seen_location: string;
  last_seen_date: string;
  distinctive_markings: string;
  contact_phone: string;
  contact_email: string;
}

export interface FlyerDraft {
  version: number;
  ownerId: string | null;
  step: DraftStep;
  mode: Mode;
  photo: PhotoUploadResult | null;
  pet: Pet | null;
  petValues: PetDraftValues;
  /** Values that produced `pet`, so Back → Continue does not create a duplicate pet. */
  petFormSnapshot: PetDraftValues | null;
  flyerValues: FlyerDraftValues;
  coords: Coordinates | null;
  /** Account email is prefilled once, unless the user has already edited the field. */
  prefillContactEmail: boolean;
  updatedAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asMode(value: unknown): Mode {
  return value === "found" || value === "outreach" ? value : "emergency";
}

function asStep(value: unknown): DraftStep {
  return value === 1 || value === 2 ? value : 0;
}

function asCoordinates(value: unknown): Coordinates | null {
  if (!isRecord(value)) return null;
  const { lat, lng } = value;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asPhoto(value: unknown): PhotoUploadResult | null {
  if (!isRecord(value) || typeof value.key !== "string" || !value.key) return null;
  return {
    key: value.key,
    url: asString(value.url),
    thumb_key: asString(value.thumb_key),
    thumb_url: asString(value.thumb_url),
    pet_classes: asStringArray(value.pet_classes),
    detected_classes: asStringArray(value.detected_classes),
    max_confidence: typeof value.max_confidence === "number" ? value.max_confidence : 0,
    ...(asOptionalString(value.breed) !== undefined ? { breed: asString(value.breed) } : {}),
    ...(typeof value.breed_confidence === "number" ? { breed_confidence: value.breed_confidence } : {}),
    ...(asOptionalString(value.color) !== undefined ? { color: asString(value.color) } : {}),
    ...(typeof value.color_confidence === "number" ? { color_confidence: value.color_confidence } : {}),
  };
}

function asPetValues(value: unknown): PetDraftValues {
  if (!isRecord(value)) return blankPetValues();
  return {
    name: asOptionalString(value.name),
    breed: asOptionalString(value.breed),
    color: asOptionalString(value.color),
    age: asOptionalString(value.age),
    temperament_tags: asOptionalString(value.temperament_tags),
  };
}

function asFlyerValues(value: unknown): FlyerDraftValues {
  if (!isRecord(value)) return blankFlyerValues();
  return {
    last_seen_location: asString(value.last_seen_location),
    last_seen_date: asString(value.last_seen_date),
    distinctive_markings: asString(value.distinctive_markings),
    contact_phone: asString(value.contact_phone),
    contact_email: asString(value.contact_email),
  };
}

export function blankPetValues(): PetDraftValues {
  return { name: "", breed: "", color: "", age: "", temperament_tags: "" };
}

export function blankFlyerValues(): FlyerDraftValues {
  return {
    last_seen_location: "",
    last_seen_date: "",
    distinctive_markings: "",
    contact_phone: "",
    contact_email: "",
  };
}

/** Prefill only confident detections; low-confidence guesses stay blank. */
export function initialPetValuesForPhoto(photo: PhotoUploadResult | null): PetDraftValues {
  const values = blankPetValues();
  if (!photo) return values;
  values.breed = (photo.breed && (photo.breed_confidence ?? 0) >= HIGH_CONFIDENCE) ? photo.breed : "";
  values.color = (photo.color && (photo.color_confidence ?? 0) >= HIGH_CONFIDENCE) ? photo.color : "";
  return values;
}

/** Blob URLs die with their object URL; persisted drafts use the signed server previews. */
export function withoutLocalUrl<T extends PhotoUploadResult>(photo: T): PhotoUploadResult {
  const persisted = { ...photo } as PhotoUploadResult & { localUrl?: string };
  delete persisted.localUrl;
  return persisted;
}

function normalizedPetValues(values: PetDraftValues): PetDraftValues {
  return {
    name: values.name ?? "",
    breed: values.breed ?? "",
    color: values.color ?? "",
    age: values.age ?? "",
    temperament_tags: values.temperament_tags ?? "",
  };
}

export function samePetValues(a: PetDraftValues, b: PetDraftValues | null): boolean {
  if (!b) return false;
  return JSON.stringify(normalizedPetValues(a)) === JSON.stringify(normalizedPetValues(b));
}

export function createEmptyDraft(mode: Mode = "emergency", ownerId: string | null = null): FlyerDraft {
  return {
    version: DRAFT_VERSION,
    ownerId,
    step: 0,
    mode,
    photo: null,
    pet: null,
    petValues: blankPetValues(),
    petFormSnapshot: null,
    flyerValues: blankFlyerValues(),
    coords: null,
    prefillContactEmail: true,
    updatedAt: 0,
  };
}

function hasDraftContent(draft: FlyerDraft): boolean {
  return (
    draft.step !== 0 ||
    draft.photo !== null ||
    draft.pet !== null ||
    draft.coords !== null ||
    Object.values(draft.petValues).some((value) => (value ?? "").trim() !== "") ||
    Object.values(draft.flyerValues).some((value) => value.trim() !== "")
  );
}

/** Ignore unavailable/blocked storage without interrupting flyer creation. */
export function saveDraft(draft: FlyerDraft): void {
  if (typeof window === "undefined") return;
  try {
    if (!hasDraftContent(draft)) {
      window.localStorage.removeItem(DRAFT_KEY);
      return;
    }
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, updatedAt: Date.now() }));
  } catch {
    // Private browsing / full quota: the wizard still works in memory.
  }
}

export function clearDraft(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Nothing to do when storage is unavailable.
  }
}

export function loadDraft(): FlyerDraft {
  if (typeof window === "undefined") return createEmptyDraft();
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return createEmptyDraft();
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== DRAFT_VERSION) {
      clearDraft();
      return createEmptyDraft();
    }
    return {
      version: DRAFT_VERSION,
      ownerId: typeof parsed.ownerId === "string" ? parsed.ownerId : null,
      step: asStep(parsed.step),
      mode: asMode(parsed.mode),
      photo: asPhoto(parsed.photo),
      pet: isRecord(parsed.pet) && typeof parsed.pet.id === "string" ? (parsed.pet as Pet) : null,
      petValues: asPetValues(parsed.petValues),
      petFormSnapshot: isRecord(parsed.petFormSnapshot) ? asPetValues(parsed.petFormSnapshot) : null,
      flyerValues: asFlyerValues(parsed.flyerValues),
      coords: asCoordinates(parsed.coords),
      prefillContactEmail: parsed.prefillContactEmail === true,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
    };
  } catch {
    clearDraft();
    return createEmptyDraft();
  }
}
