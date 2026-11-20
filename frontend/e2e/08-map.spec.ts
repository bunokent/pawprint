import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { API, DEMO, fixture, login } from "./helpers";

/**
 * Journey 8 — public pet map: the /map page renders a Leaflet (OpenStreetMap)
 * map with one circular photo pin per active lost/found flyer that carries
 * coordinates; tapping a pin opens a popup card linking to the flyer's public
 * page. (OSM tiles need internet access, but the pins are plain DOM and render
 * regardless, so the journey stays hermetic.)
 */
test("guest browses the interactive pet map and opens a flyer from a pin", async ({ page }) => {
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

  // Leaflet map with one photo pin per seeded flyer (seeded pets have no photo,
  // so the pins show the pet's initial — pinned via data-pet-name either way).
  const map = page.getByTestId("pet-map");
  await expect(map).toBeVisible();
  const brunoPin = map.locator('.pp-pin [data-pet-name="Bruno"]');
  const misoPin = map.locator('.pp-pin [data-pet-name="Miso"]');
  await expect(brunoPin).toBeVisible();
  await expect(misoPin).toBeVisible();
  // Status ring colours: lost = red, found = green.
  await expect(brunoPin).toHaveCSS("border-color", "rgb(179, 38, 30)"); // #b3261e
  await expect(misoPin).toHaveCSS("border-color", "rgb(46, 158, 99)"); // #2e9e63
  // Legend distinguishes lost vs found pin colours.
  await expect(page.getByLabel("Pin legend")).toContainText("Lost — red pin");
  await expect(page.getByLabel("Pin legend")).toContainText("Found — green pin");

  // Tap Bruno's pin → popup card → open the flyer.
  await map.locator('.pp-pin [data-pet-name="Bruno"]').click();
  const popup = page.getByTestId("map-pin-popup");
  await expect(popup).toBeVisible();
  await expect(popup).toContainText("Bruno");
  await popup.getByRole("link", { name: "Show Full Details" }).click();
  await page.waitForURL(/\/flyers\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Lost pet: Bruno" })).toBeVisible();
  // The detail page links back to the map (flyer carries coordinates).
  await expect(page.getByRole("link", { name: /View on map/ })).toBeVisible();
});

/**
 * Journey 8b — pins at the same spot stack into a card deck: one marker with a
 * ×N count badge (newest on top, oldest peeking behind, rings stay red/green),
 * and tapping it opens a popup listing every stacked flyer.
 */
test("same-spot pins stack into a badge deck whose tap lists all stacked flyers", async ({ page }) => {
  // Find seeded Bruno's exact coordinates.
  const pins = (await (await page.request.get(`${API}/flyers/map`)).json()) as Array<Record<string, any>>;
  const bruno = pins.find((p) => p.pet?.name === "Bruno");
  expect(bruno, "seeded lost flyer 'Bruno' should be pinned").toBeTruthy();

  // As a registered user, post an unnamed found pet pinned at Bruno's exact spot.
  // (Session auth enforces CSRF, so unsafe API calls need the X-CSRFToken header.)
  await login(page);
  const csrfHeaders = async () => {
    const token = (await page.context().cookies()).find((c) => c.name === "csrftoken")?.value;
    return token ? { "X-CSRFToken": token } : {};
  };
  const upload = await page.request.post(`${API}/pets/photos`, {
    headers: await csrfHeaders(),
    multipart: { photo: { name: "dog.jpg", mimeType: "image/jpeg", buffer: fs.readFileSync(fixture("dog.jpg")) } },
  });
  expect(upload.status()).toBe(201);
  const photo = await upload.json();
  const petResp = await page.request.post(`${API}/pets`, {
    headers: { ...(await csrfHeaders()), "Content-Type": "application/json" },
    data: JSON.stringify({ species: "dog", status: "found", color: "brown", photo_path: photo.key }),
  });
  expect(petResp.status()).toBe(201); // no name — found pets are unnamed
  const pet = await petResp.json();
  expect(pet.name).toBe("");
  const flyerResp = await page.request.post(`${API}/flyers/new`, {
    headers: { ...(await csrfHeaders()), "Content-Type": "application/json" },
    data: JSON.stringify({
      pet_id: pet.id,
      mode: "found",
      location_lat: bruno.location_lat,
      location_lng: bruno.location_lng,
      contact_email: DEMO.email,
    }),
  });
  expect(flyerResp.status()).toBe(201);
  const flyerId = (await flyerResp.json()).id;

  try {
    await page.goto("/map");
    const map = page.getByTestId("pet-map");
    await expect(map).toBeVisible();

    // One stacked marker at Bruno's spot with a ×2 badge.
    const stack = map.locator(".pp-stack-pin");
    await expect(stack).toHaveCount(1);
    await expect(stack.locator('[data-stack-count="2"]')).toContainText("×2");
    // Top card is the newest (the found flyer) with the green ring; the older
    // lost flyer peeks out behind as a back card with the red ring.
    await expect(stack.locator(".pp-stack__top .pp-pin__ring")).toHaveCSS("border-color", "rgb(46, 158, 99)");
    await expect(stack.locator(".pp-stack__card")).toHaveCSS("border-color", "rgb(179, 38, 30)");
    // The rest of the map is untouched — Miso still has her own pin.
    await expect(map.locator('.pp-pin:not(.pp-stack-pin) [data-pet-name="Miso"]')).toBeVisible();

    // Tap the stack → popup lists both stacked flyers, each linking to its page.
    await stack.click();
    const popup = page.getByTestId("map-pin-popup");
    await expect(popup).toBeVisible();
    await expect(popup.locator('[data-testid="stack-count-badge"]')).toContainText("×2");
    await expect(popup.locator('[data-testid="stack-card"]')).toHaveCount(2);
    await expect(popup).toContainText("Bruno");
    await expect(popup).toContainText("Found pet"); // unnamed found pet fallback
    const openLinks = popup.getByRole("link", { name: "Open" });
    await expect(openLinks).toHaveCount(2);
    await openLinks.first().click();
    await page.waitForURL(/\/flyers\/[0-9a-f-]{36}$/);
  } finally {
    // Keep the shared e2e DB clean so re-runs still see exactly ×2.
    await page.request.delete(`${API}/flyers/${flyerId}/edit`, { headers: await csrfHeaders() });
  }
});
