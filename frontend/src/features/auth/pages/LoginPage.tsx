import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Mail } from "lucide-react";
import { authApi, REDIRECT_URI } from "@/features/auth/api";
import { ApiError } from "@/lib/api/client";
import { useAuth } from "@/stores/auth";
import { Button } from "@/components/ui/button";
import { FieldShell, IconInput } from "@/components/ui/field";
import { GoogleBrandIcon, GoogleButton } from "@/features/auth/components/GoogleButton";
import { PasswordInput } from "@/features/auth/components/PasswordInput";

const loginSchema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});
type LoginValues = z.infer<typeof loginSchema>;

interface FormState {
  error: string | null;
}

const initialState: FormState = { error: null };

export function LoginPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const setUser = useAuth((s) => s.setUser);
  const user = useAuth((s) => s.user);

  const code = params.get("code");
  const errorParam = params.get("error");
  const errorDescription = params.get("error_description");

  const [callbackError, setCallbackError] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState<boolean>(() => Boolean(code && !errorParam));

  // Single-use OAuth authorization code exchange guard.
  // In React 18/19 StrictMode, effects run twice on mount. Google authorization codes
  // can only be exchanged once; exchanging a second time produces an invalid_grant error.
  const exchangedCodeRef = useRef<string | null>(null);

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const [state, submit, pending] = useActionState(async (_prev: FormState, values: LoginValues): Promise<FormState> => {
    try {
      const u = await authApi.login(values);
      setUser(u);
      const target = params.get("next") || params.get("redirect") || "/";
      navigate(target.startsWith("/") ? target : "/");
      return { error: null };
    } catch (e) {
      return { error: e instanceof ApiError ? e.message : "Login failed. Please try again." };
    }
  }, initialState);

  // Handle Google OAuth error returned directly in query string (e.g. user cancelled prompt).
  useEffect(() => {
    if (errorParam) {
      setIsSigningIn(false);
      setCallbackError(errorDescription || "Google sign-in was cancelled or denied.");
      setParams({}, { replace: true });
    }
  }, [errorParam, errorDescription, setParams]);

  // Google redirects back here with ?code=… — exchange it for a session.
  useEffect(() => {
    if (!code || errorParam) return;

    if (exchangedCodeRef.current === code) return;
    exchangedCodeRef.current = code;
    setIsSigningIn(true);
    setCallbackError(null);

    void (async () => {
      try {
        const { user: u } = await authApi.googleCallback(code, REDIRECT_URI);
        setUser(u);
        setParams({}, { replace: true });
        const target = params.get("next") || params.get("redirect") || "/";
        navigate(target.startsWith("/") ? target : "/");
      } catch (e) {
        // If the user is already authenticated (e.g. from an in-flight duplicate), proceed home
        if (useAuth.getState().user) {
          navigate("/");
          return;
        }
        setIsSigningIn(false);
        setCallbackError(e instanceof ApiError ? e.message : "Google sign-in failed.");
        setParams({}, { replace: true });
      }
    })();
  }, [code, errorParam, params, setParams, setUser, navigate]);

  useEffect(() => {
    if (user && !isSigningIn) {
      const target = params.get("next") || params.get("redirect") || "/";
      navigate(target.startsWith("/") ? target : "/");
    }
  }, [user, isSigningIn, params, navigate]);

  if (isSigningIn && !callbackError) {
    return (
      <section className="page-section">
        <div className="wrap" style={{ maxWidth: 480 }}>
          <h1 className="t-h1" data-enter style={{ marginBottom: 8 }}>
            Welcome back
          </h1>
          <p className="t-lead" data-enter="2" style={{ marginBottom: 32 }}>
            Verifying your Google credentials.
          </p>

          <div
            className="card auth-status-card"
            style={{
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
            data-enter="3"
            role="status"
            aria-live="polite"
          >
            <div
              style={{
                width: 60,
                height: 60,
                borderRadius: "50%",
                background: "var(--color-surface)",
                border: "1.5px solid var(--color-line)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 2px 8px rgb(28 20 16 / 0.06)",
                marginBottom: 20,
              }}
            >
              <GoogleBrandIcon size={26} />
            </div>

            <h2 className="t-h2" style={{ marginBottom: 10 }}>
              Signing you in…
            </h2>

            <p
              className="t-lead"
              style={{
                fontSize: 15,
                margin: "0 auto 24px",
                maxWidth: 340,
                color: "var(--color-muted)",
              }}
            >
              Connecting your Google account and opening your PawPrint workspace.
            </p>

            <div
              role="progressbar"
              aria-label="Signing in with Google"
              style={{
                height: 6,
                width: "100%",
                maxWidth: 240,
                overflow: "hidden",
                borderRadius: 999,
                background: "rgb(28 20 16 / 0.1)",
              }}
            >
              <span
                className="photo-upload__progress-fill--indeterminate"
                style={{
                  display: "block",
                  height: "100%",
                  borderRadius: "inherit",
                  background: "var(--color-sage)",
                }}
              />
            </div>

            <p className="t-small" style={{ color: "var(--color-muted)", marginTop: 20 }}>
              Taking you to your account…
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="page-section">
      <div className="wrap" style={{ maxWidth: 480 }}>
        <h1 className="t-h1" data-enter style={{ marginBottom: 8 }}>
          Welcome back
        </h1>
        <p className="t-lead" data-enter="2" style={{ marginBottom: 32 }}>
          Log in to post flyers and help pets get home.
        </p>

        <div className="card form-card" data-enter="3">
          {callbackError && (
            <div className="error-box" role="alert" style={{ marginBottom: 16 }}>
              {callbackError}
            </div>
          )}

          <form
            onSubmit={form.handleSubmit((values) => startTransition(() => submit(values)))}
            style={{ display: "flex", flexDirection: "column", gap: 16 }}
            noValidate
          >
            <FieldShell label="Email" htmlFor="login-email" error={form.formState.errors.email?.message}>
              <IconInput
                id="login-email"
                type="email"
                autoComplete="email"
                aria-invalid={Boolean(form.formState.errors.email)}
                icon={<Mail size={18} strokeWidth={1.8} />}
                {...form.register("email")}
              />
            </FieldShell>
            <FieldShell label="Password" htmlFor="login-password" error={form.formState.errors.password?.message}>
              <PasswordInput
                id="login-password"
                autoComplete="current-password"
                aria-invalid={Boolean(form.formState.errors.password)}
                {...form.register("password")}
              />
            </FieldShell>

            {state.error && (
              <div className="error-box" role="alert">
                {state.error}
              </div>
            )}

            <Button type="submit" disabled={pending} style={{ width: "100%" }}>
              {pending ? "Logging in…" : "Log in"}
            </Button>
          </form>

          <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "20px 0" }} aria-hidden="true">
            <span style={{ flex: 1, height: 1, background: "var(--color-line)" }} />
            <span className="t-label">or</span>
            <span style={{ flex: 1, height: 1, background: "var(--color-line)" }} />
          </div>

          <GoogleButton />

          <p className="t-small" style={{ color: "var(--color-muted)", marginTop: 20, textAlign: "center" }}>
            New to PawPrint?{" "}
            <Link to="/auth/register" style={{ fontWeight: 600 }}>
              Register free
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
