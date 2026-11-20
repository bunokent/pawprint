import { http, HttpResponse } from "msw";
import type { components } from "@/lib/api/schema";

type User = components["schemas"]["User"];
type Pet = components["schemas"]["Pet"];
type Flyer = components["schemas"]["Flyer"];
type RewardInit = components["schemas"]["RewardInit"];
type RewardStatus = components["schemas"]["RewardStatus"];

export const mockUser = (overrides: Partial<User> = {}): User => ({
  id: "11111111-1111-1111-1111-111111111111",
  email: "mia@example.com",
  display_name: "Mia",
  phone: "",
  avatar_path: "",
  avatar_url: "",
  google_id: null,
  email_verified: true,
  ...overrides,
});

export const mockPet = (overrides: Partial<Pet> = {}): Pet => ({
  id: "22222222-2222-2222-2222-222222222222",
  name: "Bento",
  species: "dog",
  breed: "Shiba Inu",
  color: "tan",
  age: 3,
  temperament_tags: ["friendly", "good with kids"],
  health_tags: [],
  photo_path: "pets/photos/bento.jpg",
  photo_url: "http://localhost:8000/media/pets/photos/bento.jpg",
  status: "lost",
  created_at: "2026-11-10T08:00:00Z",
  ...overrides,
});

export const mockFlyer = (overrides: Partial<Flyer> = {}): Flyer => ({
  id: "33333333-3333-3333-3333-333333333333",
  mode: "emergency",
  status: "active",
  pet: mockPet(),
  creator: mockUser().id,
  creator_display_name: "Mia",
  last_seen_location: "Barangay hall, Quezon City",
  last_seen_date: "2026-11-15T18:30:00Z",
  location_lat: 14.5547,
  location_lng: 121.0244,
  distinctive_markings: "white patch on left ear",
  contact_phone: "0917 000 0000",
  contact_email: "mia@example.com",
  reward_enabled: true,
  reward_amount_cents: 500000,
  reward_currency: "PHP",
  qr_target_type: "flyer_url",
  qr_target_value: "http://localhost:5173/flyers/33333333-3333-3333-3333-333333333333",
  photo_url: "http://localhost:8000/media/pets/photos/bento.jpg",
  export_png_url: "http://localhost:8000/media/exports/bento.png",
  export_pdf_url: "http://localhost:8000/media/exports/bento.pdf",
  created_at: "2026-11-16T09:00:00Z",
  updated_at: "2026-11-16T09:00:00Z",
  ...overrides,
});

/** Seeded-style found-pet flyer (mirrors backend seed_demo "Miso"). */
export const mockFoundFlyer = (overrides: Partial<Flyer> = {}): Flyer =>
  mockFlyer({
    id: "66666666-6666-6666-6666-666666666666",
    mode: "found",
    status: "active",
    pet: mockPet({ name: "Miso", species: "cat", breed: "Domestic shorthair", color: "orange", status: "found" }),
    last_seen_location: "Near the market, Manila",
    last_seen_date: "2026-11-17T07:00:00Z",
    location_lat: 14.5647,
    location_lng: 120.9989,
    reward_enabled: false,
    reward_amount_cents: 0,
    ...overrides,
  });

export const mockRewardInit = (overrides: Partial<RewardInit> = {}): RewardInit => ({
  transaction_id: "44444444-4444-4444-4444-444444444444",
  provider: "gcash",
  status: "pending",
  amount_cents: 500000,
  currency: "PHP",
  checkout_url: "",
  qr_payload: "qrph://pay?ref=abc123",
  ...overrides,
});

export const mockRewardStatus = (overrides: Partial<RewardStatus> = {}): RewardStatus => ({
  id: "44444444-4444-4444-4444-444444444444",
  provider: "gcash",
  status: "pending",
  amount_cents: 500000,
  currency: "PHP",
  provider_reference: "pi_dev_123",
  created_at: "2026-11-16T10:00:00Z",
  ...overrides,
});

/** Mutable reward-status map so tests can flip a transaction mid-poll. */
export const rewardStatusStore = new Map<string, RewardStatus>();
export function setRewardStatus(id: string, status: Partial<RewardStatus>) {
  rewardStatusStore.set(id, { ...mockRewardStatus({ id }), ...status });
}

/** When true, the photo endpoint answers 422 no_pet_detected. */
export let uploadRejects = false;
export function setUploadRejects(v: boolean) {
  uploadRejects = v;
}

const err = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) =>
  HttpResponse.json({ error: { code, message, ...extra } }, { status });

export const guestHandlers = [
  http.get("*/api/auth/me", () => err(401, "authentication_required", "Authentication required.", { session_expired: true })),
];

