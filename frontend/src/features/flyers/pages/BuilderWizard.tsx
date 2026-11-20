import { startTransition, useActionState, useEffect, useOptimistic, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/stores/auth";
import { ApiError } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { FieldShell, Input, Textarea } from "@/components/ui/field";
import { ErrorBox } from "@/components/ui/feedback";
import { PhotoUpload, type LocalPhotoUploadResult } from "@/features/pets/components/PhotoUpload";
import { LocationPicker } from "@/components/maps/LocationPicker";
import { useCreatePet, HIGH_CONFIDENCE, type Pet, type PhotoUploadResult } from "@/features/pets/api";
import { useCreateFlyer, type Flyer, type Mode } from "@/features/flyers/api";
import { FlyerCard } from "@/components/FlyerCard";

const SPECIES = ["dog", "cat", "bird", "horse", "other"] as const;

// Map YOLO-World's open-vocabulary labels to our standard species values.
// Expanded animals (lion, rabbit, …) use "other"; ambiguous multi-species
// detections fall back to the first standard match.
type Species = (typeof SPECIES)[number];
function detectedSpecies(detectedClasses: string[]): Species | null {
  const labels = new Set(detectedClasses.map((label) => label.toLowerCase()));
  const standardMatches = SPECIES.slice(0, 4).filter((species) => labels.has(species));
  if (standardMatches.length === 1) return standardMatches[0];
  if (standardMatches.length > 1) return standardMatches[0];
  return detectedClasses.length > 0 ? "other" : null;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Prefill only confident detections — below the threshold the field stays blank
 *  and simply shows the "Not detected" placeholder. */
function prefill(value: string | undefined, confidence: number | undefined): string {
  if (!value || (confidence ?? 0) < HIGH_CONFIDENCE) return "";
  return value;
}

const petSchemaBase = z.object({
  name: z.string().max(120).optional().or(z.literal("")),
  breed: z.string().max(120).optional().or(z.literal("")),
  color: z.string().max(120).optional().or(z.literal("")),
  age: z.string().regex(/^\d{1,2}$/, "Age in years (up to 2 digits).").optional().or(z.literal("")),
  temperament_tags: z.string().optional().or(z.literal("")),
});
type PetValues = z.infer<typeof petSchemaBase>;

/**
 * Pet form schema — a name is required for lost/adoptable pets, but a found-pet
 * report has no name (the owner is unknown), so the field is hidden there.
 */
function petSchemaFor(mode: Mode) {
  return petSchemaBase.superRefine((v, ctx) => {
    if (mode !== "found" && !v.name?.trim()) {
      ctx.addIssue({ code: "custom", path: ["name"], message: "Give the pet a name." });
    }
  });
}

const flyerSchema = z
  .object({
    last_seen_location: z.string().max(255).optional().or(z.literal("")),
    last_seen_date: z.string().optional().or(z.literal("")),
    distinctive_markings: z.string().max(1000).optional().or(z.literal("")),
    contact_phone: z.string().max(32).optional().or(z.literal("")),
    contact_email: z.email("Enter a valid email.").optional().or(z.literal("")),
    reward_enabled: z.boolean(),
    reward_pesos: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/, "Enter an amount in pesos, e.g. 5000.")
      .optional()
      .or(z.literal("")),
  })
  .superRefine((v, ctx) => {
    if (v.reward_enabled && (!v.reward_pesos || Number(v.reward_pesos) <= 0)) {
      ctx.addIssue({ code: "custom", path: ["reward_pesos"], message: "Enter a reward amount above zero." });
    }
  });
type FlyerValues = z.infer<typeof flyerSchema>;

interface StepState {
  error: string | null;
}

const initialStepState: StepState = { error: null };

function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function draftFlyer(
  pet: Pet,
  photo: PhotoUploadResult,
  mode: Mode,
  values: FlyerValues,
  coords: { lat: number; lng: number } | null,
): Flyer {
  const now = new Date().toISOString();
  return {
    id: "pending",
    mode,
    status: "generating",
    pet,
    creator: "",
    creator_display_name: "",
    last_seen_location: values.last_seen_location,
    last_seen_date: values.last_seen_date ? new Date(values.last_seen_date).toISOString() : null,
    location_lat: coords?.lat ?? null,
    location_lng: coords?.lng ?? null,
    distinctive_markings: values.distinctive_markings,
    contact_phone: values.contact_phone,
    contact_email: values.contact_email,
    reward_enabled: values.reward_enabled,
    reward_amount_cents: Math.round(Number(values.reward_pesos || 0) * 100),
    reward_currency: "PHP",
    qr_target_type: "flyer_url",
    qr_target_value: "",
    photo_url: photo.url,
    export_png_url: "",
    export_pdf_url: "",
    created_at: now,
    updated_at: now,
  } as Flyer;
}

export function BuilderWizard() {
  const [params] = useSearchParams();
  const { user, checked } = useAuth();
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<Mode>(() => {
    const m = params.get("mode");
    return m === "outreach" || m === "found" ? m : "emergency";
  });
  // All uploaded angles of the pet — the first is the cover photo; matching on the
  // backend compares every photo pair, so extra angles raise the chance of a hit.
  const [photos, setPhotos] = useState<LocalPhotoUploadResult[]>([]);
  const [pet, setPet] = useState<Pet | null>(null);

  if (checked && !user) {
    return (
      <section style={{ padding: "72px 0" }}>
        <div className="wrap" style={{ maxWidth: 520 }}>
          <h1 className="t-h1" data-enter style={{ fontSize: "clamp(28px, 4vw, 40px)", marginBottom: 12 }}>
            Register to post a flyer
          </h1>
          <p className="t-lead" data-enter="2" style={{ marginBottom: 24 }}>
            Browsing is open to everyone — posting needs a free account so finders can reach you.
          </p>
          <div className="btn-row" data-enter="3">
            <Button asChild>
              <Link to="/auth/register">Register free</Link>
            </Button>
            <Button variant="secondary" asChild>
              <Link to="/auth/login">Log in</Link>
            </Button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section style={{ padding: "64px 0" }}>
      <div className="wrap" style={{ maxWidth: 720 }}>
        <p className="t-label" data-enter style={{ marginBottom: 8 }}>
          New flyer — step {step + 1} of 3
        </p>
        <div className="step-row" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span key={i} className={`step-dot ${i === step ? "step-dot--on" : i < step ? "step-dot--done" : ""}`} />
          ))}
        </div>
        <h1 className="t-h1" data-enter="2" style={{ fontSize: "clamp(28px, 4vw, 42px)", marginBottom: 32 }}>
          {step === 0 && (mode === "emergency" ? "Report a lost pet" : mode === "found" ? "Report a found pet" : "Post an adoptable pet")}
          {step === 1 && (mode === "found" ? "Describe the found pet" : "Tell us about the pet")}
          {step === 2 && (mode === "emergency" ? "Flyer details & reward" : mode === "found" ? "Found-pet details" : "Flyer details")}
        </h1>

        {step === 0 && (
          <StepPhotoMode
            mode={mode}
            setMode={setMode}
            photos={photos}
            onUploaded={(r) =>
              setPhotos((prev) =>
                prev.some((p) => p.key === r.key) ? prev.map((p) => (p.key === r.key ? r : p)) : [...prev, r],
              )
            }
            onRemove={(key) => setPhotos((prev) => prev.filter((p) => p.key !== key))}
            onMakeCover={(key) =>
              setPhotos((prev) => {
                const target = prev.find((p) => p.key === key);
                return target ? [target, ...prev.filter((p) => p.key !== key)] : prev;
              })
            }
            onNext={() => setStep(1)}
          />
        )}
        {step === 1 && photos.length > 0 && <StepPet photos={photos} mode={mode} onDone={(p) => { setPet(p); setStep(2); }} onBack={() => setStep(0)} />}
        {step === 2 && photos.length > 0 && pet && user && <StepFlyer pet={pet} photo={photos[0]} mode={mode} userEmail={user.email} onBack={() => setStep(1)} />}
      </div>
    </section>
  );
}

