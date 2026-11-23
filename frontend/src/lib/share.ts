import QRCode from "qrcode";

/**
 * Sharing helpers for public flyers.
 *
 * Browsers cannot post to Facebook/Instagram by themselves — no web API allows a
 * page to auto-publish to a social account. What we can do, and do here:
 *  - the native Web Share API (`navigator.share`) — on mobile the OS share sheet
 *    lists Instagram/Facebook/Messenger/etc., and when the browser supports sharing
 *    files we attach the QR-code PNG so the image lands directly in the post composer;
 *  - direct share intents (Facebook Sharer, X, WhatsApp) that open the target app's
 *    pre-filled composer in a popup — one tap from an actual post;
 *  - Instagram: native share with the image when supported, otherwise the caption +
 *    link are copied to the clipboard and instagram.com opens for a paste;
 *  - a plain copy-link fallback everywhere.
 */

export interface FlyerShareInfo {
  url: string;
  title: string;
  text: string;
  /** The QR payload (usually the same as url) — rendered as a PNG to share/download. */
  qrValue?: string;
  /** Optional ready-made flyer image (export_png_url) to attach to native shares. */
  imageUrl?: string;
}

export function canUseNativeShare(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

/** True when the browser can share File objects (mobile share sheets). */
export function canShareFiles(files: File[]): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files })
  );
}

/** Native share — with the QR PNG attached when the browser accepts files. */
export async function nativeShare(info: FlyerShareInfo): Promise<"shared" | "cancelled" | "unsupported"> {
  if (!canUseNativeShare()) return "unsupported";
  const base: ShareData = { title: info.title, text: info.text, url: info.url };
  try {
    const file = info.qrValue ? await qrCodePngFile(info.qrValue) : null;
    if (file && canShareFiles([file])) {
      await navigator.share({ ...base, files: [file] });
    } else {
      await navigator.share(base);
    }
    return "shared";
  } catch (e) {
    // AbortError = the user dismissed the share sheet — not an error.
    if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
    // Some browsers reject `files` at call time even if canShare passed — retry without.
    try {
      await navigator.share(base);
      return "shared";
    } catch {
      return "cancelled";
    }
  }
}

export const facebookShareUrl = (url: string): string =>
  `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;

export const xShareUrl = (text: string, url: string): string =>
  `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;

export const whatsappShareUrl = (text: string, url: string): string =>
  `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`;

/**
 * Instagram has no web share intent. Best available: hand the QR image to the native
 * share sheet (mobile → Instagram accepts it in the composer); on desktop, copy the
 * ready-to-paste caption + link and open Instagram.
 */
export async function instagramShare(info: FlyerShareInfo): Promise<"shared" | "copied"> {
  const file = info.qrValue ? await qrCodePngFile(info.qrValue) : null;
  if (file && canShareFiles([file]) && canUseNativeShare()) {
    try {
      await navigator.share({ title: info.title, text: info.text, url: info.url, files: [file] });
      return "shared";
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        // fall through to copy + open
      }
    }
  }
  const caption = `${info.text}\n${info.url}`;
  await copyToClipboard(caption);
  window.open("https://www.instagram.com/", "_blank", "noopener,noreferrer");
  return "copied";
}

/** Small centred popup for share intents; falls back to a new tab when blocked. */
export function openSharePopup(url: string): void {
  const w = window.open(url, "pawprint-share", "noopener,noreferrer,width=640,height=560");
  if (!w) window.open(url, "_blank", "noopener,noreferrer");
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Legacy fallback for non-secure contexts.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

/** Render the QR payload as a PNG File (for Web Share file attachment). Null when unsupported. */
export async function qrCodePngFile(value: string, filename = "pawprint-flyer-qr.png"): Promise<File | null> {
  try {
    const dataUrl = await QRCode.toDataURL(value, {
      type: "image/png",
      width: 512,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#1c1410", light: "#ffffff" },
    });
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    return new File([blob], filename, { type: "image/png" });
  } catch {
    return null;
  }
}

/** Render the QR payload as a PNG data URL for a download link. */
export async function qrCodePngDataUrl(value: string): Promise<string> {
  return QRCode.toDataURL(value, {
    type: "image/png",
    width: 768,
    margin: 2,
    errorCorrectionLevel: "M",
    color: { dark: "#1c1410", light: "#ffffff" },
  });
}
