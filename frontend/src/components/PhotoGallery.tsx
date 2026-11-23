import { useCallback, useEffect, useRef, useState } from "react";
import { X, ZoomIn } from "lucide-react";

interface PhotoGalleryProps {
  /** Signed URL of the pet's single photo. Empty = no photo uploaded. */
  src?: string;
  /** Accessible description, e.g. "Bento — lost pet photo". */
  alt: string;
}

/**
 * The flyer's single pet photo, shown large. Clicking (or pressing Enter) opens a
 * keyboard-friendly full-screen viewer; Escape closes it and returns focus.
 * There is no photo count — one photo per pet is enforced by the backend.
 */
export function PhotoGallery({ src, alt }: PhotoGalleryProps) {
  const [lightbox, setLightbox] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  const openLightbox = () => {
    if (!src) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    setLightbox(true);
  };

  const closeLightbox = useCallback(() => {
    setLightbox(false);
    restoreRef.current?.focus?.();
  }, []);

  useEffect(() => {
    if (!lightbox) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeLightbox();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, closeLightbox]);

  if (!src) {
    return (
      <div className="flyer-photo flyer-photo--empty">
        <img src="/pet-fallback.webp" alt="" aria-hidden="true" />
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className="flyer-photo"
        onClick={openLightbox}
        aria-label={`View ${alt} full screen`}
      >
        <img src={src} alt={alt} />
        <span className="flyer-photo__zoom" aria-hidden="true">
          <ZoomIn size={18} strokeWidth={2.2} />
        </span>
      </button>

      {lightbox && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label={alt} onClick={closeLightbox}>
          <div className="lightbox__stage" onClick={(e) => e.stopPropagation()}>
            <img className="lightbox__img" src={src} alt={alt} />
            <button ref={closeRef} type="button" className="lightbox__close" aria-label="Close photo viewer" onClick={closeLightbox}>
              <X size={20} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