function StepPhotoMode({
  mode,
  setMode,
  photos,
  onUploaded,
  onRemove,
  onMakeCover,
  onNext,
}: {
  mode: Mode;
  setMode: (m: Mode) => void;
  photos: LocalPhotoUploadResult[];
  onUploaded: (r: LocalPhotoUploadResult) => void;
  onRemove: (key: string) => void;
  onMakeCover: (key: string) => void;
  onNext: () => void;
}) {
  return (
    <div className="card" style={{ padding: 28, display: "flex", flexDirection: "column", gap: 24 }} data-enter="3">
      <div className="btn-row" role="group" aria-label="Flyer mode">
        <Button
          type="button"
          variant={mode === "emergency" ? "emergency" : "secondary"}
          aria-pressed={mode === "emergency"}
          onClick={() => setMode("emergency")}
        >
          Lost — urgent
        </Button>
        <Button
          type="button"
          variant={mode === "found" ? "found" : "secondary"}
          aria-pressed={mode === "found"}
          onClick={() => setMode("found")}
        >
          Found pet
        </Button>
        <Button
          type="button"
          variant={mode === "outreach" ? "sage" : "secondary"}
          aria-pressed={mode === "outreach"}
          onClick={() => setMode("outreach")}
        >
          Adoptable
        </Button>
      </div>
      <p className="t-body" style={{ color: "var(--color-muted)" }}>
        {mode === "emergency"
          ? "We'll build a scannable, print-ready alert with last-seen details and an optional reward."
          : mode === "found"
            ? "We'll post a found-pet flyer with the location, photo and your contact details so the owner can find them."
            : "We'll build a warm adoption flyer with personality tags and contact details."}
      </p>
      <FieldShell
        label="Pet photo"
        hint={`Every photo is checked by our pet detector before upload — a non-pet photo is simply rejected, never penalised. Add up to 4 photos from different angles: lost/found matching compares every photo pair, so the same pet from another angle still matches.`}
      >
        <PhotoUpload
          onUploaded={onUploaded}
          onRemove={onRemove}
          onMakeCover={onMakeCover}
          uploaded={photos}
        />
      </FieldShell>
      {photos.length > 0 && (
        <div className="btn-row">
          <Button type="button" onClick={onNext}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

function StepPet({
  photos,
  mode,
  onDone,
  onBack,
}: {
  photos: LocalPhotoUploadResult[];
  mode: Mode;
  onDone: (pet: Pet) => void;
  onBack: () => void;
}) {
  const createPet = useCreatePet();
  // Detection runs on the latest uploaded photo (the cover is photos[0]);
  // prefer the CLIP-refined species names; fall back to raw YOLO-World labels.
  const photo = photos[photos.length - 1];
  const detectedLabels = photo.pet_classes?.length ? photo.pet_classes : photo.detected_classes;
  const speciesText = detectedLabels.length > 0 ? detectedLabels.map(capitalize).join(", ") : "Not detected";
  const autoSpecies = (detectedSpecies(detectedLabels) ?? "dog") as Species;
  const form = useForm<PetValues>({
    resolver: zodResolver(petSchemaFor(mode)),
    defaultValues: {
      name: "",
      breed: prefill(photo.breed, photo.breed_confidence),
      color: prefill(photo.color, photo.color_confidence),
      age: "",
      temperament_tags: "",
    },
  });
  // Re-running detection on a new photo re-prefills breed & color automatically.
  useEffect(() => {
    form.setValue("breed", prefill(photo.breed, photo.breed_confidence));
    form.setValue("color", prefill(photo.color, photo.color_confidence));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo.key]);
  const showAutofillTip = Boolean(photo.breed || photo.color);
  const [state, submit, pending] = useActionState(async (_prev: StepState, values: PetValues): Promise<StepState> => {
    try {
      const pet = await createPet.mutateAsync({
        // Found pets are unnamed — the finder doesn't know the owner's pet — and
        // carry no age either (the finder can't know it).
        name: mode === "found" ? "" : (values.name ?? "").trim(),
        species: autoSpecies,
        breed: values.breed || undefined,
        color: values.color || undefined,
        age: mode === "found" ? null : values.age ? Number(values.age) : null,
        temperament_tags: parseTags(values.temperament_tags ?? ""),
        photo_path: photos[0].key,
        photo_paths: photos.map((p) => p.key),
        status: mode === "emergency" ? "lost" : mode === "found" ? "found" : "adoptable",
      });
      onDone(pet);
      return { error: null };
    } catch (e) {
      return { error: e instanceof ApiError ? e.message : "Could not save the pet. Please try again." };
    }
  }, initialStepState);

  return (
    <div className="card" style={{ padding: 28 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span className="t-label" style={{ color: "var(--color-muted)" }}>
          {mode === "found" ? "Describe the found pet" : "Tell us about the pet"}
        </span>
        <Button type="button" variant="secondary" onClick={onBack}>
          ← Back
        </Button>
      </div>
      <form onSubmit={form.handleSubmit((v) => startTransition(() => submit(v)))} style={{ display: "flex", flexDirection: "column", gap: 16 }} noValidate>
        {mode !== "found" && (
          <FieldShell label="Pet name" htmlFor="pet-name" error={form.formState.errors.name?.message}>
            <Input id="pet-name" autoComplete="off" aria-invalid={Boolean(form.formState.errors.name)} {...form.register("name")} />
          </FieldShell>
        )}
        <div className="split-2" style={{ gap: 16 }}>
          <FieldShell label="Species" htmlFor="pet-species" hint="Auto detected: change photo to redetect">
            <p id="pet-species" data-testid="species-value" className="t-body" style={{ fontWeight: 600, padding: "10px 0" }}>
              {speciesText}
            </p>
          </FieldShell>
          {mode !== "found" && (
            <FieldShell label="Age (years)" htmlFor="pet-age" error={form.formState.errors.age?.message}>
              <Input id="pet-age" inputMode="numeric" aria-invalid={Boolean(form.formState.errors.age)} {...form.register("age")} />
            </FieldShell>
          )}
        </div>
        <div className="split-2" style={{ gap: 16 }}>
          <FieldShell label="Breed" htmlFor="pet-breed" error={form.formState.errors.breed?.message}>
            <Input id="pet-breed" autoComplete="off" placeholder="Not detected" aria-invalid={Boolean(form.formState.errors.breed)} {...form.register("breed")} />
          </FieldShell>
          <FieldShell label="Color" htmlFor="pet-color" error={form.formState.errors.color?.message}>
            <Input id="pet-color" autoComplete="off" placeholder="Not detected" aria-invalid={Boolean(form.formState.errors.color)} {...form.register("color")} />
          </FieldShell>
        </div>
        {showAutofillTip && (
          <p className="t-small" data-testid="autofill-tip" style={{ color: "var(--color-muted)" }}>
            Auto-detected — change if not correct. Detection is not 100% accurate.
          </p>
        )}
        {mode !== "found" && (
          <FieldShell
            label="Personality tags"
            htmlFor="pet-tags"
            hint="Comma-separated, e.g. friendly, good with kids, house-trained"
            error={form.formState.errors.temperament_tags?.message}
          >
            <Input id="pet-tags" autoComplete="off" {...form.register("temperament_tags")} />
          </FieldShell>
        )}
        {mode === "found" && (
          <p className="t-small" data-testid="found-hint" style={{ color: "var(--color-muted)" }}>
            No name needed — describe the pet in the next step instead.
          </p>
        )}
        {state.error && <ErrorBox message={state.error} />}
        <div className="btn-row">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Continue"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function StepFlyer({
  pet,
  photo,
  mode,
  userEmail,
  onBack,
}: {
  pet: Pet;
  photo: PhotoUploadResult;
  mode: Mode;
  userEmail: string;
  onBack: () => void;
}) {
  const navigate = useNavigate();
  const createFlyer = useCreateFlyer();
  const found = mode === "found";
  const [rewardOn, setRewardOn] = useState(mode === "emergency");
  // Pin coordinates from the LocationPicker map (null when only text was typed).
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const form = useForm<FlyerValues>({
    resolver: zodResolver(flyerSchema),
    defaultValues: {
      last_seen_location: "",
      last_seen_date: "",
      distinctive_markings: "",
      contact_phone: "",
      contact_email: userEmail,
      reward_enabled: mode === "emergency",
      reward_pesos: "",
    },
  });

  const setLocation = (v: { address: string; lat: number | null; lng: number | null }) => {
    form.setValue("last_seen_location", v.address, { shouldValidate: true });
    setCoords(v.lat != null && v.lng != null ? { lat: v.lat, lng: v.lng } : null);
  };

  // Instant insert: while the create call is in flight, the new flyer card shows optimistically.
  const [optimisticFlyer, addOptimistic] = useOptimistic<Flyer | null, Flyer | null>(null, (_cur, f) => f);
  const [state, submit, pending] = useActionState(async (_prev: StepState, values: FlyerValues): Promise<StepState> => {
    // The action runs inside a transition, so the optimistic card shows while pending.
    addOptimistic(draftFlyer(pet, photo, mode, values, coords));
    try {
      const flyer = await createFlyer.mutateAsync({
        pet_id: pet.id,
        mode,
        last_seen_location: values.last_seen_location || undefined,
        last_seen_date: values.last_seen_date ? new Date(values.last_seen_date).toISOString() : null,
        location_lat: coords?.lat ?? null,
        location_lng: coords?.lng ?? null,
        distinctive_markings: values.distinctive_markings || undefined,
        contact_phone: values.contact_phone || undefined,
        contact_email: values.contact_email || undefined,
        // Found-pet flyers never carry a reward.
        reward_enabled: found ? false : values.reward_enabled,
        reward_amount_cents: !found && values.reward_enabled ? Math.round(Number(values.reward_pesos) * 100) : 0,
        reward_currency: "PHP",
      });
      navigate(`/flyers/${flyer.id}`);
      return { error: null };
    } catch (e) {
      return { error: e instanceof ApiError ? e.message : "Could not publish the flyer. Please try again." };
    }
  }, initialStepState);

  if (pending && optimisticFlyer) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }} data-testid="publishing">
        <p className="t-lead">Publishing your flyer…</p>
        <div style={{ maxWidth: 320 }}>
          <FlyerCard flyer={optimisticFlyer} />
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 28 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span className="t-label" style={{ color: "var(--color-muted)" }}>{found ? "Found-pet details" : "Flyer details & reward"}</span>
        <Button type="button" variant="secondary" onClick={onBack}>
          ← Back
        </Button>
      </div>
      <form onSubmit={form.handleSubmit((v) => startTransition(() => submit(v)))} style={{ display: "flex", flexDirection: "column", gap: 16 }} noValidate>
        {mode === "emergency" && (
          <>
            <LocationPicker
              id="flyer-loc"
              label="Last seen location"
              placeholder="Search an address or drop the pin…"
              error={form.formState.errors.last_seen_location?.message}
              value={form.watch("last_seen_location") ?? ""}
              onChange={setLocation}
            />
            <FieldShell label="Last seen date & time" htmlFor="flyer-date" error={form.formState.errors.last_seen_date?.message}>
              <Input id="flyer-date" type="datetime-local" {...form.register("last_seen_date")} />
            </FieldShell>
            <FieldShell label="Distinctive markings" htmlFor="flyer-marks" error={form.formState.errors.distinctive_markings?.message}>
              <Textarea
                id="flyer-marks"
                placeholder="e.g. white patch on left ear, blue collar"
                {...form.register("distinctive_markings")}
              />
            </FieldShell>
          </>
        )}
        {found && (
          <>
            <LocationPicker
              id="flyer-loc-found"
              label="Location found"
              placeholder="Search an address or drop the pin where you found the pet…"
              error={form.formState.errors.last_seen_location?.message}
              value={form.watch("last_seen_location") ?? ""}
              onChange={setLocation}
            />
            <FieldShell label="Date & time found" htmlFor="flyer-date-found" error={form.formState.errors.last_seen_date?.message}>
              <Input id="flyer-date-found" type="datetime-local" {...form.register("last_seen_date")} />
            </FieldShell>
            <FieldShell label="Description" htmlFor="flyer-desc" error={form.formState.errors.distinctive_markings?.message}>
              <Textarea
                id="flyer-desc"
                placeholder="e.g. orange tabby with a torn ear, very friendly, found near the market"
                {...form.register("distinctive_markings")}
              />
            </FieldShell>
          </>
        )}
        <div className="split-2" style={{ gap: 16 }}>
          <FieldShell label="Contact phone" htmlFor="flyer-phone" error={form.formState.errors.contact_phone?.message}>
            <Input id="flyer-phone" type="tel" autoComplete="tel" {...form.register("contact_phone")} />
          </FieldShell>
          <FieldShell label="Contact email" htmlFor="flyer-email" error={form.formState.errors.contact_email?.message}>
            <Input
              id="flyer-email"
              type="email"
              autoComplete="email"
              aria-invalid={Boolean(form.formState.errors.contact_email)}
              {...form.register("contact_email")}
            />
          </FieldShell>
        </div>

        {!found && (
          <div className="field">
            <label style={{ display: "flex", gap: 10, alignItems: "center", cursor: "pointer" }}>
              <input
                type="checkbox"
                style={{ width: 20, height: 20, accentColor: mode === "emergency" ? "var(--color-emergency)" : "var(--color-sage)" }}
                checked={rewardOn}
                onChange={(e) => {
                  setRewardOn(e.target.checked);
                  form.setValue("reward_enabled", e.target.checked);
                }}
              />
              <span style={{ fontWeight: 600, fontSize: 14 }}>Offer a finder's reward</span>
            </label>
            {rewardOn && (
              <FieldShell label="Reward amount (PHP)" htmlFor="flyer-reward" error={form.formState.errors.reward_pesos?.message}>
                <Input
                  id="flyer-reward"
                  inputMode="decimal"
                  placeholder="e.g. 5000"
                  aria-invalid={Boolean(form.formState.errors.reward_pesos)}
                  {...form.register("reward_pesos")}
                />
              </FieldShell>
            )}
          </div>
        )}

        {state.error && <ErrorBox message={state.error} />}
        <div className="btn-row">
          <Button type="submit" variant={mode === "emergency" ? "emergency" : found ? "found" : "sage"} disabled={pending}>
            {pending ? "Publishing…" : "Publish flyer"}
          </Button>
        </div>
      </form>
    </div>
  );
}
