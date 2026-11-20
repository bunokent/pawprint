import { expect, test } from "@playwright/test";
import { API, fixture, login } from "./helpers";

/**
 * Journey 9 — found-pet posting mirrors the lost flow:
 * login → /builder?mode=found → photo gate → pet form (no name/tags — the owner
 * is unknown) → location/date/description (no reward) → publish → public
 * "Found pet" detail page + map endpoint includes it.
 */
test("registered user publishes a found-pet flyer", async ({ page }) => {
  await login(page);

  await page.goto("/builder?mode=found");
  await expect(page.getByRole("heading", { name: "Report a found pet" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Found pet" })).toHaveAttribute("aria-pressed", "true");

  // Step 1 — photo gate.
  const upload = page.waitForResponse(
    (r) => r.url().endsWith("/api/pets/photos") && r.request().method() === "POST",
  );
  await page.setInputFiles("input[type=file]", fixture("dog.jpg"));
  expect((await upload).status()).toBe(201);
  await expect(page.getByRole("heading", { name: "Describe the found pet" })).toBeVisible({ timeout: 60_000 });

  // Step 2 — found pets are unnamed: no pet-name / personality-tag fields (lost & adoptable only).
  await expect(page.locator("#pet-name")).toHaveCount(0);
  await expect(page.locator("#pet-tags")).toHaveCount(0);
  await expect(page.getByTestId("found-hint")).toBeVisible();
  // Species is read-only detected text; breed/color still describe the found pet.
  await expect(page.locator("#pet-species")).toHaveText("Dog");
  await page.locator("#pet-breed").fill("Aspin");
  await page.locator("#pet-color").fill("brown");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Found-pet details" })).toBeVisible();

  // Step 3 — found fields; no reward toggle in found mode.
  await expect(page.getByLabel("Offer a finder's reward")).toHaveCount(0);
  await page.locator("#flyer-loc-found").fill("University Ave, Diliman");
  await page.locator("#flyer-date-found").fill("2026-11-18T09:30");
  await page.locator("#flyer-desc").fill("Friendly brown dog, blue collar");
  await page.locator("#flyer-phone").fill("09179876543");
  await page.getByRole("button", { name: "Publish flyer" }).click();

  await page.waitForURL(/\/flyers\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  // Unnamed found pet → heading is just "Found pet" (no ": name").
  await expect(page.getByRole("heading", { name: "Found pet" })).toBeVisible();
  await expect(page.getByText("Found at")).toBeVisible();
  await expect(page.getByText(/University Ave, Diliman/)).toBeVisible();
  await expect(page.getByText("Description")).toBeVisible();
  await expect(page.getByText(/Friendly brown dog, blue collar/)).toBeVisible();
  await expect(page.getByText(/Reward for safe return/)).toHaveCount(0);

  // Publicly readable as a guest; mode is "found" and pet status is "found".
  const id = page.url().split("/flyers/")[1];
  const resp = await page.request.get(`${API}/flyers/${id}`);
  expect(resp.status()).toBe(200);
  const flyer = await resp.json();
  expect(flyer.mode).toBe("found");
  expect(flyer.pet.status).toBe("found");
  expect(flyer.pet.name).toBe(""); // found pets are created without a name
  expect(flyer.last_seen_location).toBe("University Ave, Diliman");
  expect(flyer.reward_enabled).toBe(false);

  // Registered-only: guests get the register prompt on the builder.
  await page.context().clearCookies();
  await page.goto("/builder?mode=found");
  await expect(page.getByRole("heading", { name: /Register to post a flyer/ })).toBeVisible();
});
