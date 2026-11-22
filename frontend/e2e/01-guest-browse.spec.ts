import { expect, test } from "@playwright/test";
import { apiFlyers, createTestFlyer, deleteFlyer, login } from "./helpers";

/**
 * Journey 1 — guest browsing (2-mode access: guests browse without an account).
 * Home → gallery → mode filter → full-text search → flyer detail with share menu + QR modal.
 * Creates its own emergency flyer so the test is self-contained.
 */
test("guest can browse, filter, search and open a flyer", async ({ page }) => {
  // Register + log in to create a test flyer, then browse it as a guest.
  const creds = await login(page);
  const petName = `BrowseE2E-${Date.now()}`;
  const flyerId = await createTestFlyer(page, {
    mode: "emergency",
    petName,
    location: "Brgy. Poblacion, Makati",
    locationLat: 14.5547,
    locationLng: 121.0244,
    rewardAmountCents: 500000,
  });

  try {
    // Clear the session so the rest of the journey runs as a guest.
    await page.context().clearCookies();

    // Verify the flyer is publicly visible via the API.
    const list = await apiFlyers(page, `?mode=emergency&q=${encodeURIComponent(petName)}`);
    const flyer = list.results.find((f) => f.pet?.name === petName);
    expect(flyer, `emergency flyer '${petName}' should be visible as a guest`).toBeTruthy();

    await page.goto("/");
    await expect(page.getByRole("heading", { name: /bring them home/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Lost right now" })).toBeVisible();

    // Gallery.
    await page.getByRole("link", { name: "Flyers" }).click();
    await page.waitForURL(/\/flyers$/);
    await expect(page.getByRole("heading", { name: "All flyers" })).toBeVisible();

    // Mode filter.
    await page.getByRole("button", { name: "Lost — urgent" }).click();
    await expect(page.getByRole("heading", { name: "Lost pet alerts" })).toBeVisible();
    await expect(page).toHaveURL(/mode=emergency/);

    // Full-text search.
    await page.getByRole("textbox", { name: /search pets/i }).fill(petName);
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(new RegExp(`q=${encodeURIComponent(petName)}`));
    await expect(page.getByRole("link", { name: new RegExp(petName) }).first()).toBeVisible();

    // Open the detail page.
    await page.getByRole("link", { name: new RegExp(petName) }).first().click();
    await page.waitForURL(/\/flyers\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: `Lost pet: ${petName}` })).toBeVisible();
    await expect(page.getByText(/Reward for safe return/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Print A4 flyer/ })).toBeVisible();
    await expect(page.locator('img[alt^="QR code linking to"]')).toBeVisible();
    await expect(page.getByRole("link", { name: "Log in to fund reward" })).toBeVisible();
  } finally {
    // Log back in as the creator to clean up.
    await login(page, creds.email, creds.password);
    await deleteFlyer(page, flyerId);
  }
});
