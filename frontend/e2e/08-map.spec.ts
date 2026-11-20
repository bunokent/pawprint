import { expect, test } from "@playwright/test";
import { API } from "./helpers";

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
