import { expect, test } from "@playwright/test";
import { createTestFlyer, deleteFlyer, login } from "./helpers";

/**
 * Journey 6 — QR scan: the QR code printed on the flyer encodes the public flyer
 * URL (qr_target_value). Opening that URL as a scanner would lands on the flyer
 * detail page, guest-accessible, with the QR rendered as an SVG data-URL.
 * Creates its own emergency flyer — no seeded data dependency.
 */
test("scanning the flyer QR target opens the public flyer page", async ({ page }) => {
  const creds = await login(page);
  const petName = `QrE2E-${Date.now()}`;
  const flyerId = await createTestFlyer(page, { mode: "emergency", petName });

  try {
    // Clear session to test as a guest (QR scan is a guest use case).
    await page.context().clearCookies();

    // Fetch flyer details as a guest to get the qr_target_value.
    const resp = await page.request.get(`http://127.0.0.1:8010/api/flyers/${flyerId}`);
    expect(resp.status()).toBe(200);
    const flyer = await resp.json();
    expect(flyer.qr_target_value).toMatch(new RegExp(`/flyers/${flyerId}$`));

    // A scanner resolves the encoded absolute URL — here we open the path on the app.
    const { pathname } = new URL(flyer.qr_target_value as string);
    await page.goto(pathname);

    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toContainText(petName);
    await expect(h1).toContainText("Lost pet");

    const qr = page.locator('img[alt^="QR code linking to"]');
    await expect(qr).toBeVisible();
    await expect(qr).toHaveAttribute("src", /^data:image\/svg\+xml/);
  } finally {
    // Log back in as creator to clean up.
    await login(page, creds.email, creds.password);
    await deleteFlyer(page, flyerId);
  }
});
