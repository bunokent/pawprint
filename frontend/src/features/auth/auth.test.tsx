import { StrictMode } from "react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoginPage } from "@/features/auth/pages/LoginPage";
import { RegisterPage } from "@/features/auth/pages/RegisterPage";
import { GoogleButton } from "@/features/auth/components/GoogleButton";
import { useAuth } from "@/stores/auth";
import { mswServer } from "@/test/setup";
import { renderWithProviders } from "@/test/utils";
import { mockUser } from "@/test/handlers";

const HOME = <div>HOME PAGE</div>;

beforeEach(() => {
  useAuth.setState({ user: null, checked: true });
});

describe("LoginPage", () => {
  const renderLogin = (route = "/auth/login") =>
    renderWithProviders(<LoginPage />, { route, routes: [["/", HOME]] });

  it("logs in with valid credentials and navigates home", async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByLabelText("Email"), "mia@example.com");
    await user.type(screen.getByLabelText("Password"), "demo1234");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByText("HOME PAGE")).toBeInTheDocument();
    expect(useAuth.getState().user?.email).toBe("mia@example.com");
  });

  it("shows the API error on bad credentials", async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByLabelText("Email"), "mia@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password.");
  });

  it("validates required fields client-side", async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findAllByRole("alert")).not.toHaveLength(0);
    expect(screen.queryByText("HOME PAGE")).not.toBeInTheDocument();
  });

  it("shows a mail icon on email, a lock icon on password, and an eye toggle", async () => {
    const user = userEvent.setup();
    renderLogin();
    const email = screen.getByLabelText("Email");
    expect(email.closest(".input-wrap")?.querySelector("svg.lucide-mail")).toBeTruthy();
    const password = screen.getByLabelText("Password");
    expect(password).toHaveAttribute("type", "password");
    expect(password.closest(".input-wrap")?.querySelector("svg.lucide-lock")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "text");
    await user.click(screen.getByRole("button", { name: "Hide password" }));
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
  });

  it("exchanges a Google ?code= callback for a session", async () => {
    const callbackCalls = vi.fn();
    mswServer.use(
      http.post("*/api/auth/google/callback", async ({ request }) => {
        callbackCalls(await request.json());
        return HttpResponse.json({ user: mockUser({ google_id: "g-9" }), created: true });
      }),
    );
    renderLogin("/auth/login?code=google-code-123");
    expect(await screen.findByText("HOME PAGE")).toBeInTheDocument();
    expect(callbackCalls).toHaveBeenCalledWith(expect.objectContaining({ code: "google-code-123" }));
    expect(useAuth.getState().user?.google_id).toBe("g-9");
  });

  it("renders the beautiful signing-in card with brand icon and progress bar during exchange", async () => {
    let resolveExchange!: (value: unknown) => void;
    const exchangePromise = new Promise((resolve) => {
      resolveExchange = resolve;
    });

    mswServer.use(
      http.post("*/api/auth/google/callback", async () => {
        await exchangePromise;
        return HttpResponse.json({ user: mockUser({ google_id: "g-10" }), created: true });
      }),
    );

    renderLogin("/auth/login?code=in-flight-code");

    // The dedicated status card is displayed while exchange is in flight.
    const statusCard = screen.getByRole("status");
    expect(statusCard).toHaveTextContent("Signing you in…");
    expect(statusCard).toHaveTextContent("Connecting your Google account and opening your PawPrint workspace.");
    expect(within(statusCard).getByTestId("google-brand-icon")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Signing in with Google" })).toBeInTheDocument();
    // The regular email/password login form is not shown while signing in.
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();

    // Finish the exchange → user is authenticated and lands on home.
    resolveExchange(true);
    expect(await screen.findByText("HOME PAGE")).toBeInTheDocument();
    expect(useAuth.getState().user?.google_id).toBe("g-10");
  });

  it("guards against double-invocation so the OAuth code is only exchanged once", async () => {
    const callbackCalls = vi.fn();
    mswServer.use(
      http.post("*/api/auth/google/callback", async ({ request }) => {
        callbackCalls(await request.json());
        return HttpResponse.json({ user: mockUser({ google_id: "g-strict" }), created: true });
      }),
    );

    renderWithProviders(
      <StrictMode>
        <LoginPage />
      </StrictMode>,
      { route: "/auth/login?code=strict-mode-code", routes: [["/", HOME]] },
    );

    expect(await screen.findByText("HOME PAGE")).toBeInTheDocument();
    expect(callbackCalls).toHaveBeenCalledTimes(1);
    expect(callbackCalls).toHaveBeenCalledWith(expect.objectContaining({ code: "strict-mode-code" }));
  });

  it("handles OAuth query error params (e.g. user cancelled prompt)", async () => {
    renderLogin("/auth/login?error=access_denied&error_description=Access+was+denied+by+user");
    expect(await screen.findByRole("alert")).toHaveTextContent("Access was denied by user");
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("shows an error when the Google callback fails", async () => {
    mswServer.use(
      http.post("*/api/auth/google/callback", () =>
        HttpResponse.json({ error: { code: "oauth_error", message: "Google sign-in failed." } }, { status: 400 }),
      ),
    );
    renderLogin("/auth/login?code=bad-code");
    expect(await screen.findByRole("alert")).toHaveTextContent("Google sign-in failed.");
  });
});

describe("RegisterPage", () => {
  const renderRegister = () =>
    renderWithProviders(<RegisterPage />, { route: "/auth/register", routes: [["/", HOME]] });

  it("registers and navigates home", async () => {
    const user = userEvent.setup();
    renderRegister();
    await user.type(screen.getByLabelText(/Display name/), "Kai");
    await user.type(screen.getByLabelText("Email"), "kai@example.com");
    await user.type(screen.getByLabelText(/Password/), "supersecret1");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("HOME PAGE")).toBeInTheDocument();
    expect(useAuth.getState().user?.email).toBe("kai@example.com");
  });

  it("shows a field error when the email is taken", async () => {
    const user = userEvent.setup();
    renderRegister();
    await user.type(screen.getByLabelText("Email"), "taken@example.com");
    await user.type(screen.getByLabelText(/Password/), "supersecret1");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already exists");
  });

  it("rejects short passwords client-side", async () => {
    const user = userEvent.setup();
    renderRegister();
    await user.type(screen.getByLabelText("Email"), "kai@example.com");
    await user.type(screen.getByLabelText(/Password/), "short");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("Use at least 8 characters.")).toBeInTheDocument();
  });

  it("toggles password visibility with the eye button", async () => {
    const user = userEvent.setup();
    renderRegister();
    const password = screen.getByLabelText(/Password/);
    expect(password).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(screen.getByLabelText(/Password/)).toHaveAttribute("type", "text");
  });
});

