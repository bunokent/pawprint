import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X, ZoomIn } from "lucide-react";

interface PhotoGalleryProps {
  /** Signed URLs of every uploaded angle, cover first. Empty = no photos. */
  photos: string[];
  /** Base alt text, e.g. "Bento — lost pet photo"; the viewer appends " (n of N)". */
  alt: string;
  /** Shown only in print (the A4 sheet keeps the single cover + QR). */
  printSrc?: string;
}

/**
 * Flyer photo gallery: one large frame plus a thumbnail strip (when there is more
 * than one angle). Clicking the main photo or a thumbnail opens a keyboard-friendly
 * lightbox (arrows / Esc) so every uploaded photo can be viewed at full size.
 */
export function PhotoGallery({ photos, alt, printSrc }: PhotoGalleryProps) {
  const [active, setActive] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  const count = photos.length;
  const safeActive = Math.min(active, Math.max(count - 1, 0));

  const openLightbox = (index: number) => {
    restoreRef.current = document.activeElement as HTMLElement | null;
    setActive(index);
    setLightbox(true);
  };

  const closeLightbox = useCallback(() => {
    setLightbox(false);
    restoreRef.current?.focus?.();
  }, []);

  const step = useCallback(
    (delta: number) => {
      if (count === 0) return;
      setActive((i) => (i + delta + count) % count);
    },
    [count],
  );

  useEffect(() => {
    if (!lightbox) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, closeLightbox, step]);

  if (count === 0) {
    return (
      <div
        className="photo-frame photo-gallery__main"
        style={{ aspectRatio: "4 / 3", borderRadius: 20, background: "var(--color-surface)", border: "1px solid var(--color-line)" }}
      >
        <img src={printSrc || "/pet-fallback.webp"} alt="" aria-hidden="true" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </div>
    );
  }

  return (
    <div className="photo-gallery">
      <button
        type="button"
        className="photo-frame photo-gallery__main"
        style={{ aspectRatio: "4 / 3", borderRadius: 20, background: "var(--color-surface)", border: "1px solid var(--color-line)", padding: 0, cursor: "zoom-in", display: "block", width: "100%" }}
        onClick={() => openLightbox(safeActive)}
        aria-label={`View photo ${safeActive + 1} of ${count} full screen`}
      >
        <img
          src={photos[safeActive]}
          alt={`${alt} — photo ${safeActive + 1} of ${count}`}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
        <span className="photo-gallery__zoom" aria-hidden="true">
          <ZoomIn size={16} strokeWidth={2.2} />
        </span>
      </button>

      {count > 1 && (
        <div className="photo-gallery__thumbs no-print" role="group" aria-label="Pet photos">
          {photos.map((src, i) => (
            <button
              key={src}
              type="button"
              className={`photo-gallery__thumb${i === safeActive ? " photo-gallery__thumb--active" : ""}`}
              aria-current={i === safeActive}
              aria-label={`Show photo ${i + 1} of ${count}`}
              onClick={() => setActive(i)}
            >
              <img src={src} alt="" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}

      {lightbox && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label={`Photo ${safeActive + 1} of ${count}`} onClick={closeLightbox}>
          <div className="lightbox__stage" onClick={(e) => e.stopPropagation()}>
            <img className="lightbox__img" src={photos[safeActive]} alt={`${alt} — photo ${safeActive + 1} of ${count}`} />
            <p className="lightbox__counter" aria-hidden="true">
              {safeActive + 1} / {count}
            </p>
            {count > 1 && (
              <>
                <button type="button" className="lightbox__nav lightbox__nav--prev" aria-label="Previous photo" onClick={() => step(-1)}>
                  <ChevronLeft size={22} />
                </button>
                <button type="button" className="lightbox__nav lightbox__nav--next" aria-label="Next photo" onClick={() => step(1)}>
                  <ChevronRight size={22} />
                </button>
              </>
            )}
            <button ref={closeRef} type="button" className="lightbox__close" aria-label="Close photo viewer" onClick={closeLightbox}>
              <X size={20} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
