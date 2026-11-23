import { expect, test } from "@playwright/test";
import { fixture, login } from "./helpers";

/**
 * Journey 4 — Pet-photo gatekeeper: a landscape photo and a flat logo are rejected with
 * 422 no_pet_detected (never a ban), and the user can immediately retry with a real
 * pet photo that passes. The logo case proves the graphic veto catches images an open
 * vocabulary detector can mistake for a dog.
 */
test("non-pet photo gets a 422 retry UX; pet photo passes", async ({ page }) => {
  await login(page);
  await page.goto("/builder");
  await expect(page.getByRole("heading", { name: "Report a lost pet" })).toBeVisible();

  // Landscape (no animal) → HTTP 422 with the normalized error envelope.
  const reject = page.waitForResponse(
    (r) => r.url().endsWith("/api/pets/photos") && r.request().method() === "POST",
  );
  await page.setInputFiles("input[type=file]", fixture("landscape.jpg"));
  const resp = await reject;
  expect(resp.status()).toBe(422);
  const body = await resp.json();
  expect(body.error.code).toBe("no_pet_detected");

  // The UI shows the friendly retry box — no strikes, no bans.
  const errBox = page.locator('[data-testid="no-pet-error"]');
  await expect(errBox).toBeVisible({ timeout: 60_000 });
  await expect(errBox).toContainText("No pet detected in the photo");
  await expect(errBox).toContainText("no bans");
  // Still on step 1 — the wizard did not advance.
  await expect(page.getByRole("heading", { name: "Report a lost pet" })).toBeVisible();

  // Retry with a real dog photo → 201 from the gate, preview shown, Next → step 2.
  const retry = page.waitForResponse(
    (r) => r.url().endsWith("/api/pets/photos") && r.request().method() === "POST",
  );
  await page.setInputFiles("input[type=file]", fixture("dog.jpg"));
  expect((await retry).status()).toBe(201);
  await expect(page.getByAltText("Uploaded pet preview")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { name: "Tell us about the pet" })).toBeVisible({ timeout: 60_000 });
});

test("flat logo mistaken for a dog is rejected with a logo-specific 422", async ({ page }) => {
  await login(page);
  await page.goto("/builder");

  const reject = page.waitForResponse(
    (r) => r.url().endsWith("/api/pets/photos") && r.request().method() === "POST",
  );
  await page.setInputFiles("input[type=file]", fixture("logo.jpg"));
  const resp = await reject;
  expect(resp.status()).toBe(422);
  expect((await resp.json()).error).toMatchObject({
    code: "no_pet_detected",
    message: expect.stringContaining("logo or illustration"),
  });

  const errBox = page.locator('[data-testid="no-pet-error"]');
  await expect(errBox).toBeVisible({ timeout: 60_000 });
  await expect(errBox).toContainText("logo or illustration");
  await expect(errBox).toContainText("no bans");
  await expect(page.getByRole("heading", { name: "Report a lost pet" })).toBeVisible();
  // The input is still available for an immediate retry — no penalties.
  await expect(page.locator("input[type=file]")).toBeAttached();
});
