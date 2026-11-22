import { expect, test } from "@playwright/test";
import { login, loginWith, registerUser } from "./helpers";

/**
 * Journey 2 — unified account: register a fresh user, log out, log back in.
 * All accounts are created fresh by the test — no seeded demo data needed.
 */
test("register → logout → login with wrong password → correct credentials", async ({ page }) => {
  // Register a brand-new account via the API, then log in through the UI.
  const { email, password } = await registerUser(page, { displayName: "E2E Tester" });

  await loginWith(page, email, password);
  await expect(page.locator("nav")).toContainText("E2E Tester");

  // Log out → back to guest nav.
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();

  // Wrong password surfaces a friendly error, not a crash.
  await page.goto("/auth/login");
  await page.locator("#login-email").fill(email);
  await page.locator("#login-password").fill("definitely-wrong");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.locator(".error-box[role='alert']")).toBeVisible();

  // Correct credentials log in and the shell greets the user.
  await page.locator("#login-password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL((url) => url.pathname === "/");
  await expect(page.locator("nav")).toContainText("E2E Tester");
  await expect(page.getByRole("link", { name: "My flyers" })).toBeVisible();
  await expect(page.getByRole("link", { name: "New flyer" })).toBeVisible();
});

test("login helper lands on home as a registered user", async ({ page }) => {
  await login(page);
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
});
