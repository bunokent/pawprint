import { expect, test } from "@playwright/test";
import { API, fixture, login } from "./helpers";

/**
 * Journey 7 — profile settings: edit display name/phone and upload a profile
 * picture. The avatar endpoint is NOT pet-gated (it is the user's own photo),
 * so any image fixture passes; the pet gate only guards /api/pets/photos.
 * Creates a fresh account so there is no dependency on seeded demo data.
 */
test("registered user edits their profile and uploads a profile picture", async ({ page }) => {
  await login(page);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Profile settings" })).toBeVisible();

  // Avatar upload → 200 with a private storage key + signed URL.
  const upload = page.waitForResponse(
    (r) => r.url().endsWith("/api/auth/avatar") && r.request().method() === "POST",
  );
  await page.setInputFiles('input[aria-label="Choose a profile picture"]', fixture("dog.jpg"));
  const uploadResp = await upload;
  expect(uploadResp.status()).toBe(200);
  const uploaded = await uploadResp.json();
  expect(uploaded.avatar_path).toMatch(/^avatars\//);
  expect(uploaded.avatar_url).toBeTruthy();
  await expect(page.locator('img[alt$="profile picture"]').first()).toBeVisible();

  // Profile fields save through PATCH /api/auth/profile.
  const patch = page.waitForResponse(
    (r) => r.url().endsWith("/api/auth/profile") && r.request().method() === "PATCH",
  );
  await page.locator("#settings-name").fill("Updated Name");
  await page.locator("#settings-phone").fill("09171234567");
  await page.getByRole("button", { name: "Save changes" }).click();
  expect((await patch).status()).toBe(200);
  await expect(page.getByText("Profile saved.")).toBeVisible();

  // The header nav link shows the new name.
  await expect(page.getByRole("link", { name: "Updated Name" })).toBeVisible();

  // Persisted server-side.
  const me = await page.request.get(`${API}/auth/me`);
  expect(me.status()).toBe(200);
  const meBody = await me.json();
  expect(meBody.display_name).toBe("Updated Name");
  expect(meBody.phone).toBe("09171234567");
  expect(meBody.avatar_path).toMatch(/^avatars\//);
  expect(meBody.avatar_url).toBeTruthy();
});
