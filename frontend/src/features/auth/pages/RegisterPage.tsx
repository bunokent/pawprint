import { startTransition, useActionState, useEffect } from "react";
import { Link, useNavigate } from "react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Mail, UserRound } from "lucide-react";
import { authApi } from "@/features/auth/api";
import { ApiError } from "@/lib/api/client";
import { useAuth } from "@/stores/auth";
import { Button } from "@/components/ui/button";
import { FieldShell, IconInput } from "@/components/ui/field";
import { GoogleButton } from "@/features/auth/components/GoogleButton";
import { PasswordInput } from "@/features/auth/components/PasswordInput";
import { emailSchema } from "@/lib/validation";

const registerSchema = z.object({
  display_name: z.string().trim().max(120, "Keep it under 120 characters.").optional().or(z.literal("")),
  email: emailSchema("Enter a valid email address."),
  password: z
    .string()
    .min(8, "Use at least 8 characters.")
    .max(128, "Keep the password under 128 characters.")
    .refine((value) => value.trim().length >= 8, "Use at least 8 characters."),
});
type RegisterValues = z.infer<typeof registerSchema>;

interface FormState {
  error: string | null;
}

const initialState: FormState = { error: null };

export function RegisterPage() {
  const navigate = useNavigate();
  const setUser = useAuth((s) => s.setUser);
  const user = useAuth((s) => s.user);

  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    mode: "onTouched",
    reValidateMode: "onChange",
    defaultValues: { display_name: "", email: "", password: "" },
  });

  const [state, submit, pending] = useActionState(
    async (_prev: FormState, values: RegisterValues): Promise<FormState> => {
      try {
        const u = await authApi.register({
          email: values.email,
          password: values.password,
          display_name: values.display_name || undefined,
        });
        setUser(u);
        navigate("/");
        return { error: null };
      } catch (e) {
        const message =
          e instanceof ApiError
            ? e.code === "validation_error" && e.fields
              ? Object.values(e.fields).flat().join(" ")
              : e.message
            : "Registration failed. Please try again.";
        return { error: String(message) };
      }
    },
    initialState,
  );

  useEffect(() => {
    if (user) navigate("/");
  }, [user, navigate]);

  return (
    <section className="page-section">
      <div className="wrap" style={{ maxWidth: 480 }}>
        <h1 className="t-h1" data-enter style={{ marginBottom: 8 }}>
          Register free
        </h1>
        <p className="t-lead" data-enter="2" style={{ marginBottom: 32 }}>
          One account to post lost-pet alerts and share adoptable pets.
        </p>

        <div className="card form-card" data-enter="3">
          <form
            onSubmit={form.handleSubmit((values) => startTransition(() => submit(values)))}
            style={{ display: "flex", flexDirection: "column", gap: 16 }}
            noValidate
          >
            <FieldShell label="Display name (optional)" htmlFor="reg-name" error={form.formState.errors.display_name?.message}>
              <IconInput
                id="reg-name"
                type="text"
                autoComplete="name"
                icon={<UserRound size={18} strokeWidth={1.8} />}
                {...form.register("display_name")}
              />
            </FieldShell>
            <FieldShell label="Email" htmlFor="reg-email" error={form.formState.errors.email?.message}>
              <IconInput
                id="reg-email"
                type="email"
                autoComplete="email"
                aria-invalid={Boolean(form.formState.errors.email)}
                icon={<Mail size={18} strokeWidth={1.8} />}
                {...form.register("email")}
              />
            </FieldShell>
            <FieldShell
              label="Password"
              htmlFor="reg-password"
              hint="At least 8 characters."
              error={form.formState.errors.password?.message}
            >
              <PasswordInput
                id="reg-password"
                autoComplete="new-password"
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
              {pending ? "Creating account…" : "Create account"}
            </Button>
          </form>

          <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "20px 0" }} aria-hidden="true">
            <span style={{ flex: 1, height: 1, background: "var(--color-line)" }} />
            <span className="t-label">or</span>
            <span style={{ flex: 1, height: 1, background: "var(--color-line)" }} />
          </div>

          <GoogleButton />

          <p className="t-small" style={{ color: "var(--color-muted)", marginTop: 20, textAlign: "center" }}>
            Already have an account?{" "}
            <Link to="/auth/login" style={{ fontWeight: 600 }}>
              Log in
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
