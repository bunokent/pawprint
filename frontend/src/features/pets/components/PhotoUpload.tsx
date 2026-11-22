import { useEffect, useRef, useState } from "react";
import { Check, ImagePlus, LoaderCircle, X } from "lucide-react";
import { useUploadPetPhoto, type PhotoUploadResult } from "@/features/pets/api";
import { ApiError } from "@/lib/api/client";
import { Button } from "@/components/ui/button";

// Extend PhotoUploadResult locally for the local URL preview
export interface LocalPhotoUploadResult extends PhotoUploadResult {
  localUrl?: string;
}

interface PhotoUploadProps {
  /** Called once per accepted photo (several files can be picked at once). */
  onUploaded: (result: LocalPhotoUploadResult) => void;
  onRemove: (key: string) => void;
  /** Promote a thumbnail to the cover photo (first position). */
  onMakeCover: (key: string) => void;
  uploaded: LocalPhotoUploadResult[];
  maxPhotos?: number;
}

// Generous on purpose: a finder may snap the pet from every angle, and every angle
// helps the owner recognise it. The backend (MAX_PET_PHOTOS) caps at the same number.
const DEFAULT_MAX_PHOTOS = 10;

const UPLOAD_STAGES = [
  { id: "uploading", label: "Uploading photo", shortLabel: "Upload", detail: "Sending your photo over a secure connection" },
  { id: "scanning", label: "Scanning photo", shortLabel: "Scan", detail: "Reading the image and preparing it for pet detection" },
  { id: "detecting", label: "Detecting your pet", shortLabel: "Detect", detail: "YOLO-World is looking for a pet in your photo" },
  { id: "saving", label: "Saving securely", shortLabel: "Save", detail: "Removing metadata and preparing your private preview" },
] as const;

type UploadStage = (typeof UPLOAD_STAGES)[number]["id"];

/**
 * Pet-photo upload with the YOLO-World gatekeeper UX: a non-pet photo gets a 422
 * "no pet detected" response — never a ban — and the user can pick another file.
 * Several photos can be added at once (up to `maxPhotos`, e.g. different angles of
 * the same pet) so the flyer shows the pet from every side.
 */