export const handlers = [
  ...guestHandlers,

  http.post("*/api/auth/register", async ({ request }) => {
    const body = (await request.json()) as { email?: string };
    if (body.email === "taken@example.com") return err(400, "validation_error", "email: A user with this email already exists.");
    return HttpResponse.json(mockUser({ email: body.email ?? "new@example.com" }), { status: 201 });
  }),

  http.post("*/api/auth/login", async ({ request }) => {
    const body = (await request.json()) as { email?: string; password?: string };
    if (body.password !== "demo1234") return err(400, "auth_error", "Invalid email or password.");
    return HttpResponse.json(mockUser({ email: body.email ?? "mia@example.com" }));
  }),

  http.post("*/api/auth/logout", () => HttpResponse.json({ status: "logged_out" })),

  http.patch("*/api/auth/profile", async ({ request }) => {
    const body = (await request.json()) as Partial<User>;
    return HttpResponse.json(mockUser(body));
  }),

  // NOTE: do not parse the multipart body here — undici cannot read jsdom FormData.
  http.post("*/api/auth/avatar", () =>
    HttpResponse.json(
      mockUser({
        avatar_path: "avatars/11111111-1111-1111-1111-111111111111/a1b2c3.jpg",
        avatar_url: "http://localhost:8000/media/avatars/11111111-1111-1111-1111-111111111111/a1b2c3.jpg",
      }),
    ),
  ),

  http.post("*/api/auth/google/url", () =>
    HttpResponse.json({ url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=dev-google-client-id&redirect_uri=http%3A%2F%2Flocalhost%3A5173%2Fauth%2Flogin" }),
  ),

  http.post("*/api/auth/google/callback", () =>
    HttpResponse.json({ user: mockUser({ google_id: "g-123", email_verified: true }), created: true }),
  ),

  http.get("*/api/flyers", ({ request }) => {
    const url = new URL(request.url);
    const mode = url.searchParams.get("mode");
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    let results = [
      mockFlyer(),
      mockFlyer({ id: "55555555-5555-5555-5555-555555555555", mode: "outreach", pet: mockPet({ name: "Mochi", species: "cat", status: "adoptable" }), status: "active", reward_enabled: false, reward_amount_cents: 0 }),
      mockFoundFlyer(),
    ];
    if (mode) results = results.filter((f) => f.mode === mode);
    if (q) results = results.filter((f) => `${f.pet.name} ${f.pet.breed} ${f.pet.color}`.toLowerCase().includes(q));
    return HttpResponse.json({ results, next: null, previous: null });
  }),

  // NOTE: registered before "*/api/flyers/:id" — that pattern would also match "/map".
  http.get("*/api/flyers/map", () => HttpResponse.json([mockFlyer(), mockFoundFlyer()])),

  http.get("*/api/flyers/mine", () =>
    HttpResponse.json({ results: [mockFlyer(), mockFoundFlyer()], next: null, previous: null }),
  ),

  http.post("*/api/flyers/new", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json(mockFlyer({ ...(body as Partial<Flyer>) }), { status: 201 });
  }),

  http.get("*/api/flyers/:id", ({ params }) => {
    if (params.id === "missing") return err(404, "not_found", "Flyer not found.");
    return HttpResponse.json(mockFlyer({ id: String(params.id) }));
  }),

  http.patch("*/api/flyers/:id/edit", async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json(mockFlyer({ id: String(params.id), ...(body as Partial<Flyer>) }));
  }),

  http.delete("*/api/flyers/:id/edit", () => new HttpResponse(null, { status: 204 })),

  http.post("*/api/pets/photos", () => {
    if (uploadRejects) {
      return err(422, "no_pet_detected", "No pet detected in the photo. Please upload a clear photo of your pet.", {
        detected_labels: ["person", "car"],
      });
    }
    // NOTE: do not parse the multipart body here — undici cannot read jsdom FormData.
    return HttpResponse.json(
      {
        key: "pets/photos/bento.jpg",
        url: "http://localhost:8000/media/pets/photos/bento.jpg",
        thumb_key: "pets/photos/thumb_bento.jpg",
        thumb_url: "http://localhost:8000/media/pets/photos/thumb_bento.jpg",
        pet_classes: ["dog"],
        detected_classes: ["dog"],
        max_confidence: 0.92,
        breed: "Shiba Inu",
        breed_confidence: 0.93,
        color: "tan",
        color_confidence: 0.88,
      },
      { status: 201 },
    );
  }),

  http.post("*/api/pets", async ({ request }) => {
    const body = (await request.json()) as Partial<Pet>;
    return HttpResponse.json(mockPet({ ...body, id: "66666666-6666-6666-6666-666666666666" }), { status: 201 });
  }),

  http.post("*/api/rewards", async ({ request }) => {
    const body = (await request.json()) as { flyer_id: string; provider: string; amount_cents?: number; currency?: string };
    const txId = "44444444-4444-4444-4444-444444444444";
    setRewardStatus(txId, { id: txId, provider: body.provider as "stripe" | "gcash", status: "pending", amount_cents: body.amount_cents ?? 500000, currency: body.currency ?? "PHP" });
    if (body.provider === "stripe") {
      return HttpResponse.json(mockRewardInit({ transaction_id: txId, provider: "stripe", checkout_url: "https://checkout.stripe.com/test/pay/cs_test_123", qr_payload: "" }), { status: 201 });
    }
    return HttpResponse.json(mockRewardInit({ transaction_id: txId }), { status: 201 });
  }),

  http.get("*/api/rewards/mine", () => HttpResponse.json([mockRewardStatus()])),

  http.get("*/api/rewards/:id/status", ({ params }) => {
    const id = String(params.id);
    const tx = rewardStatusStore.get(id);
    if (!tx) return err(404, "not_found", "Transaction not found.");
    return HttpResponse.json(tx);
  }),

  // Nominatim (OpenStreetMap) geocoding used by the Leaflet location picker —
  // hermetic defaults for unit tests; specific tests override via mswServer.use.
  http.get("https://nominatim.openstreetmap.org/search", () => HttpResponse.json([])),
  http.get("https://nominatim.openstreetmap.org/reverse", () => HttpResponse.json({ display_name: "Test location, Manila" })),
];
