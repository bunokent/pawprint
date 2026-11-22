import { expect, test } from "@playwright/test";
import { API, fixture, login } from "./helpers";

/**
 * Journey 3 — create an emergency flyer end-to-end:
 * login → builder (photo gate → pet form → details/reward) → publish → detail page.
 */
test("registered user publishes a lost-pet flyer with a reward", async ({ page }) => {
  await login(page);

  await page.goto("/builder?mode=emergency");
  await expect(page.getByRole("heading", { name: "Report a lost pet" })).toBeVisible();

  // Step 1 — photo upload passes the YOLO-World pet gate; the wizard stays on the
  // photo step (more angle photos can be added) until Next is clicked.
  const upload = page.waitForResponse(
    (r) => r.url().endsWith("/api/pets/photos") && r.request().method() === "POST",
  );
  await page.setInputFiles("input[type=file]", fixture("dog.jpg"));
  const uploadResp = await upload;
  expect(uploadResp.status()).toBe(201);
  expect((await uploadResp.json()).pet_classes).toContain("dog");
  await expect(page.getByAltText("Uploaded pet preview")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { name: "Tell us about the pet" })).toBeVisible({ timeout: 60_000 });

  // Step 2 — pet details. Species is auto-detected from the photo (dog.jpg → dog)
  // and shown as plain read-only text; breed/color may be prefilled by the
  // classifier, so fill() replaces whatever detection put there.
  await page.locator("#pet-name").fill("Rex E2E");
  await expect(page.locator("#pet-species")).toHaveText("Dog");
  await page.locator("#pet-breed").fill("Mixed breed");
  await page.locator("#pet-color").fill("brown");
  await page.locator("#pet-age").fill("3");
  await page.locator("#pet-tags").fill("friendly, good with kids");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Flyer details & reward" })).toBeVisible();

  // Step 3 — flyer details + reward (checkbox is on by default for emergency mode).
  await page.locator("#flyer-loc").fill("Makati City");
  await page.locator("#flyer-marks").fill("White patch on chest");
  await page.locator("#flyer-phone").fill("09171234567");
  await expect(page.locator("#flyer-reward")).toBeVisible();
  await page.locator("#flyer-reward").fill("1500");
  await page.getByRole("button", { name: "Publish flyer" }).click();

  // Lands on the new flyer's public detail page.
  await page.waitForURL(/\/flyers\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Lost pet: Rex E2E" })).toBeVisible();
  await expect(page.getByText("Makati City")).toBeVisible();
  await expect(page.getByText(/Reward for safe return/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Share flyer/ })).toBeVisible();
  // Owner-only controls are visible to the creator (delete is unconditional;
  // "Mark reunited" appears once the async A4 export flips status to active).
  await expect(page.getByRole("button", { name: "Delete flyer" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Fund reward" })).toBeVisible();

  // The flyer is publicly readable through the API as a guest.
  const id = page.url().split("/flyers/")[1];
  const resp = await page.request.get(`${API}/flyers/${id}`);
  expect(resp.status()).toBe(200);
  const flyer = await resp.json();
  expect(flyer.pet.name).toBe("Rex E2E");
  expect(flyer.mode).toBe("emergency");
  expect(flyer.reward_amount_cents).toBe(150_000);
  expect(flyer.qr_target_value).toContain(`/flyers/${id}`);
});
