import { useEffect, useState } from "react";
import QRCode from "qrcode";

/**
 * QR rendered as an SVG data-URL — no canvas needed, works in every browser.
 */
export function QrImage({ value, size = 200, alt }: { value: string; size?: number; alt: string }) {
  const [src, setSrc] = useState("");

  useEffect(() => {
    let alive = true;
    if (!value) {
      setSrc("");
      return;
    }
    QRCode.toString(value, { type: "svg", margin: 1, width: size, color: { dark: "#1c1410", light: "#ffffff" } })
      .then((svg) => {
        if (alive) setSrc(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
      })
      .catch(() => {
        if (alive) setSrc("");
      });
    return () => {
      alive = false;
    };
  }, [value, size]);

  if (!src) return null;
  return <img src={src} alt={alt} width={size} height={size} style={{ width: size, height: size }} />;
}
