import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";

/** Django API origin (the webServer in playwright.config.ts runs it on :8010). */
export const API = "http://127.0.0.1:8010/api";

/** Photo fixtures verified against the real YOLO-World gatekeeper. */
export const fixture = (name: string) => path.join(process.cwd(), "e2e", "fixtures", name);

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/** Register a fresh account via the API and return the credentials. */
export async function registerUser(
  page: Page,
  overrides: { displayName?: string; password?: string } = {},
): Promise<{ email: string; password: string; displayName: string }> {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const password = overrides.password ?? "e2e-pass-1234";
  const displayName = overrides.displayName ?? "E2E User";
  // Visit the app first so the CSRF cookie is set.
  if (!await page.context().cookies().then((cs) => cs.some((c) => c.name === "csrftoken"))) {
    await page.goto("/");
  }
  const headers = await csrfHeaders(page);
  const resp = await page.request.post(`${API}/auth/register`, {
    headers: { ...headers, "Content-Type": "application/json" },
    data: JSON.stringify({ email, password, display_name: displayName }),
  });
  if (resp.status() !== 201) throw new Error(`register failed: ${resp.status()} ${await resp.text()}`);
  return { email, password, displayName };
}

/** Log in through the real UI and wait until the shell shows the logged-in nav. */
export async function login(
  page: Page,
  email?: string,
  password?: string,
): Promise<{ email: string; password: string; displayName: string }> {
  // If no credentials supplied, register a fresh account first.
  if (!email || !password) {
    const creds = await registerUser(page);
    // registerUser does a page.goto("/") to get the CSRF cookie, so the session
    // is now live from the registration POST response (Django logs the user in).
    // Navigate home and confirm the shell is ready.
    await page.goto("/");
    await page.getByRole("button", { name: "Log out" }).waitFor({ state: "visible" });
    return creds;
  }
  await loginWith(page, email, password);
  return { email, password, displayName: "" };
}

/** Login via UI with known credentials (no auto-register fallback). */
export async function loginWith(page: Page, email: string, password: string) {
  await page.goto("/auth/login");
  await page.locator("#login-email").fill(email);
  await page.locator("#login-password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL((url) => url.pathname === "/");
  await page.getByRole("button", { name: "Log out" }).waitFor({ state: "visible" });
}

// ---------------------------------------------------------------------------
// CSRF + API helpers
// ---------------------------------------------------------------------------

export async function csrfHeaders(page: Page): Promise<Record<string, string>> {
  const token = (await page.context().cookies()).find((c) => c.name === "csrftoken")?.value;
  return token ? { "X-CSRFToken": token } : {};
}

/** Fetch the public flyer list straight from the API (guest, no session needed). */
export async function apiFlyers(page: Page, query = "") {
  const resp = await page.request.get(`${API}/flyers${query}`);
  if (resp.status() !== 200) throw new Error(`GET /api/flyers${query} -> ${resp.status()}`);
  return (await resp.json()) as { results: Array<Record<string, any>> };
}

/**
 * Upload a pet photo + create a pet + create a flyer as the currently logged-in user.
 * Returns the flyer id. Call `deleteFlyer` in a `finally` block to clean up.
 */
export async function createTestFlyer(
  page: Page,
  opts: {
    mode?: "emergency" | "found" | "outreach";
    petName?: string;
    location?: string;
    locationLat?: number;
    locationLng?: number;
  } = {},
): Promise<string> {
  const mode = opts.mode ?? "emergency";
  const petName = opts.petName ?? "TestPet";
  const headers = await csrfHeaders(page);

  // Upload photo.
  const photoResp = await page.request.post(`${API}/pets/photos`, {
    headers,
    multipart: { photo: { name: "dog.jpg", mimeType: "image/jpeg", buffer: fs.readFileSync(fixture("dog.jpg")) } },
  });
  if (photoResp.status() !== 201) throw new Error(`pet photo upload failed: ${photoResp.status()}`);
  const photo = await photoResp.json();

  // Create pet.
  const petPayload: Record<string, unknown> = {
    species: "dog",
    breed: "Mixed breed",
    color: "brown",
    photo_path: photo.key,
    status: mode === "found" ? "found" : mode === "outreach" ? "adoptable" : "lost",
  };
  if (petName && mode !== "found") petPayload.name = petName;
  const petResp = await page.request.post(`${API}/pets`, {
    headers: { ...headers, "Content-Type": "application/json" },
    data: JSON.stringify(petPayload),
  });
  if (petResp.status() !== 201) throw new Error(`pet create failed: ${petResp.status()}`);
  const pet = await petResp.json();

  // Create flyer.
  const flyerPayload: Record<string, unknown> = {
    pet_id: pet.id,
    mode,
    contact_email: "e2e@example.com",
  };
  if (opts.location) flyerPayload.last_seen_location = opts.location;
  if (opts.locationLat !== undefined) flyerPayload.location_lat = opts.locationLat;
  if (opts.locationLng !== undefined) flyerPayload.location_lng = opts.locationLng;
  const flyerResp = await page.request.post(`${API}/flyers/new`, {
    headers: { ...headers, "Content-Type": "application/json" },
    data: JSON.stringify(flyerPayload),
  });
  if (flyerResp.status() !== 201) throw new Error(`flyer create failed: ${flyerResp.status()}`);
  return (await flyerResp.json()).id;
}

/** Delete a flyer via the API (must be logged in as its creator). */
export async function deleteFlyer(page: Page, flyerId: string) {
  const headers = await csrfHeaders(page);
  await page.request.delete(`${API}/flyers/${flyerId}/edit`, { headers });
}