export function PhotoUpload({ onUploaded, onRemove, onMakeCover, uploaded, maxPhotos = DEFAULT_MAX_PHOTOS }: PhotoUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingUrlRef = useRef<string | null>(null);
  // Every object URL we created, so removed/unmounted previews can be revoked.
  const urlRegistry = useRef(new Set<string>());
  const upload = useUploadPetPhoto();
  const [error, setError] = useState<ApiError | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [stage, setStage] = useState<UploadStage>("uploading");
  const [uploadProgress, setUploadProgress] = useState(0);
  // True while a multi-file batch is being processed (keeps the overlay up
  // between two sequential uploads).
  const [batchPending, setBatchPending] = useState(false);
  const busy = upload.isPending || batchPending;

  // Revoke object URLs that are no longer referenced by the uploaded list.
  useEffect(() => {
    const live = new Set(uploaded.map((p) => p.localUrl).filter(Boolean) as string[]);
    for (const url of urlRegistry.current) {
      if (!live.has(url)) {
        URL.revokeObjectURL(url);
        urlRegistry.current.delete(url);
      }
    }
  }, [uploaded]);

  useEffect(() => () => {
    if (pendingUrlRef.current) URL.revokeObjectURL(pendingUrlRef.current);
    for (const url of urlRegistry.current) URL.revokeObjectURL(url);
  }, []);

  // The endpoint is synchronous, so network progress is exact and the remaining
  // labels follow the server's scan → detect → save pipeline while it responds.
  useEffect(() => {
    if (!busy || (stage !== "scanning" && stage !== "detecting")) return;
    const nextStage: UploadStage = stage === "scanning" ? "detecting" : "saving";
    const timer = window.setTimeout(() => setStage(nextStage), stage === "scanning" ? 800 : 1000);
    return () => window.clearTimeout(timer);
  }, [busy, stage]);

  const pick = async (files: File[]) => {
    if (busy || files.length === 0) return;
    const slots = Math.max(0, maxPhotos - uploaded.length);
    const batch = files.slice(0, slots);
    if (batch.length === 0) return;
    setBatchPending(true);
    try {
      for (const file of batch) {
        if (pendingUrlRef.current) URL.revokeObjectURL(pendingUrlRef.current);
        const localUrl = URL.createObjectURL(file);
        urlRegistry.current.add(localUrl);
        pendingUrlRef.current = localUrl;

        setError(null);
        setImageFailed(false);
        setPendingPreview(localUrl);
        setStage("uploading");
        setUploadProgress(0);

        try {
          const result = await upload.mutateAsync({
            file,
            onProgress: (percentage) => {
              setUploadProgress(percentage);
              if (percentage === 100) {
                setStage((current) => current === "uploading" ? "scanning" : current);
              }
            },
          });
          // Ownership of the object URL passes to the controlled uploaded result.
          pendingUrlRef.current = null;
          onUploaded({ ...result, localUrl });
        } catch (e) {
          URL.revokeObjectURL(localUrl);
          urlRegistry.current.delete(localUrl);
          if (pendingUrlRef.current === localUrl) pendingUrlRef.current = null;
          setPendingPreview(null);
          setError(e instanceof ApiError ? e : new ApiError(e as never));
          // A rejected file in a multi-pick must not block the remaining ones.
        }
      }
    } finally {
      setPendingPreview(null);
      setBatchPending(false);
    }
  };

  const noPet = error?.status === 422 && error.code === "no_pet_detected";
  const cover = uploaded[0];
  const src = cover?.localUrl || cover?.thumb_url || cover?.url;
  const currentStageIndex = UPLOAD_STAGES.findIndex((item) => item.id === stage);
  const currentStage = UPLOAD_STAGES[currentStageIndex];
  const atLimit = uploaded.length >= maxPhotos;

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!busy) e.dataTransfer.dropEffect = "copy";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (!busy) void pick(Array.from(e.dataTransfer.files ?? []));
  };

  return (
    <div className="photo-upload" aria-busy={busy}>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="photo-upload__input"
        aria-label="Choose a pet photo"
        onChange={(e) => {
          void pick(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />

      <div
        className={`photo-frame photo-upload__frame${isDragging ? " photo-upload__frame--dragging" : ""}${busy ? " photo-upload__frame--pending" : ""}`}
        onDragEnter={(e) => {
          e.preventDefault();
          if (!busy) setIsDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setIsDragging(false);
        }}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {busy ? (
          <div className="photo-upload__processing">
            {pendingPreview && <img className="photo-upload__preview" src={pendingPreview} alt="" aria-hidden="true" />}
            <div className="photo-upload__scrim" aria-hidden="true" />
            <div className="photo-upload__scan-line" aria-hidden="true" />

            <div className="photo-upload__status-card">
              <div className="photo-upload__status-heading">
                <span className="photo-upload__spinner" aria-hidden="true">
                  <LoaderCircle size={22} strokeWidth={2} />
                </span>
                <div>
                  <p className="photo-upload__status-title" role="status" aria-live="polite" aria-atomic="true">
                    {currentStage.label}
                  </p>
                  <p className="photo-upload__status-detail">{currentStage.detail}</p>
                </div>
              </div>

              <div className="photo-upload__progress-meta">
                <span>Photo check</span>
                <span>{stage === "uploading" ? `${uploadProgress}%` : `Step ${currentStageIndex + 1} of ${UPLOAD_STAGES.length}`}</span>
              </div>
              <div
                className="photo-upload__progress"
                role="progressbar"
                aria-label="Photo upload progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={stage === "uploading" ? uploadProgress : undefined}
                aria-valuetext={stage === "uploading" ? `${uploadProgress}% uploaded` : currentStage.label}
              >
                <span
                  className={`photo-upload__progress-fill${stage === "uploading" ? "" : " photo-upload__progress-fill--indeterminate"}`}
                  style={stage === "uploading" ? { width: `${Math.max(3, uploadProgress)}%` } : undefined}
                />
              </div>

              <ol className="photo-upload__steps" aria-hidden="true">
                {UPLOAD_STAGES.map((item, index) => (
                  <li
                    key={item.id}
                    className={`photo-upload__step${index === currentStageIndex ? " photo-upload__step--current" : ""}${index < currentStageIndex ? " photo-upload__step--done" : ""}`}
                  >
                    <span className="photo-upload__step-marker">
                      {index < currentStageIndex ? <Check size={12} strokeWidth={3} /> : index + 1}
                    </span>
                    <span>{item.shortLabel}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        ) : uploaded.length > 0 && imageFailed ? (
          <div className="photo-upload__message">
            <span>Could not load photo</span>
            <p className="t-small">Pick another photo below</p>
          </div>
        ) : uploaded.length > 0 && src ? (
          <img
            className="photo-upload__uploaded-image"
            src={src}
            alt="Uploaded pet preview"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <button className="photo-upload__empty" type="button" onClick={() => inputRef.current?.click()}>
            <span className="photo-upload__icon" aria-hidden="true">
              <ImagePlus size={30} strokeWidth={1.8} />
            </span>
            <span className="photo-upload__empty-title">Drop your pet’s photos here</span>
            <span className="photo-upload__empty-action">or click to browse from your device</span>
            <span className="photo-upload__empty-hint">
              Add as many clear, well-lit photos as you like (up to {maxPhotos}) — different angles of the same pet help the owner recognise them.
            </span>
          </button>
        )}
      </div>

      {!busy && uploaded.length > 1 && (
        <div className="photo-upload__thumbs" role="group" aria-label="Uploaded photos">
          {uploaded.map((p, i) => (
            <div key={p.key} className={`photo-upload__thumb${i === 0 ? " photo-upload__thumb--cover" : ""}`}>
              <button
                type="button"
                className="photo-upload__thumb-btn"
                aria-pressed={i === 0}
                aria-label={i === 0 ? "Cover photo" : `Make photo ${i + 1} the cover photo`}
                onClick={() => onMakeCover(p.key)}
              >
                <img src={p.localUrl || p.thumb_url || p.url} alt={`Uploaded photo ${i + 1}`} />
              </button>
              <button
                type="button"
                className="photo-upload__thumb-remove"
                aria-label={`Remove photo ${i + 1}`}
                onClick={() => onRemove(p.key)}
              >
                <X size={13} strokeWidth={2.5} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="btn-row">
        <Button
          type="button"
          variant={uploaded.length > 0 ? "secondary" : "primary"}
          disabled={busy || atLimit}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? "Processing…" : uploaded.length === 0 ? "Choose a photo" : atLimit ? "Photo limit reached" : `Add photo (${uploaded.length}/${maxPhotos})`}
        </Button>
        {uploaded.length > 0 && !imageFailed && !busy && (
          <span className="badge badge--outreach">
            {cover?.pet_classes?.length ? `Detected: ${cover.pet_classes[0]} ✓` : "Pet detected ✓"}
          </span>
        )}
        {uploaded.length > 1 && <span className="badge badge--neutral">{uploaded.length} photos</span>}
      </div>

      {noPet && (
        <div className="error-box" role="alert" data-testid="no-pet-error">
          <p style={{ fontWeight: 600 }}>{error.message}</p>
          <p style={{ marginTop: 4 }}>
            No strikes, no bans — just pick another photo.
            {error.detectedLabels && error.detectedLabels.length > 0 && (
              <> Detected instead: {error.detectedLabels.join(", ")}.</>
            )}
          </p>
        </div>
      )}
      {error && !noPet && (
        <div className="error-box" role="alert">
          {error.message}
        </div>
      )}
    </div>
  );
}
