import { expect, test } from "@playwright/test";
import { API, createTestFlyer, deleteFlyer, login } from "./helpers";

/**
 * Journey 8 — public pet map: the /map page renders a Leaflet (OpenStreetMap)
 * map with one circular photo pin per active lost/found flyer that carries
 * coordinates; tapping a pin opens a popup card linking to the flyer's public
 * page. Creates its own pinned flyers — no seeded data dependency.
 */
test("guest browses the interactive pet map and opens a flyer from a pin", async ({ page }) => {
  const creds = await login(page);
  const lostName = `MapLost-${Date.now()}`;
  const foundName = `MapFound-${Date.now()}`;
  const LAT_A = 14.5547;
  const LNG_A = 121.0244;
  const LAT_B = 14.5647;
  const LNG_B = 120.9989;

  const lostId = await createTestFlyer(page, {
    mode: "emergency",
    petName: lostName,
    location: "Brgy. Poblacion, Makati",
    locationLat: LAT_A,
    locationLng: LNG_A,
  });
  const foundId = await createTestFlyer(page, {
    mode: "found",
    location: "Brgy. Bel-Air, Makati",
    locationLat: LAT_B,
    locationLng: LNG_B,
  });

  try {
    // The public map endpoint returns active lost/found flyers with lat/lng.
    const resp = await page.request.get(`${API}/flyers/map`);
    expect(resp.status()).toBe(200);
    const pins = (await resp.json()) as Array<Record<string, any>>;
    const lostPin = pins.find((p) => p.id === lostId);
    const foundPin = pins.find((p) => p.id === foundId);
    expect(lostPin, "created lost flyer should be pinned").toBeTruthy();
    expect(lostPin.mode).toBe("emergency");
    expect(lostPin.location_lat).toBeCloseTo(LAT_A, 3);
    expect(lostPin.location_lng).toBeCloseTo(LNG_A, 3);
    expect(foundPin, "created found flyer should be pinned").toBeTruthy();
    expect(foundPin.mode).toBe("found");
    expect(foundPin.location_lat).toBeCloseTo(LAT_B, 3);

    // Clear session — map is public.
    await page.context().clearCookies();

    // Reach the map through the public nav.
    await page.goto("/");
    await page.getByRole("link", { name: "Pet map" }).click();
    await page.waitForURL(/\/map$/);
    await expect(page.getByRole("heading", { name: "Pet map" })).toBeVisible();

    const map = page.getByTestId("pet-map");
    await expect(map).toBeVisible();
    const lostPinEl = map.locator(`.pp-pin [data-pet-name="${lostName}"]`);
    await expect(lostPinEl).toBeVisible();
    // Status ring colour: lost = red.
    await expect(lostPinEl).toHaveCSS("border-color", "rgb(179, 38, 30)"); // #b3261e
    // Legend distinguishes lost vs found pin colours.
    await expect(page.getByLabel("Pin legend")).toContainText("Lost — red pin");
    await expect(page.getByLabel("Pin legend")).toContainText("Found — green pin");

    // Tap the lost pin → popup card → open the flyer.
    await lostPinEl.click();
    const popup = page.getByTestId("map-pin-popup");
    await expect(popup).toBeVisible();
    await expect(popup).toContainText(lostName);
    await popup.getByRole("link", { name: "Show Full Details" }).click();
    await page.waitForURL(/\/flyers\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: `Lost pet: ${lostName}` })).toBeVisible();
    await expect(page.getByRole("link", { name: /View on map/ })).toBeVisible();
  } finally {
    // Log back in to delete the test flyers.
    await login(page, creds.email, creds.password);
    await deleteFlyer(page, lostId);
    await deleteFlyer(page, foundId);
  }
});

/**
 * Journey 8b — pins at the same spot stack into a card deck: one marker with a
 * ×N count badge, and tapping it lists every stacked flyer.
 */
test("same-spot pins stack into a badge deck whose tap lists all stacked flyers", async ({ page }) => {
  const creds = await login(page);
  const lostName = `StackLost-${Date.now()}`;
  const LAT = 14.5547;
  const LNG = 121.0244;

  // Create a lost-pet flyer pinned at the shared spot.
  const lostId = await createTestFlyer(page, {
    mode: "emergency",
    petName: lostName,
    location: "Makati",
    locationLat: LAT,
    locationLng: LNG,
  });

  // As the same user, create a found-pet flyer at the exact same spot.
  const foundId = await createTestFlyer(page, {
    mode: "found",
    locationLat: LAT,
    locationLng: LNG,
    location: "Makati",
  });

  try {
    await page.goto("/map");
    const map = page.getByTestId("pet-map");
    await expect(map).toBeVisible();

    // One stacked marker at the shared spot with a ×2 badge.
    const stack = map.locator(".pp-stack-pin");
    await expect(stack).toHaveCount(1);
    await expect(stack.locator('[data-stack-count="2"]')).toContainText("×2");
    // Newest on top (found, green ring); older lost flyer peeks out (red ring).
    await expect(stack.locator(".pp-stack__top .pp-pin__ring")).toHaveCSS("border-color", "rgb(46, 158, 99)");
    await expect(stack.locator(".pp-stack__card")).toHaveCSS("border-color", "rgb(179, 38, 30)");

    // Tap the stack → popup lists both stacked flyers.
    await stack.click();
    const popup = page.getByTestId("map-pin-popup");
    await expect(popup).toBeVisible();
    await expect(popup.locator('[data-testid="stack-count-badge"]')).toContainText("×2");
    await expect(popup.locator('[data-testid="stack-card"]')).toHaveCount(2);
    await expect(popup).toContainText(lostName);
    await expect(popup).toContainText("Found pet");
    const openLinks = popup.getByRole("link", { name: "Open" });
    await expect(openLinks).toHaveCount(2);
    await openLinks.first().click();
    await page.waitForURL(/\/flyers\/[0-9a-f-]{36}$/);
  } finally {
    await deleteFlyer(page, lostId);
    await deleteFlyer(page, foundId);
  }
});
