import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { Camera, Mail, Phone, UserRound } from "lucide-react";
import { authApi } from "@/features/auth/api";
import { ApiError } from "@/lib/api/client";
import { useAuth } from "@/stores/auth";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/ui/button";
import { FieldShell, IconInput } from "@/components/ui/field";
import { phoneSchema } from "@/lib/validation";

const profileSchema = z.object({
  display_name: z.string().trim().max(120, "Keep it under 120 characters.").optional().or(z.literal("")),
  phone: phoneSchema(),
});
type ProfileValues = z.infer<typeof profileSchema>;

interface FormState {
  error: string | null;
  saved: boolean;
}

const initialState: FormState = { error: null, saved: false };

export function SettingsPage() {
  const navigate = useNavigate();
  const { user, checked, setUser } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<string | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    mode: "onTouched",
    reValidateMode: "onChange",
    values: { display_name: user?.display_name ?? "", phone: user?.phone ?? "" },
  });

  const setPreview = (url: string | null) => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = url;
    setAvatarPreview(url);
  };
  useEffect(() => () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
  }, []);

  const avatarUpload = useMutation({
    mutationFn: (file: File) => authApi.uploadAvatar(file),
    onSuccess: (u) => {
      setUser(u);
      setPreview(null);
      setAvatarError(null);
    },
    onError: (e) => {
      setPreview(null);
      setAvatarError(e instanceof ApiError ? e.message : "Could not upload the photo. Please try again.");
    },
  });

  const pickAvatar = (file: File | undefined) => {
    if (!file || avatarUpload.isPending) return;
    setAvatarError(null);
    setPreview(URL.createObjectURL(file));
    avatarUpload.mutate(file);
  };

  const [state, submit, pending] = useActionState(
    async (_prev: FormState, values: ProfileValues): Promise<FormState> => {
      try {
        const u = await authApi.updateProfile({
          display_name: values.display_name ?? "",
          phone: values.phone ?? "",
        });
        setUser(u);
        return { error: null, saved: true };
      } catch (e) {
        return {
          error: e instanceof ApiError ? e.message : "Could not save your profile. Please try again.",
          saved: false,
        };
      }
    },
    initialState,
  );

  useEffect(() => {
    if (checked && !user) {
      navigate("/auth/login", { replace: true });
    }
  }, [checked, user, navigate]);

  if (!user) {
    return null;
  }

  const displayName = user.display_name || user.email;

  return (
    <section className="page-section">
      <div className="wrap" style={{ maxWidth: 720 }}>
        <h1 className="t-h1" data-enter style={{ marginBottom: 8 }}>
          Profile settings
        </h1>
        <p className="t-lead" data-enter="2" style={{ marginBottom: 32 }}>
          Your name and photo show on your flyers and in the app header.
        </p>

        <div
          className="card form-card"
          style={{ display: "flex", flexDirection: "column", gap: 20, marginBottom: 24 }}
          data-enter="3"
        >
          <span className="t-label" style={{ color: "var(--color-muted)" }}>
            Profile picture
          </span>
          <div className="avatar-row">
            <div style={{ position: "relative", display: "inline-flex" }}>
              <Avatar src={avatarPreview ?? user.avatar_url} name={displayName} size={96} />
              {avatarUpload.isPending && (
                <span
                  role="status"
                  className="t-small"
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 999,
                    background: "color-mix(in srgb, var(--color-paper) 88%, transparent)",
                    fontWeight: 600,
                  }}
                >
                  Uploading…
                </span>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="photo-upload__input"
                aria-label="Choose a profile picture"
                onChange={(e) => {
                  pickAvatar(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="secondary"
                disabled={avatarUpload.isPending}
                onClick={() => fileRef.current?.click()}
              >
                <Camera size={16} strokeWidth={2} aria-hidden="true" />
                {avatarUpload.isPending ? "Uploading…" : user.avatar_path ? "Change photo" : "Choose a photo"}
              </Button>
              <span className="t-small" style={{ color: "var(--color-muted)" }}>
                JPG or PNG, up to 5 MB. Stored privately, shown with a signed link.
              </span>
            </div>
          </div>
          {avatarError && (
            <div className="error-box" role="alert">
              {avatarError}
            </div>
          )}
        </div>

        <div className="card form-card" data-enter="4">
          <form
            onSubmit={form.handleSubmit((v) => startTransition(() => submit(v)))}
            style={{ display: "flex", flexDirection: "column", gap: 16 }}
            noValidate
          >
            <span className="t-label" style={{ color: "var(--color-muted)" }}>
              Account details
            </span>
            <FieldShell label="Display name" htmlFor="settings-name" error={form.formState.errors.display_name?.message}>
              <IconInput
                id="settings-name"
                type="text"
                autoComplete="name"
                aria-invalid={Boolean(form.formState.errors.display_name)}
                icon={<UserRound size={18} strokeWidth={1.8} />}
                {...form.register("display_name")}
              />
            </FieldShell>
            <FieldShell label="Phone" htmlFor="settings-phone" error={form.formState.errors.phone?.message}>
              <IconInput
                id="settings-phone"
                type="tel"
                autoComplete="tel"
                aria-invalid={Boolean(form.formState.errors.phone)}
                icon={<Phone size={18} strokeWidth={1.8} />}
                {...form.register("phone")}
              />
            </FieldShell>
            <FieldShell label="Email" htmlFor="settings-email" hint="Your email is your login — it can't be changed here.">
              <IconInput
                id="settings-email"
                type="email"
                value={user.email}
                readOnly
                icon={<Mail size={18} strokeWidth={1.8} />}
              />
            </FieldShell>

            {state.error && (
              <div className="error-box" role="alert">
                {state.error}
              </div>
            )}
            {state.saved && (
              <p role="status" className="t-body" style={{ color: "var(--color-sage-deep)", fontWeight: 600 }}>
                Profile saved.
              </p>
            )}

            <div className="btn-row">
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
