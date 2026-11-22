import { describe, expect, it, vi, afterEach } from "vitest";
import {
  canShareFiles,
  canUseNativeShare,
  copyToClipboard,
  facebookShareUrl,
  instagramShare,
  nativeShare,
  whatsappShareUrl,
  xShareUrl,
} from "@/lib/share";

const info = {
  url: "http://localhost:5173/flyers/abc",
  title: "Found pet: Miso",
  text: "Found pet — cat. See the PawPrint flyer:",
  qrValue: "http://localhost:5173/flyers/abc",
};

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(window.navigator, "share", { value: undefined, configurable: true });
  Object.defineProperty(window.navigator, "canShare", { value: undefined, configurable: true });
});

describe("share intent URLs", () => {
  it("builds Facebook / X / WhatsApp share URLs with the flyer link encoded", () => {
    expect(facebookShareUrl(info.url)).toBe(
      "https://www.facebook.com/sharer/sharer.php?u=http%3A%2F%2Flocalhost%3A5173%2Fflyers%2Fabc",
    );
    expect(xShareUrl(info.text, info.url)).toContain("https://twitter.com/intent/tweet?");
    expect(xShareUrl(info.text, info.url)).toContain(encodeURIComponent(info.url));
    expect(whatsappShareUrl(info.text, info.url)).toContain("https://wa.me/?text=");
  });

  it("detects native share support", () => {
    expect(canUseNativeShare()).toBe(false);
    Object.defineProperty(window.navigator, "share", { value: vi.fn(), configurable: true });
    expect(canUseNativeShare()).toBe(true);
    expect(canShareFiles([new File(["x"], "qr.png", { type: "image/png" })])).toBe(false);
  });
});

describe("nativeShare", () => {
  it("returns unsupported without navigator.share", async () => {
    expect(await nativeShare(info)).toBe("unsupported");
  });

  it("shares title/text/url and reports cancellation on AbortError", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "share", { value: share, configurable: true });
    expect(await nativeShare(info)).toBe("shared");
    expect(share).toHaveBeenCalledWith({ title: info.title, text: info.text, url: info.url });

    const abort = vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError"));
    Object.defineProperty(window.navigator, "share", { value: abort, configurable: true });
    expect(await nativeShare(info)).toBe("cancelled");
  });
});

describe("instagramShare", () => {
  it("copies the caption + link and opens Instagram when no file share is possible", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", { value: { writeText }, configurable: true });
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    expect(await instagramShare(info)).toBe("copied");
    expect(writeText).toHaveBeenCalledWith(`${info.text}\n${info.url}`);
    expect(openSpy).toHaveBeenCalledWith("https://www.instagram.com/", "_blank", "noopener,noreferrer");
  });

  it("hands the QR image to the native share sheet when files are shareable", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "share", { value: share, configurable: true });
    Object.defineProperty(window.navigator, "canShare", { value: () => true, configurable: true });
    // qrCodePngFile needs canvas (absent in jsdom) → falls back to text+url share.
    expect(await instagramShare(info)).toBe("shared");
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({ title: info.title, text: info.text, url: info.url }),
    );
  });
});

describe("copyToClipboard", () => {
  it("uses the clipboard API and falls back to execCommand", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(window.navigator, "clipboard", { value: { writeText }, configurable: true });
    const exec = vi.fn().mockReturnValue(true);
    document.execCommand = exec;
    expect(await copyToClipboard("hello")).toBe(true);
    expect(exec).toHaveBeenCalledWith("copy");
  });
});
