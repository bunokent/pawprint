import { useEffect, useRef, useState } from "react";
import { Check, Download, Facebook, Instagram, Link2, MessageCircle, QrCode, Send, Share2, Twitter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { QrImage } from "@/components/QrImage";
import {
  copyToClipboard,
  facebookShareUrl,
  instagramShare,
  nativeShare,
  openSharePopup,
  qrCodePngDataUrl,
  whatsappShareUrl,
  xShareUrl,
  type FlyerShareInfo,
} from "@/lib/share";

/**
 * "Share flyer" — a beautiful popover that replaces the raw QR block on screen:
 * native share sheet (with the QR PNG attached where supported), direct Facebook /
 * Instagram / X / WhatsApp intents, copy-link, and a QR-code modal (the QR still
 * prints on the A4 flyer).
 */
export function ShareMenu({ info }: { info: FlyerShareInfo }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrPng, setQrPng] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const canNative = typeof navigator !== "undefined" && typeof navigator.share === "function";

  useEffect(() => {
    if (!open) return;
    const trigger = rootRef.current?.querySelector<HTMLButtonElement>("button");
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = () => setOpen(false);

  const onNative = async () => {
    const result = await nativeShare(info);
    if (result === "shared") close();
  };

  const onCopy = async () => {
    const ok = await copyToClipboard(info.url);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  };

  const onQr = async () => {
    close();
    setQrOpen(true);
    if (info.qrValue && !qrPng) {
      try {
        setQrPng(await qrCodePngDataUrl(info.qrValue));
      } catch {
        setQrPng("");
      }
    }
  };

  const onInstagram = async () => {
    const result = await instagramShare(info);
    if (result === "shared") close();
  };

  return (
    <div className="share-menu" ref={rootRef}>
      <Button
        variant="secondary"
       
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Share2 size={16} /> Share flyer
      </Button>

      {open && (
        <div className="share-menu__popover card" role="menu" aria-label="Share this flyer">
          {canNative && (
            <button type="button" role="menuitem" className="share-menu__item" onClick={() => void onNative()}>
              <span className="share-menu__icon share-menu__icon--native"><Share2 size={17} /></span>
              Share via…
              <span className="share-menu__hint">phone share sheet</span>
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="share-menu__item"
            onClick={() => { openSharePopup(facebookShareUrl(info.url)); close(); }}
          >
            <span className="share-menu__icon" style={{ color: "#1877f2" }}><Facebook size={17} /></span>
            Facebook
          </button>
          <button type="button" role="menuitem" className="share-menu__item" onClick={() => void onInstagram()}>
            <span className="share-menu__icon" style={{ color: "#d6336c" }}><Instagram size={17} /></span>
            Instagram
            <span className="share-menu__hint">{canNative ? "share the QR image" : "copies caption + opens IG"}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="share-menu__item"
            onClick={() => { openSharePopup(xShareUrl(info.text, info.url)); close(); }}
          >
            <span className="share-menu__icon" style={{ color: "#1c1410" }}><Twitter size={16} /></span>
            X
          </button>
          <button
            type="button"
            role="menuitem"
            className="share-menu__item"
            onClick={() => { openSharePopup(whatsappShareUrl(info.text, info.url)); close(); }}
          >
            <span className="share-menu__icon" style={{ color: "#1faa53" }}><MessageCircle size={17} /></span>
            WhatsApp
          </button>
          <button type="button" role="menuitem" className="share-menu__item" onClick={() => void onCopy()}>
            <span className="share-menu__icon" style={{ color: "var(--color-sage-deep)" }}>
              {copied ? <Check size={17} /> : <Link2 size={17} />}
            </span>
            {copied ? "Link copied ✓" : "Copy link"}
          </button>
          <div className="share-menu__divider" role="separator" />
          <button type="button" role="menuitem" className="share-menu__item" onClick={() => void onQr()}>
            <span className="share-menu__icon" style={{ color: "var(--color-ink)" }}><QrCode size={17} /></span>
            QR code
            <span className="share-menu__hint">view & download</span>
          </button>
        </div>
      )}

      <Modal open={qrOpen} onClose={() => setQrOpen(false)} title="QR code for this flyer">
        <div className="qr-modal">
          {info.qrValue ? (
            <>
              <div className="qr-modal__frame">
                <QrImage value={info.qrValue} size={220} alt={`QR code linking to ${info.title}`} />
              </div>
              <p className="qr-modal__url" title={info.url}>
                {info.url}
              </p>
              <div className="btn-row" style={{ marginTop: 16 }}>
                {qrPng && (
                  <Button variant="primary" asChild>
                    <a href={qrPng} download="pawprint-flyer-qr.png">
                      <Download size={16} /> Download QR (PNG)
                    </a>
                  </Button>
                )}
                <Button variant="secondary" onClick={() => void copyToClipboard(info.url)}>
                  <Send size={16} /> Copy link
                </Button>
              </div>
              <p className="t-small" style={{ color: "var(--color-muted)", marginTop: 12 }}>
                The same QR code is printed on the A4 flyer — anyone who scans it opens this page.
              </p>
            </>
          ) : (
            <p className="t-body">No QR target is set for this flyer yet.</p>
          )}
        </div>
      </Modal>
    </div>
  );
}
