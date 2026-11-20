import { describe, expect, it, beforeEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GalleryPage } from "@/features/flyers/pages/GalleryPage";
import { FlyerDetailPage } from "@/features/flyers/pages/FlyerDetailPage";
import { BuilderWizard } from "@/features/flyers/pages/BuilderWizard";
import { MyFlyersPage } from "@/features/flyers/pages/MyFlyersPage";
import { useAuth } from "@/stores/auth";
import { mswServer } from "@/test/setup";
import { renderWithProviders } from "@/test/utils";
import { mockFlyer, mockFoundFlyer, mockPet, mockUser, setUploadRejects } from "@/test/handlers";
import type { Flyer } from "@/features/flyers/api";

beforeEach(() => {
  useAuth.setState({ user: null, checked: true });
});

describe("GalleryPage (guest browse)", () => {
  it("lists flyers for guests and filters by mode", async () => {
    renderWithProviders(<GalleryPage />, { route: "/flyers" });
    expect(await screen.findByText("Bento")).toBeInTheDocument();
    expect(screen.getByText("Mochi")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Adoptable" }));
    await waitFor(() => expect(screen.queryByText("Bento")).not.toBeInTheDocument());
    expect(screen.getByText("Mochi")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Adoptable pets");
  });

  it("filters to found pets", async () => {
    const user = userEvent.setup();
    renderWithProviders(<GalleryPage />, { route: "/flyers" });
    expect(await screen.findByText("Bento")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Found" }));
    await waitFor(() => expect(screen.queryByText("Bento")).not.toBeInTheDocument());
    expect(screen.getByText("Miso")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Found pets");
  });

  it("searches by name", async () => {
    const user = userEvent.setup();
    renderWithProviders(<GalleryPage />, { route: "/flyers" });
    expect(await screen.findByText("Bento")).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Search pets/), "mochi");
    await user.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(screen.queryByText("Bento")).not.toBeInTheDocument());
    expect(screen.getByText("Mochi")).toBeInTheDocument();
  });

  it("shows the empty state when nothing matches", async () => {
    const user = userEvent.setup();
    renderWithProviders(<GalleryPage />, { route: "/flyers" });
    await screen.findByText("Bento");
    await user.type(screen.getByLabelText(/Search pets/), "zzz-no-match");
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText("No flyers match")).toBeInTheDocument();
  });

  it("shows an error box when the list fails", async () => {
    mswServer.use(http.get("*/api/flyers", () => HttpResponse.error()));
    renderWithProviders(<GalleryPage />, { route: "/flyers" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load flyers");
  });
});

describe("FlyerDetailPage", () => {
  const renderDetail = (id: string) =>
    renderWithProviders(<FlyerDetailPage />, { route: `/flyers/${id}`, routePath: "/flyers/:id" });

  it("renders the flyer with QR, print and export actions for a guest", async () => {
    renderDetail("33333333-3333-3333-3333-333333333333");
    expect(await screen.findByTestId("flyer-sheet")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Lost pet: Bento");
    expect(await screen.findByAltText(/QR code linking to Bento/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Print A4 flyer/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /PDF/ })).toHaveAttribute("href", mockFlyer().export_pdf_url);
    // Guest cannot fund the reward directly — gets a login link instead.
    expect(screen.getByRole("link", { name: /Log in to fund reward/ })).toBeInTheDocument();
    // Guests see the finder contact block.
    expect(screen.getByText(/0917 000 0000/)).toBeInTheDocument();
  });

  it("shows the fund-reward button to a logged-in non-owner and opens the checkout modal", async () => {
    useAuth.setState({ user: mockUser({ id: "99999999-9999-9999-9999-999999999999" }), checked: true });
    const user = userEvent.setup();
    renderDetail("33333333-3333-3333-3333-333333333333");
    await user.click(await screen.findByRole("button", { name: /Fund reward/ }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("Fund the reward for Bento");
  });

  it("shows owner actions to the creator", async () => {
    useAuth.setState({ user: mockUser(), checked: true });
    const patchCalls: Array<Record<string, unknown>> = [];
    mswServer.use(
      http.patch("*/api/flyers/:id/edit", async ({ request }) => {
        patchCalls.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(mockFlyer({ status: "resolved" }));
      }),
    );
    const user = userEvent.setup();
    renderDetail("33333333-3333-3333-3333-333333333333");
    await user.click(await screen.findByRole("button", { name: /Mark reunited/ }));
    await waitFor(() => expect(patchCalls).toEqual([{ status: "resolved" }]));
    expect(await screen.findByRole("button", { name: "Delete flyer" })).toBeInTheDocument();
  });

  it("requires a second click to delete", async () => {
    useAuth.setState({ user: mockUser(), checked: true });
    const deleteCalls = vi.fn();
    mswServer.use(
      http.delete("*/api/flyers/:id/edit", () => {
        deleteCalls();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    renderDetail("33333333-3333-3333-3333-333333333333");
    const btn = await screen.findByRole("button", { name: "Delete flyer" });
    await user.click(btn);
    expect(deleteCalls).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Click again to delete/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Click again to delete/ }));
    await waitFor(() => expect(deleteCalls).toHaveBeenCalled());
    vi.restoreAllMocks();
  });

  it("shows an error for a missing flyer", async () => {
    renderDetail("missing");
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be loaded");
  });

  it("renders a found-pet flyer with Found at / Description and a map link (no reward)", async () => {
    mswServer.use(
      http.get("*/api/flyers/:id", () => HttpResponse.json(mockFoundFlyer({ id: "33333333-3333-3333-3333-333333333333" }))),
    );
    renderDetail("33333333-3333-3333-3333-333333333333");
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Found pet: Miso");
    expect(screen.getByText("Found at")).toBeInTheDocument();
    expect(screen.getByText(/Near the market, Manila/)).toBeInTheDocument();
    expect(screen.getByText("Description")).toBeInTheDocument();
    expect(screen.queryByText(/Reward for safe return/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View on map/ })).toHaveAttribute("href", "/map");
    expect(screen.getByText("If this is your pet, contact")).toBeInTheDocument();
    expect(screen.getByText("Found pet")).toBeInTheDocument(); // mode badge
  });
});

describe("BuilderWizard", () => {
  it("asks guests to register before posting", () => {
    renderWithProviders(<BuilderWizard />, { route: "/builder?mode=emergency" });
    expect(screen.getByRole("heading", { name: /Register to post a flyer/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Register free" })).toBeInTheDocument();
  });

  it("walks the 3 steps: photo → pet → flyer, then lands on the detail page", async () => {
    useAuth.setState({ user: mockUser(), checked: true });
    const user = userEvent.setup();
    const createdFlyers: Array<Record<string, unknown>> = [];
    mswServer.use(
      http.post("*/api/flyers/new", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        createdFlyers.push(body);
        return HttpResponse.json(mockFlyer({ id: "77777777-7777-7777-7777-777777777777", ...(body as Partial<Flyer>) }), { status: 201 });
      }),
    );
    renderWithProviders(<BuilderWizard />, {
      route: "/builder?mode=emergency",
      routePath: "/builder",
      routes: [["/flyers/:id", <FlyerDetailPage />]],
    });

    // Step 1 — mode + photo
    expect(screen.getByRole("heading", { name: "Report a lost pet" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Choose a pet photo"), {
      target: { files: [new File(["img"], "bento.jpg", { type: "image/jpeg" })] },
    });
    expect(await screen.findByRole("heading", { name: "Tell us about the pet" })).toBeInTheDocument();

    // Step 2 — pet details (breed/color are auto-prefilled from detection, so clear first)
    await user.type(screen.getByLabelText("Pet name"), "Bento");
    await user.clear(screen.getByLabelText("Breed"));
    await user.type(screen.getByLabelText("Breed"), "Shiba Inu");
    await user.type(screen.getByLabelText("Personality tags"), "friendly, good with kids");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Flyer details & reward" })).toBeInTheDocument();

    // Step 3 — flyer details + reward
    await user.type(screen.getByLabelText("Last seen location"), "Barangay hall, Quezon City");
    await user.type(screen.getByLabelText("Reward amount (PHP)"), "5000");
    await user.click(screen.getByRole("button", { name: "Publish flyer" }));

    await waitFor(() => expect(createdFlyers).toHaveLength(1));
    expect(createdFlyers[0]).toMatchObject({
      mode: "emergency",
      last_seen_location: "Barangay hall, Quezon City",
      reward_enabled: true,
      reward_amount_cents: 500000,
      reward_currency: "PHP",
    });
    // Lands on the new flyer's detail page.
    expect(await screen.findByTestId("flyer-sheet")).toBeInTheDocument();
  });

  it("shows a Next button on the photo step when a photo is already uploaded", async () => {
    useAuth.setState({ user: mockUser(), checked: true });
    const user = userEvent.setup();
    renderWithProviders(<BuilderWizard />, { route: "/builder?mode=emergency" });
    fireEvent.change(screen.getByLabelText("Choose a pet photo"), {
      target: { files: [new File(["img"], "bento.jpg", { type: "image/jpeg" })] },
    });
    await screen.findByRole("heading", { name: "Tell us about the pet" });

    // Go back to the photo step — the uploaded photo is still there.
    await user.click(screen.getByRole("button", { name: "← Back" }));
    expect(await screen.findByRole("heading", { name: "Report a lost pet" })).toBeInTheDocument();
    expect(screen.getByAltText("Uploaded pet preview")).toBeInTheDocument();

    // No re-upload needed: Next continues with the existing photo.
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("heading", { name: "Tell us about the pet" })).toBeInTheDocument();
  });

  it("shows the detected species as plain read-only text (ambiguous cat+dog)", async () => {
    useAuth.setState({ user: mockUser(), checked: true });
    mswServer.use(
      http.post("*/api/pets/photos", () =>
        HttpResponse.json(
          {
            key: "pets/photos/ambiguous.jpg",
            url: "http://localhost:8000/media/pets/photos/ambiguous.jpg",
            thumb_key: "pets/photos/thumb_ambiguous.jpg",
            thumb_url: "http://localhost:8000/media/pets/photos/thumb_ambiguous.jpg",
            pet_classes: ["cat", "dog"],
            detected_classes: ["cat", "dog"],
            max_confidence: 0.717,
            breed: "",
            breed_confidence: 0.0,
            color: "",
            color_confidence: 0.0,
          },
          { status: 201 },
        ),
      ),
    );
    renderWithProviders(<BuilderWizard />, { route: "/builder?mode=emergency" });
    fireEvent.change(screen.getByLabelText("Choose a pet photo"), {
      target: { files: [new File(["img"], "ambiguous.jpg", { type: "image/jpeg" })] },
    });
    await screen.findByRole("heading", { name: "Tell us about the pet" });
    // Plain read-only text — not a <select>, not editable.
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByTestId("species-value")).toHaveTextContent("Cat, Dog");
    expect(screen.getByText("Auto detected: change photo to redetect")).toBeInTheDocument();
  });

  it("shows the refined species name as read-only text even when raw YOLO labels disagree", async () => {
    useAuth.setState({ user: mockUser(), checked: true });
    mswServer.use(
      http.post("*/api/pets/photos", () =>
        HttpResponse.json(
          {
            key: "pets/photos/rabbit.jpg",
            url: "http://localhost:8000/media/pets/photos/rabbit.jpg",
            thumb_key: "pets/photos/thumb_rabbit.jpg",
            thumb_url: "http://localhost:8000/media/pets/photos/thumb_rabbit.jpg",
            pet_classes: ["rabbit"],
            detected_classes: ["cat"],
            max_confidence: 0.85,
            breed: "",
            breed_confidence: 0.0,
            color: "white",
            color_confidence: 0.9,
          },
          { status: 201 },
        ),
      ),
    );
    renderWithProviders(<BuilderWizard />, { route: "/builder?mode=emergency" });
    fireEvent.change(screen.getByLabelText("Choose a pet photo"), {
      target: { files: [new File(["img"], "rabbit.jpg", { type: "image/jpeg" })] },
    });
    await screen.findByRole("heading", { name: "Tell us about the pet" });
    expect(screen.getByTestId("species-value")).toHaveTextContent("Rabbit");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("prefills breed & color with a High confidence badge and the helper tip", async () => {
    useAuth.setState({ user: mockUser(), checked: true });
    renderWithProviders(<BuilderWizard />, { route: "/builder?mode=emergency" });
    fireEvent.change(screen.getByLabelText("Choose a pet photo"), {
      target: { files: [new File(["img"], "bento.jpg", { type: "image/jpeg" })] },
    });
    await screen.findByRole("heading", { name: "Tell us about the pet" });
    // Default MSW upload: breed "Shiba Inu" @ 0.93, color "tan" @ 0.88 → prefilled.
    expect(screen.getByLabelText("Breed")).toHaveValue("Shiba Inu");
    expect(screen.getByLabelText("Color")).toHaveValue("tan");
    expect(screen.getAllByText("High confidence")).toHaveLength(2);
    expect(screen.getByTestId("autofill-tip")).toHaveTextContent(
      "Auto-detected — change if not correct. Detection is not 100% accurate.",
    );
    // Fields stay editable.
    expect(screen.getByLabelText("Breed")).toBeEnabled();
    expect(screen.getByLabelText("Color")).toBeEnabled();
  });

  it("leaves breed & color blank with 'Not detected' when confidence is low (no guessing)", async () => {
    useAuth.setState({ user: mockUser(), checked: true });
    mswServer.use(
      http.post("*/api/pets/photos", () =>
        HttpResponse.json(
          {
            key: "pets/photos/unclear.jpg",
            url: "http://localhost:8000/media/pets/photos/unclear.jpg",
            thumb_key: "pets/photos/thumb_unclear.jpg",
            thumb_url: "http://localhost:8000/media/pets/photos/unclear.jpg",
            pet_classes: ["dog"],
            detected_classes: ["dog"],
            max_confidence: 0.9,
            breed: "poodle",
            breed_confidence: 0.41,
            color: "brown",
            color_confidence: 0.3,
          },
          { status: 201 },
        ),
      ),
    );
    renderWithProviders(<BuilderWizard />, { route: "/builder?mode=emergency" });
    fireEvent.change(screen.getByLabelText("Choose a pet photo"), {
      target: { files: [new File(["img"], "unclear.jpg", { type: "image/jpeg" })] },
    });
    await screen.findByRole("heading", { name: "Tell us about the pet" });
    expect(screen.getByLabelText("Breed")).toHaveValue("");
    expect(screen.getByLabelText("Color")).toHaveValue("");
    expect(screen.getByLabelText("Breed")).toHaveAttribute("placeholder", "Not detected");
    expect(screen.getByLabelText("Color")).toHaveAttribute("placeholder", "Not detected");
    expect(screen.getAllByText("Low confidence")).toHaveLength(2);
    expect(screen.getByTestId("autofill-tip")).toBeInTheDocument();
  });

  it("re-running detection on a new photo updates the species text automatically", async () => {
    useAuth.setState({ user: mockUser(), checked: true });
    const user = userEvent.setup();
    renderWithProviders(<BuilderWizard />, { route: "/builder?mode=emergency" });
    fireEvent.change(screen.getByLabelText("Choose a pet photo"), {
      target: { files: [new File(["img"], "dog.jpg", { type: "image/jpeg" })] },
    });
    await screen.findByRole("heading", { name: "Tell us about the pet" });
    expect(screen.getByTestId("species-value")).toHaveTextContent("Dog");

    // Back to the photo step, upload a different photo (now detected as cat).
    await user.click(screen.getByRole("button", { name: "← Back" }));
    await screen.findByRole("heading", { name: "Report a lost pet" });
    mswServer.use(
      http.post("*/api/pets/photos", () =>
        HttpResponse.json(
          {
            key: "pets/photos/cat.jpg",
            url: "http://localhost:8000/media/pets/photos/cat.jpg",
            thumb_key: "pets/photos/thumb_cat.jpg",
            thumb_url: "http://localhost:8000/media/pets/photos/thumb_cat.jpg",
            pet_classes: ["cat"],
            detected_classes: ["cat"],
            max_confidence: 0.9,
            breed: "",
            breed_confidence: 0.0,
            color: "black",
            color_confidence: 0.95,
          },
          { status: 201 },
        ),
      ),
    );
    fireEvent.change(screen.getByLabelText("Choose a pet photo"), {
      target: { files: [new File(["img"], "cat.jpg", { type: "image/jpeg" })] },
    });
    await screen.findByRole("heading", { name: "Tell us about the pet" });
    expect(screen.getByTestId("species-value")).toHaveTextContent("Cat");
    // Color re-prefilled from the new photo's detection.
    expect(screen.getByLabelText("Color")).toHaveValue("black");
  });

  it("blocks publish when the reward is enabled but empty", async () => {
    useAuth.setState({ user: mockUser(), checked: true });
    const user = userEvent.setup();
    renderWithProviders(<BuilderWizard />, { route: "/builder?mode=outreach" });
    fireEvent.change(screen.getByLabelText("Choose a pet photo"), {
      target: { files: [new File(["img"], "mochi.jpg", { type: "image/jpeg" })] },
    });
    await screen.findByRole("heading", { name: "Tell us about the pet" });
    await user.type(screen.getByLabelText("Pet name"), "Mochi");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Flyer details" });
    // outreach defaults reward off; turn it on without an amount
    await user.click(screen.getByLabelText(/Offer a finder's reward/));
    await user.click(screen.getByRole("button", { name: "Publish flyer" }));
    expect(await screen.findByText("Enter a reward amount above zero.")).toBeInTheDocument();
  });

  it("posts a found-pet flyer via ?mode=found — location, date found, description, no reward", async () => {
    useAuth.setState({ user: mockUser(), checked: true });
    const user = userEvent.setup();
    const createdPets: Array<Record<string, unknown>> = [];
    const createdFlyers: Array<Record<string, unknown>> = [];
    mswServer.use(
      http.post("*/api/pets", async ({ request }) => {
        const body = (await request.json()) as Partial<Parameters<typeof mockPet>[0]>;
        createdPets.push(body as Record<string, unknown>);
        return HttpResponse.json(mockPet({ ...body, id: "66666666-6666-6666-6666-666666666666" }), { status: 201 });
      }),
      http.post("*/api/flyers/new", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        createdFlyers.push(body);
        return HttpResponse.json(mockFoundFlyer({ id: "88888888-8888-8888-8888-888888888888", ...(body as Partial<Flyer>) }), { status: 201 });
      }),
      http.get("*/api/flyers/:id", ({ params }) =>
        HttpResponse.json(mockFoundFlyer({ id: String(params.id), pet: mockPet({ name: "", status: "found" }) })),
      ),
    );
    renderWithProviders(<BuilderWizard />, {
      route: "/builder?mode=found",
      routePath: "/builder",
      routes: [["/flyers/:id", <FlyerDetailPage />]],
    });

    // Step 1 — found mode preselected from the query param.
    expect(screen.getByRole("heading", { name: "Report a found pet" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Found pet" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(screen.getByLabelText("Choose a pet photo"), {
      target: { files: [new File(["img"], "miso.jpg", { type: "image/jpeg" })] },
    });
    await screen.findByRole("heading", { name: "Describe the found pet" });

    // Step 2 — found mode hides the lost/adoptable-only fields (name, personality tags).
    expect(screen.queryByLabelText("Pet name")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Personality tags")).not.toBeInTheDocument();
    expect(screen.getByTestId("found-hint")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    // The pet is created unnamed with status "found".
    await waitFor(() => expect(createdPets[0]).toMatchObject({ name: "", status: "found" }));

    // Step 3 — found fields: location picker (fallback input without a Maps key), date, description. No reward toggle.
    expect(await screen.findByRole("heading", { name: "Found-pet details" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Offer a finder's reward/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Last seen location")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Location found"), "Near the market, Manila");
    await user.type(screen.getByLabelText("Description"), "Orange tabby, very friendly");
    await user.click(screen.getByRole("button", { name: "Publish flyer" }));

    await waitFor(() => expect(createdFlyers).toHaveLength(1));
    expect(createdFlyers[0]).toMatchObject({
      mode: "found",
      last_seen_location: "Near the market, Manila",
      distinctive_markings: "Orange tabby, very friendly",
      reward_enabled: false,
      reward_amount_cents: 0,
      // Fallback location input reports no coordinates.
      location_lat: null,
      location_lng: null,
    });
    // Lands on the found flyer's public detail page (unnamed → just "Found pet").
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Found pet");
    expect(screen.getByRole("heading", { level: 1 })).not.toHaveTextContent(":");
  });

  it("surfaces the 422 gatekeeper error inside the wizard", async () => {
    useAuth.setState({ user: mockUser(), checked: true });
    setUploadRejects(true);
    renderWithProviders(<BuilderWizard />, { route: "/builder" });
    fireEvent.change(screen.getByLabelText("Choose a pet photo"), {
      target: { files: [new File(["img"], "landscape.jpg", { type: "image/jpeg" })] },
    });
    expect(await screen.findByTestId("no-pet-error")).toBeInTheDocument();
  });
});

describe("MyFlyersPage", () => {
  it("redirects guests to login", async () => {
    renderWithProviders(<MyFlyersPage />, { route: "/my-flyers", routes: [["/auth/login", <div>LOGIN PAGE</div>]] });
    expect(await screen.findByText("LOGIN PAGE")).toBeInTheDocument();
  });

  it("lists my flyers and my reward payments for a logged-in user", async () => {
    useAuth.setState({ user: mockUser(), checked: true });
    renderWithProviders(<MyFlyersPage />, { route: "/my-flyers" });
    expect(await screen.findByText("Bento")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Reward payments" })).toBeInTheDocument();
    expect(await screen.findByText(/via gcash/)).toBeInTheDocument();
  });

  it("shows the empty state with a CTA when there are no flyers", async () => {
    mswServer.use(http.get("*/api/flyers/mine", () => HttpResponse.json({ results: [], next: null, previous: null })));
    mswServer.use(http.get("*/api/rewards/mine", () => HttpResponse.json([])));
    useAuth.setState({ user: mockUser(), checked: true });
    renderWithProviders(<MyFlyersPage />, { route: "/my-flyers" });
    expect(await screen.findByText("No flyers yet")).toBeInTheDocument();
    expect(screen.getByText("No reward payments yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create your first flyer" })).toBeInTheDocument();
  });

  it("shows the publishing panel with the optimistic card while creating (wizard)", async () => {
    useAuth.setState({ user: mockUser(), checked: true });
    let resolveCreate: (f: Flyer) => void = () => {};
    mswServer.use(
      http.post("*/api/flyers/new", () =>
        new Promise<Response>((resolve) => {
          resolveCreate = (f) => resolve(HttpResponse.json(f, { status: 201 }));
        }),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<BuilderWizard />, {
      route: "/builder?mode=emergency",
      routePath: "/builder",
      routes: [["/flyers/:id", <FlyerDetailPage />]],
    });
    fireEvent.change(screen.getByLabelText("Choose a pet photo"), {
      target: { files: [new File(["img"], "bento.jpg", { type: "image/jpeg" })] },
    });
    await screen.findByRole("heading", { name: "Tell us about the pet" });
    await user.type(screen.getByLabelText("Pet name"), "Bento");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Flyer details & reward" });
    await user.type(screen.getByLabelText("Last seen location"), "Barangay hall");
    await user.type(screen.getByLabelText("Reward amount (PHP)"), "5000");
    await user.click(screen.getByRole("button", { name: "Publish flyer" }));
    // While the create call is in flight, the optimistic card is visible.
    expect(await screen.findByTestId("publishing")).toBeInTheDocument();
    resolveCreate(mockFlyer({ id: "77777777-7777-7777-7777-777777777777" }));
    expect(await screen.findByTestId("flyer-sheet")).toBeInTheDocument();
  });

  it("labels the resolve action per mode (reunited / returned home)", async () => {
    useAuth.setState({ user: mockUser(), checked: true });
    renderWithProviders(<MyFlyersPage />, { route: "/my-flyers" });
    expect(await screen.findByRole("button", { name: "Mark reunited" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark returned home" })).toBeInTheDocument();
  });

  it("marks a flyer resolved from the owner card", async () => {
    useAuth.setState({ user: mockUser(), checked: true });
    const patchCalls: Array<Record<string, unknown>> = [];
    mswServer.use(
      http.patch("*/api/flyers/:id/edit", async ({ request }) => {
        patchCalls.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(mockFlyer({ status: "resolved" }));
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<MyFlyersPage />, { route: "/my-flyers" });
    await user.click(await screen.findByRole("button", { name: /Mark reunited/ }));
    await waitFor(() => expect(patchCalls).toEqual([{ status: "resolved" }]));
  });

  it("deletes a flyer after confirmation", async () => {
    useAuth.setState({ user: mockUser(), checked: true });
    const deleteCalls = vi.fn();
    mswServer.use(
      http.delete("*/api/flyers/:id/edit", () => {
        deleteCalls();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    renderWithProviders(<MyFlyersPage />, { route: "/my-flyers", routes: [["/my-flyers", <MyFlyersPage />]] });
    await user.click((await screen.findAllByRole("button", { name: "Delete" }))[0]);
    await waitFor(() => expect(deleteCalls).toHaveBeenCalled());
    vi.restoreAllMocks();
  });

  it("shows an error when my flyers fail to load", async () => {
    mswServer.use(http.get("*/api/flyers/mine", () => HttpResponse.error()));
    useAuth.setState({ user: mockUser(), checked: true });
    renderWithProviders(<MyFlyersPage />, { route: "/my-flyers" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load your flyers");
  });
});

describe("FlyerCard content", () => {
  it("renders mode, reward and status badges", async () => {
    useAuth.setState({ user: mockUser(), checked: true });
    renderWithProviders(<MyFlyersPage />, { route: "/my-flyers" });
    const card = await screen.findByText("Bento");
    const cardEl = card.closest("a") as HTMLElement;
    expect(within(cardEl).getByText("Lost — urgent")).toBeInTheDocument();
    expect(within(cardEl).getByText(/Reward ₱5,000/)).toBeInTheDocument();
    expect(within(cardEl).getByText("active")).toBeInTheDocument();
    expect(within(cardEl).getByText(/last seen Barangay hall/)).toBeInTheDocument();
  });

  it("renders a found card with the Found pet badge and found-at text", async () => {
    renderWithProviders(<GalleryPage />, { route: "/flyers?mode=found" });
    const card = await screen.findByText("Miso");
    const cardEl = card.closest("a") as HTMLElement;
    expect(within(cardEl).getByText("Found pet")).toBeInTheDocument();
    expect(within(cardEl).getByText(/found at Near the market, Manila/)).toBeInTheDocument();
  });
});
