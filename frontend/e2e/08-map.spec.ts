import { expect, test } from "@playwright/test";
import { API } from "./helpers";

/**
 * Journey 8 — public pet map: the /map page lists every active lost/found flyer
 * that carries coordinates; each pin links to the flyer's public page.
 * (e2e runs without VITE_GOOGLE_MAPS_API_KEY, so the page shows the pin list.)
 */
test("guest browses the pet map and opens a flyer from a pin", async ({ page }) => {
  // The public map endpoint returns active lost/found flyers with lat/lng.
  const resp = await page.request.get(`${API}/flyers/map`);
  expect(resp.status()).toBe(200);
  const pins = (await resp.json()) as Array<Record<string, any>>;
  const bruno = pins.find((p) => p.pet?.name === "Bruno");
  const miso = pins.find((p) => p.pet?.name === "Miso");
  expect(bruno, "seeded lost flyer 'Bruno' should be pinned").toBeTruthy();
  expect(bruno.mode).toBe("emergency");
  expect(bruno.location_lat).toBeCloseTo(14.5547, 3);
  expect(bruno.location_lng).toBeCloseTo(121.0244, 3);
  expect(miso, "seeded found flyer 'Miso' should be pinned").toBeTruthy();
  expect(miso.mode).toBe("found");
  expect(miso.location_lat).toBeCloseTo(14.5647, 3);

  // Reach the map through the public nav (guests included).
  await page.goto("/");
  await page.getByRole("link", { name: "Pet map" }).click();
  await page.waitForURL(/\/map$/);
  await expect(page.getByRole("heading", { name: "Pet map" })).toBeVisible();

  // Pin list fallback (no Maps key in e2e): both seeded pets are listed.
  await expect(page.getByText("Bruno")).toBeVisible();
  await expect(page.getByText("Miso")).toBeVisible();
  await expect(page.getByTestId("pin-list").getByText("Found pet", { exact: true })).toBeVisible(); // mode badge on Miso's pin

  // Open Bruno's flyer from its pin.
  const brunoCard = page.locator(".card", { hasText: "Bruno" });
  await brunoCard.getByRole("link", { name: "Show Full Details" }).click();
  await page.waitForURL(/\/flyers\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Lost pet: Bruno" })).toBeVisible();
  // The detail page links back to the map (flyer carries coordinates).
  await expect(page.getByRole("link", { name: /View on map/ })).toBeVisible();
});
