import { startTransition, useActionState, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/stores/auth";
import { ApiError } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { FieldShell, Input, Textarea } from "@/components/ui/field";
import { ErrorBox, Skeleton } from "@/components/ui/feedback";
import { LocationPicker } from "@/components/maps/LocationPicker";
import { PhotoUpload, type LocalPhotoUploadResult } from "@/features/pets/components/PhotoUpload";
import { petSchemaFor, parseTags, SPECIES, type PetValues, type Species } from "@/features/pets/petSchema";
import { PHOTO_CATEGORY_BY_MODE } from "@/features/pets/api";
import { flyerDetailQuery, useUpdateFlyer, type Flyer } from "@/features/flyers/api";
import { hasPhotoInput, isFlyerEditable, isFlyerOwner, tagsText, toDateTimeLocal, toIsoDateTime } from "@/features/flyers/edit-helpers";
import { flyerSchemaFor, type FlyerValues } from "@/features/flyers/flyerSchema";

interface SubmitState {
  error: string | null;
}

const initialSubmitState: SubmitState = { error: null };

type EditValues = FlyerValues & PetValues;

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

export function FlyerEditPage() {
  const { id = "" } = useParams<{ id: string }>();
  const { user, checked } = useAuth();
  const query = useQuery(flyerDetailQuery(id));

  if (!checked || query.isLoading) {
    return (
      <section className="page-section">
        <div className="wrap" style={{ maxWidth: 720 }}>
          <Skeleton style={{ height: 40, width: "45%", marginBottom: 24 }} />
          <Skeleton style={{ height: 420, borderRadius: 24 }} />
        </div>
      </section>
    );
  }

  if (query.isError || !query.data) {
    return (
      <section className="page-section">
        <div className="wrap" style={{ maxWidth: 620 }}>
          <ErrorBox message="Could not load this flyer. Please try again." />
        </div>
      </section>
    );
  }

  const flyer = query.data;
  if (!isFlyerOwner(flyer, user)) {
    return (
      <section className="page-section">
        <div className="wrap" style={{ maxWidth: 620 }}>
          <ErrorBox message="You can only edit flyers you created.">
            <div className="btn-row" style={{ marginTop: 16 }}>
              <Button asChild>
                <Link to={`/flyers/${flyer.id}`}>Back to flyer</Link>
              </Button>
            </div>
          </ErrorBox>
        </div>
      </section>
    );
  }

  if (!isFlyerEditable(flyer)) {
    return (
      <section className="page-section">
        <div className="wrap" style={{ maxWidth: 620 }}>
          <ErrorBox message="This flyer has been resolved and can no longer be edited.">
            <div className="btn-row" style={{ marginTop: 16 }}>
              <Button asChild>
                <Link to={`/flyers/${flyer.id}`}>Back to flyer</Link>
              </Button>
            </div>
          </ErrorBox>
        </div>
      </section>
    );
  }

  return <FlyerEditForm key={flyer.id} flyer={flyer} />;
}

/** Seed the replacement uploader with the flyer's current cover photo. */
function currentPhoto(flyer: Flyer): LocalPhotoUploadResult | null {
  if (!flyer.pet.photo_path) return null;
  return {
    key: flyer.pet.photo_path,
    url: flyer.pet.photo_url,
    thumb_key: flyer.pet.photo_path.replace(/\.jpg$/, "_thumb.jpg"),
    thumb_url: flyer.pet.photo_url,
    pet_classes: [],
    detected_classes: [],
    max_confidence: 0,
  };
}

function FlyerEditForm({ flyer }: { flyer: Flyer }) {
  const navigate = useNavigate();
  const mode = flyer.mode ?? "outreach";
  const found = mode === "found";
  const emergency = mode === "emergency";
  const needsWhereAndWhen = emergency || found;
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    flyer.location_lat != null && flyer.location_lng != null
      ? { lat: flyer.location_lat, lng: flyer.location_lng }
      : null,
  );
  const [photo, setPhoto] = useState<LocalPhotoUploadResult | null>(() => currentPhoto(flyer));
  const photoReady = hasPhotoInput(photo?.key);

  const form = useForm<EditValues>({
    resolver: zodResolver(flyerSchemaFor(mode).and(petSchemaFor(mode))),
    defaultValues: {
      last_seen_location: flyer.last_seen_location ?? "",
      last_seen_date: toDateTimeLocal(flyer.last_seen_date),
      distinctive_markings: flyer.distinctive_markings ?? "",
      contact_phone: flyer.contact_phone ?? "",
      contact_email: flyer.contact_email ?? "",
      name: flyer.pet.name ?? "",
      species: (flyer.pet.species as Species | undefined) ?? "dog",
      breed: flyer.pet.breed ?? "",
      color: flyer.pet.color ?? "",
      age: flyer.pet.age != null ? String(flyer.pet.age) : "",
      temperament_tags: tagsText(flyer.pet.temperament_tags),
    },
  });

  const updateFlyer = useUpdateFlyer(flyer.id);
  const [state, submit, pending] = useActionState<SubmitState, EditValues>(
    async (_prev, values) => {
      if (!photoReady) {
        return { error: "Upload a photo before saving." };
      }
      try {
        await updateFlyer.mutateAsync({
          last_seen_location: values.last_seen_location || "",
          last_seen_date: toIsoDateTime(values.last_seen_date),
          location_lat: coords?.lat ?? null,
          location_lng: coords?.lng ?? null,
          distinctive_markings: values.distinctive_markings || "",
          photo_path: photo?.key ?? "",
          contact_phone: values.contact_phone || "",
          contact_email: values.contact_email || "",
          name: values.name || "",
          species: values.species ?? "dog",
          breed: values.breed || "",
          color: values.color || "",
          age: values.age ? Number(values.age) : null,
          temperament_tags: parseTags(values.temperament_tags ?? ""),
        });
        // The mutation invalidates every flyer query, so cards and map pins
        // pick up the new details when the owner returns to the detail page.
        navigate(`/flyers/${flyer.id}`);
        return { error: null };
      } catch (error) {
        return {
          error: error instanceof ApiError
            ? error.message
            : "Could not save the changes. Please try again.",
        };
      }
    },
    initialSubmitState,
  );

  const saving = pending || updateFlyer.isPending;

  return (
    <section className="page-section">
      <div className="wrap" style={{ maxWidth: 720 }}>
        <div className="section-head">
          <div>
            <p className="t-label" style={{ color: "var(--color-muted)", marginBottom: 8 }}>
              Your flyer
            </p>
            <h1 className="t-h1" data-enter>Edit flyer &amp; pet</h1>
          </div>
          <Button variant="secondary" asChild data-enter="2">
            <Link to={`/flyers/${flyer.id}`}>← Back to flyer</Link>
          </Button>
        </div>

        <div className="card form-card">
          <form
            onSubmit={form.handleSubmit((values) => {
              if (!photoReady) return;
              startTransition(() => submit(values));
            })}
            style={{ display: "flex", flexDirection: "column", gap: 16 }}
            noValidate
          >
            <FieldShell
              label="Cover photo"
              hint="A photo is required. Upload a new one to replace the current cover."
              error={photoReady ? undefined : "Upload a photo before saving."}
            >
              <PhotoUpload
                uploaded={photo ? [photo] : []}
                category={PHOTO_CATEGORY_BY_MODE[mode]}
                showDetectedBadge={false}
                onUploaded={setPhoto}
                onRemove={() => setPhoto(null)}
              />
            </FieldShell>

            <p className="t-label" style={{ color: "var(--color-muted)", margin: "8px 0 0" }}>
              Pet details
            </p>

            {!found && (
              <FieldShell label="Pet name" htmlFor="edit-pet-name" error={form.formState.errors.name?.message}>
                <Input
                  id="edit-pet-name"
                  autoComplete="off"
                  aria-invalid={Boolean(form.formState.errors.name)}
                  {...form.register("name")}
                />
              </FieldShell>
            )}

            <div className="split-2" style={{ gap: 16 }}>
              <FieldShell label="Species" htmlFor="edit-pet-species">
                <select id="edit-pet-species" className="select" {...form.register("species")}>
                  {SPECIES.map((species) => (
                    <option key={species} value={species}>{capitalize(species)}</option>
                  ))}
                </select>
              </FieldShell>
              {!found && (
                <FieldShell label="Age (years)" htmlFor="edit-pet-age" error={form.formState.errors.age?.message}>
                  <Input
                    id="edit-pet-age"
                    inputMode="numeric"
                    placeholder="0–50"
                    aria-invalid={Boolean(form.formState.errors.age)}
                    {...form.register("age")}
                  />
                </FieldShell>
              )}
            </div>

            <div className="split-2" style={{ gap: 16 }}>
              <FieldShell label="Breed" htmlFor="edit-pet-breed" error={form.formState.errors.breed?.message}>
                <Input
                  id="edit-pet-breed"
                  autoComplete="off"
                  aria-invalid={Boolean(form.formState.errors.breed)}
                  {...form.register("breed")}
                />
              </FieldShell>
              <FieldShell label="Color" htmlFor="edit-pet-color" error={form.formState.errors.color?.message}>
                <Input
                  id="edit-pet-color"
                  autoComplete="off"
                  aria-invalid={Boolean(form.formState.errors.color)}
                  {...form.register("color")}
                />
              </FieldShell>
            </div>

            {!found && (
              <FieldShell
                label="Personality tags"
                htmlFor="edit-pet-tags"
                hint="Comma-separated, e.g. friendly, good with kids, house-trained"
                error={form.formState.errors.temperament_tags?.message}
              >
                <Input
                  id="edit-pet-tags"
                  autoComplete="off"
                  aria-invalid={Boolean(form.formState.errors.temperament_tags)}
                  {...form.register("temperament_tags")}
                />
              </FieldShell>
            )}

            {needsWhereAndWhen && (
              <>
                <Controller
                  control={form.control}
                  name="last_seen_location"
                  render={({ field, fieldState }) => (
                    <LocationPicker
                      id="edit-flyer-location"
                      label={emergency ? "Last seen location" : "Location found"}
                      placeholder={emergency ? "Search an address or drop the pin…" : "Search where you found the pet…"}
                      error={fieldState.error?.message}
                      value={field.value ?? ""}
                      initialCoords={coords}
                      onChange={(value) => {
                        field.onChange(value.address);
                        setCoords(value.lat != null && value.lng != null ? { lat: value.lat, lng: value.lng } : null);
                      }}
                    />
                  )}
                />
                <FieldShell
                  label={emergency ? "Last seen date & time" : "Date & time found"}
                  htmlFor="edit-flyer-date"
                  hint="Future dates aren't allowed."
                  error={form.formState.errors.last_seen_date?.message}
                >
                  <Input
                    id="edit-flyer-date"
                    type="datetime-local"
                    aria-invalid={Boolean(form.formState.errors.last_seen_date)}
                    {...form.register("last_seen_date")}
                  />
                </FieldShell>
              </>
            )}

            <FieldShell
              label={needsWhereAndWhen ? "Distinctive markings" : "Description"}
              htmlFor="edit-flyer-marks"
              error={form.formState.errors.distinctive_markings?.message}
            >
              <Textarea
                id="edit-flyer-marks"
                placeholder={emergency ? "e.g. white patch on left ear, blue collar" : "Add details that help people recognise this pet"}
                aria-invalid={Boolean(form.formState.errors.distinctive_markings)}
                {...form.register("distinctive_markings")}
              />
            </FieldShell>

            <div className="split-2" style={{ gap: 16 }}>
              <FieldShell label="Contact phone" htmlFor="edit-flyer-phone" error={form.formState.errors.contact_phone?.message}>
                <Input
                  id="edit-flyer-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  aria-invalid={Boolean(form.formState.errors.contact_phone)}
                  {...form.register("contact_phone")}
                />
              </FieldShell>
              <FieldShell label="Contact email" htmlFor="edit-flyer-email" error={form.formState.errors.contact_email?.message}>
                <Input
                  id="edit-flyer-email"
                  type="email"
                  autoComplete="email"
                  aria-invalid={Boolean(form.formState.errors.contact_email)}
                  {...form.register("contact_email")}
                />
              </FieldShell>
            </div>

            {state.error && <ErrorBox message={state.error} />}

            <div className="btn-row">
              <Button type="submit" variant={emergency ? "emergency" : found ? "found" : "sage"} disabled={saving || !photoReady} aria-live="polite">
                {saving ? "Saving…" : "Save changes"}
              </Button>
              <Button variant="secondary" asChild>
                <Link to={`/flyers/${flyer.id}`}>Cancel</Link>
              </Button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