describe("GoogleButton", () => {
  it("renders the real multicolor Google brand icon on the sign-in button", () => {
    renderWithProviders(<GoogleButton />);
    const button = screen.getByRole("button", { name: /Continue with Google/ });
    const icon = within(button).getByTestId("google-brand-icon");
    expect(icon).toBeInTheDocument();
    // The official "G" keeps its four brand colours.
    const fills = Array.from(icon.querySelectorAll("path")).map((p) => p.getAttribute("fill"));
    expect(fills).toEqual(["#FFC107", "#FF3D00", "#4CAF50", "#1976D2"]);
  });

  it("requests the authorize URL and redirects", async () => {
    const urlCalls = vi.fn();
    mswServer.use(
      http.post("*/api/auth/google/url", async ({ request }) => {
        urlCalls(await request.json());
        return HttpResponse.json({ url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=dev" });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<GoogleButton />);
    await user.click(screen.getByRole("button", { name: /Continue with Google/ }));
    await waitFor(() => expect(urlCalls).toHaveBeenCalledWith(expect.objectContaining({ redirect_uri: expect.stringContaining("/auth/login") })));
  });

  it("shows an error when the URL request fails", async () => {
    mswServer.use(http.post("*/api/auth/google/url", () => HttpResponse.error()));
    const user = userEvent.setup();
    renderWithProviders(<GoogleButton />);
    await user.click(screen.getByRole("button", { name: /Continue with Google/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach Google sign-in");
  });
});
