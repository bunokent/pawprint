# PawPrint — Documentation

PawPrint is a lost-pet alert, found-pet posting and adoption flyer platform. Guests can browse
alerts, open the interactive pet map and scan QR codes; one unified registered account (email
or Google/Gmail OAuth) can post lost-pet emergencies, publish found pets and adoptable pets,
generate print-ready A4 flyers, and fund rewards via Stripe (test mode) or GCash/QR Ph via
PayMongo.

---

## 1. Overview & Product Vision

PawPrint helps a lost pet come home and helps a shelter pet find one. Two modes share one
product:

- **Emergency Lost-Pet Mode** — urgent, high-contrast alerts with last-seen details,
  distinctive markings, an optional reward, and a scannable QR code on a print-ready A4 flyer.
- **Found-Pet Mode** — a terracotta-accented posting for a pet someone found: photo, species,
  location found (map pin), date, description and contact details — no reward.
- **Adoption Outreach Mode** — warm, welcoming adoption flyers with personality tags and
  shelter/foster framing.

Every uploaded pet photo passes a YOLO-World open-vocabulary animal-detection gatekeeper before
it ever reaches storage; a CLIP second stage names the actual species and classifies
breed/color (prefilled in the builder only when confidence ≥ 0.80). Non-animal photos are
rejected with a friendly 422 — no strikes, no bans.
The web app (`frontend/`, React 19 + TS + Vite) implements the full product in the browser —
including a public interactive pet map at `/map` (Leaflet + OpenStreetMap photo pins) —
and Playwright E2E covers the 10 critical journeys end-to-end.

## 2. Architecture & Stack

- **Backend**: Django 5.2+ (Python 3.12+), DRF, drf-spectacular (OpenAPI), PostgreSQL 16,
  Redis 7, Celery, Django Channels (WebSockets), django-allauth (email + Google OAuth 2.0).
  **No Django Admin** — `django.contrib.admin` is completely removed.
  Packaging: `pyproject.toml` declares an explicit setuptools build backend with
  `packages.find include = ["apps*", "config*"]` so `uv pip install .[dev]` succeeds on a
  full checkout (flat-layout auto-discovery otherwise aborts on `apps/`+`config/`+`templates/`;
  the old Dockerfile avoided this by installing deps before `COPY . .` — it was removed in
  Phase 29).
- **Frontend**: React 19 + TypeScript + Vite, React Router v7, TanStack Query v5, Axios,
  Zustand, React Hook Form + Zod, Shadcn/UI, Tailwind v4. React Compiler enabled.
- **Storage**: Cloudinary (private delivery type, HMAC-signed URLs only) via the `cloudinary`
  SDK, wrapped in a Django `Storage` backend (`apps/common/cloudinary_storage.py`).
- **Payments**: Stripe Python SDK (test mode) + PayMongo REST via httpx (GCash Checkout, QR Ph).
- **AI Vision**: Ultralytics YOLO-World (`yolov8s-worldv2.pt`) with 66 configured animal labels as
  the gate/boxer (its best animal `xyxy` box also drives the in-memory species-classification
  crop), plus CLIP ViT-B/32 zero-shot second stages: one names the actual species
  (`pet_classes`, on the cropped animal with a contrastive confusable-group pass so a tabby
  cat is not named "tiger"), a separate
  `PetAttributeService` classifies breed (curated dog/cat breed lists; other species → empty)
  and color, with raw confidences returned on the upload response. Labels are grouped into
  domestic, zoo/exotic, reptile, amphibian, small-mammal, farm, bird, and fish categories.
  There is **no photo matching / re-identification** — lost and found reports never compare
  photos. In-app notifications live
   in `apps.notifications` (REST + per-user `ws/notifications/` push). Maps: Leaflet 1.9
   (npm dependency, no API key) over OpenStreetMap
  tiles, with Nominatim geocoding (address search + reverse geocode), for the location
  picker and `/map`.
- **Exports**: WeasyPrint A4@300dpi PNG/PDF flyers + Pillow thumbnails; Playwright for
  browser-side exports.
- **Infra**: **no Docker** — dependencies run directly on the host (setup in
  `.env.example`): a dedicated local PostgreSQL 16 cluster on **127.0.0.1:5433** (kept off
  any system cluster on :5432 so tests never touch real data), a Redis-compatible server
  (valkey, ships `redis-server`) on **127.0.0.1:6379**, and **mailpit** for dev email
  (SMTP :1025, UI :8025). On the dev machine these run as systemd user services
  (`pawprint-postgres`, `redis-pawprint`, `mailpit`) — no sudo needed. Run the app with
  `cd backend && .venv/bin/python manage.py migrate && .venv/bin/python manage.py runserver 8000`
  plus `celery -A config worker -Q flyers,webhooks,images,default -l info`, and
  `cd frontend && npm run dev` → **http://localhost:5173** (Vite proxies `/api`, `/media`,
  `/ws` to `PAWPRINT_API_URL`, default `http://127.0.0.1:8000`). Storage is Cloudinary, so
  no local object storage is needed. Host-side `python manage.py ...` auto-loads the root
  `.env` via python-dotenv (real env vars always win over it). For tests and Playwright
  E2E, `PAWPRINT_TESTING=1` (or running under pytest) switches to locmem cache, in-memory
  channel layer, eager Celery, `memory://` broker and filesystem storage — no
  Redis/Cloudinary needed.
- **CI**: GitHub Actions (`.github/workflows/ci.yml`) runs four jobs on every push/PR to
  `main`: `backend-lint` (ruff + mypy), `backend-test` (pytest `-n auto` with
  `--cov-fail-under=80` against a `postgres:16` service), `frontend-test` (`npm ci` →
  `tsc` → `vitest --coverage` with thresholds → `vite build`), and `e2e` (Playwright 9
  journeys against a `postgres:16` service on :5433, with migrate + `seed_demo` and cached
  YOLO-World weights). Coverage HTML/XML and Playwright reports upload as artifacts.

## 3. Access Model (Guest vs Registered — STRICT 2 Modes)

| Capability | Guest | Registered |
|---|---|---|
| Browse lost/found/adoptable flyers | ✅ | ✅ |
| Full-text search / filter flyers | ✅ | ✅ |
| Browse the interactive pet map (`/map`) | ✅ | ✅ |
| View flyer detail (incl. QR scan landing) | ✅ | ✅ |
| Download / print A4 flyer exports | ✅ (active flyers) | ✅ |
| Create / edit / delete own flyers (lost, found, adoptable) | ❌ | ✅ |
| Upload pet photos (YOLO-World-gated) | ❌ | ✅ |
| Fund rewards (Stripe / GCash) | ❌ | ✅ |

There is **no admin role, no staff flag, no strike/ban system**. Object-level mutations are
restricted to the creator via `IsOwnerOrReadOnly`. The frontend enforces the same split in
the UI: guests see browse/scan/map actions, registered users additionally see New flyer, My
flyers, photo upload and Fund reward.

## 4. Backend — Models & ORM

Apps under `backend/apps/`: `users`, `pets`, `flyers`, `rewards`, `webhooks`, `vision`.

- `users.User` — AbstractUser, UUID PK, email login, `display_name`, `phone`, `avatar_path`,
  `google_id` (nullable unique), `email_verified`, `stripe_customer_id`.
- `pets.Pet` — UUID PK, `owner` FK, species/breed/color/age, `temperament_tags` & `health_tags`
  JSON (GIN indexes), `photo_path` (cover photo), `status` (`lost|found|adoptable|reunited|adopted`),
  `SearchVector` GIN index on `(name, breed, color)`, composite index `(status, created_at)`.
- `pets.PetPhoto` — one photo per row: `pet` FK (`related_name="photos"`, cascade), `photo_path`,
  index `(pet, created_at)` (migration `pets/0006`).
  A report carries up to **4** photos (different angles of the same pet, `MAX_PET_PHOTOS`);
  the first is the cover. The stored file is always the full, uncropped display image.
- `flyers.Flyer` — UUID PK, `pet` FK, `creator` FK, `mode` (`emergency|found|outreach`), last-seen
  fields, `location_lat`/`location_lng` floats (the map pin), contact fields, reward fields, QR
  target, export paths, `status` (`draft|generating|active|resolved`); indexes
  `(mode, status, created_at)`, `(creator, mode)`, and `flyer_status_location_idx`
  `(status, location_lat, location_lng)` for the pet map.
- `rewards.RewardTransaction` — UUID PK, `flyer`/`user` FKs, `provider` (`stripe|gcash`),
  unique `provider_reference`, `amount_cents`, `currency`, `status`, `metadata` JSON.
- `webhooks.WebhookEvent` — `UniqueConstraint(provider, event_id)` for idempotency.
- `vision.PetDetectionLog` — detection audit trail (classes, max confidence, passed).

Layering: `selectors/` (all reads, optimized QuerySets, SearchVector FTS, cursor pagination),
`services/` (all writes in `@transaction.atomic`, external calls, task dispatch), thin views
(≤15 lines, zero raw ORM). Verified with `EXPLAIN ANALYZE` (see §11): gallery list runs on
`flyer_status_created_idx` in ~0.2 ms; FTS uses `pet_search_vector_gin`; reward writes use
`select_for_update` + the unique `provider_reference` for idempotency.

## 5. API Reference (OpenAPI)

Schema generated by drf-spectacular: `python manage.py spectacular --file schema.yml`,
consumed by the frontend via `openapi-typescript` → `frontend/src/lib/api/schema.d.ts`.

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/auth/register` | Guest | Create unified account (email) |
| `POST /api/auth/login` | Guest | HttpOnly session + CSRF cookie |
| `POST /api/auth/logout` | Auth | End session |
| `GET /api/auth/me` | Any | Profile incl. signed `avatar_url`, or 401 |
| `PATCH /api/auth/profile` | Auth | Update `display_name` / `phone` |
| `POST /api/auth/avatar` | Auth | Profile picture upload (10/min, no pet gate) |
| `GET /api/auth/google/url` + `POST /api/auth/google/callback` | Guest | Google/Gmail OAuth 2.0 |
| `GET /api/flyers` | Guest | Cursor-paginated gallery, FTS `?q=`, mode filter `?mode=` (`emergency|found|outreach`) |
| `GET /api/flyers/map` | Guest | Unpaginated public pet-map pins: active lost/found flyers with `location_lat`/`location_lng` |
| `GET /api/flyers/{id}` | Guest | Public flyer detail (QR scan landing) |
| `POST /api/flyers/new` | Auth | Create flyer — `mode` incl. `found`, optional `location_lat`/`location_lng` pin (dispatches A4 asset generation) |
| `PATCH/DELETE /api/flyers/{id}/edit` | Auth (owner) | Update / resolve / delete own flyer |
| `GET /api/flyers/mine` | Auth | Creator's own flyers |
| `POST /api/pets/photos` | Auth | YOLO-World-gated photo upload (10/min); response also carries CLIP `breed`/`breed_confidence`/`color`/`color_confidence` |
| `POST /api/pets` | Auth | Create pet record (links an uploaded photo) |
| `POST /api/rewards` | Auth | Create reward payment (Stripe/GCash) → checkout URL / QR payload |
| `GET /api/rewards/{id}/status` | Auth (payer/creator) | Poll payment status |
| `GET /api/rewards/mine` | Auth | Own reward history |
| `POST /api/webhooks/stripe` / `POST /api/webhooks/paymongo` | Signature | Idempotent webhooks |
| `GET /api/notifications` | Auth | Latest notifications + `unread_count` |
| `POST /api/notifications/read` | Auth | Mark all (or given `ids`) notifications read |
| `GET /api/health` | Public | Liveness probe |
| `GET /api/schema` | Public | drf-spectacular OpenAPI schema |

## 6. Auth & OAuth Flow

- Email registration & login issue an HttpOnly session cookie plus a CSRF cookie; the
  frontend axios client sends `X-CSRFToken` on mutations (`src/lib/api/client.ts`).
- Google/Gmail OAuth 2.0 via django-allauth: one click registers a new Gmail account,
  links an existing email account, or signs in an existing Google user. The SPA handles the
  redirect at `/auth/login?code=…` (`LoginPage` guards against React StrictMode duplicate
  invocations with `exchangedCodeRef`, presents an editorial "Signing in…" state with the Google
  brand icon and progress indicator adhering to the `taste` skill, and exchanges the code via
  `POST /api/auth/google/callback`).
- Auth mutations are rate-limited to 20/min (`auth_write` scope; 429 on the 21st request).
- Guests hitting an auth-only endpoint get 401 with `error.session_expired: true`
  (`SessionAuthenticationWith401`), which the SPA uses to reset the auth store.
- **Profile settings**: `PATCH /api/auth/profile` updates `display_name`/`phone`
  (partial, validated by `ProfileUpdateSerializer`) via `AuthService.update_profile`.
  `POST /api/auth/avatar` stores a profile picture — deliberately **without** the
  YOLO-World pet gate (it is the user's own photo, not a pet photo): Pillow-validated,
  ≤5 MB, EXIF-stripped, re-encoded as a ≤512px JPEG into private storage under
  `avatars/{user_id}/{uuid}.jpg`, old avatar object deleted best-effort
  (`AuthService.update_avatar`, `upload` throttle 10/min). `UserSerializer` exposes
  `avatar_path` plus a fresh signed `avatar_url` on every response, so the SPA always
  has a valid link to the private object. Under `PAWPRINT_TESTING=1` (DEBUG=0) the
  root urls serve filesystem `/media/` explicitly so e2e can load those URLs.

## 7. Flyers, QR & A4 Export

- `QrService` mints a QR code targeting the public flyer URL —
  `qr_target_value = {FRONTEND_BASE_URL}/flyers/{id}` (set on create and by `seed_demo`), so a
  printed QR lands a scanner directly on the guest-accessible flyer page. The SPA renders the
  same target as an SVG data-URL QR (`QrImage`) on the detail page and inside the A4 export.
- On create/update, `FlyerService` dispatches Celery task `generate_flyer_assets` (queue
  `flyers`): renders the HTML flyer template with WeasyPrint to A4 PDF + Playwright A4@300dpi
  PNG, uploads to private Cloudinary, marks the flyer `active`, then broadcasts `flyer.generated`
  over Django Channels (`ws/flyers/`).
- `PetCreateSerializer` accepts `photo_paths` (list, max 4; `photo_path` stays as the cover =
  first photo), and `PetService.create_pet` creates one `PetPhoto` row per photo. A report can
  therefore show the same pet from up to 4 angles on its flyer; the stored files are always
  the full, uncropped originals.
- Flyer templates (`templates/flyers/{emergency,outreach}.html`) and the on-screen
  `.print-sheet` follow the `taste` skill print typography (`@page { size: A4; margin: 0 }`,
  `.no-print` chrome hidden): emergency mode uses crimson/amber high-contrast scannability;
  outreach mode uses sage/teal/terracotta warmth. The detail page's Print button uses the
  same sheet.
- **Found mode**: `Flyer.Mode.FOUND` + `Pet.Status.FOUND` mirror the lost flow without a
  reward; the A4 emergency template is mode-aware (FOUND PET header, "Found at", description).
  Found pets are **unnamed** (`Pet.name` blank — the finder doesn't know the owner's pet; the
  builder hides the name/tags fields in found mode and the UI falls back to "Found pet").
  Flyers can carry a map pin (`location_lat`/`location_lng`, indexed via
  `flyer_status_location_idx`); `GET /api/flyers/map` (public) returns active lost/found
  flyers that have one — the pins behind `/map`. `seed_demo` seeds Bruno (lost, pinned) and
  Miso (found, pinned).

## 8. AI Pet Detection (YOLO-World gate + CLIP species naming + attributes)

- `PetDetectionService.validate_pet_image(image_bytes)` lazily loads one process-local,
  lock-protected `ultralytics.YOLOWorld(settings.YOLO_MODEL_PATH)` singleton
  (default `yolov8s-worldv2.pt`, cached after the first upload) and calls
  `model.set_classes(list(ANIMAL_CLASSES))` with 66 open-vocabulary animal labels.
- `ANIMAL_CATEGORY_BY_LABEL` groups the raw model labels into **Domestic Pet**
  (`dog`, `cat`), **Zoo / Exotic** (`lion`, `tiger`, `wolf`, `fox`, `bear`, `elephant`,
  `giraffe`, `zebra`, `kangaroo`, `koala`, `panda`, `monkey`, `deer`), **Reptile**
  (`crocodile`, `alligator`, `snake`, `lizard`, `gecko`, `iguana`, `chameleon`, `turtle`,
  `tortoise`), **Amphibian** (`frog`, `toad`), **Small Mammal** (`hamster`, `guinea pig`,
  `ferret`, `chinchilla`, `mouse`, `rat`, `hedgehog`, `sugar glider`, `rabbit`),
  **Farm Animal**, **Bird**, and **Fish**. Acceptance is label-based (not COCO class IDs),
  the confidence threshold defaults to `0.20` (`YOLO_CONFIDENCE_THRESHOLD`), and the threshold is
  passed into `model.predict(..., conf=settings.YOLO_CONFIDENCE_THRESHOLD)` — Ultralytics'
  own predictor default is `0.25`, which would otherwise discard `0.20–0.25` detections such
  as small pets before PawPrint sees them. Uploaded images are EXIF-orientation-normalized and
  converted to RGB before inference so rotated phone photos are detected as displayed.
- **Species naming (precise, three guards against lookalikes)**: YOLO-World alone can pass a
  clear animal under a nearby label (rabbit → `cat`, crocodile → `bird`, fox → `dog`, tabby cat
  → `tiger`/`hedgehog`). After the YOLO-World gate proves an animal is present, a second lazily
  loaded, lock-protected **CLIP ViT-B/32** zero-shot classifier (the same
  `/weights/clip/ViT-B-32.pt` encoder YOLO-World uses for prompts) names the species, with three
  precision guards (Phase 38):
  1. **Crop to the animal** — CLIP ranks the *in-memory padded crop* of YOLO-World's best
     accepted animal box (`padded_crop`, `SPECIES_CROP_PADDING` = 0.25 of the box per side,
     clamped to bounds, full image when no box), not the whole scene, so background clutter
     (concrete, leaves, walls) cannot tip it toward wild lookalikes. The crop never touches
     storage — the uploaded original is stored and displayed full and uncropped.
  2. **Contrastive prompts** — `SPECIES_PROMPT_OVERRIDES` give confusable labels explicit
     contrast descriptions ("a small domestic house cat … not a wild big cat" vs "a large wild
     tiger with orange fur and black stripes, much bigger than a house cat").
  3. **Confusable-group contrast pass** — when the top pick belongs to a `CONFUSABLE_GROUPS`
     lookalike set (feline: cat/tiger/lion, canine: dog/wolf/fox, spiny: hedgehog/porcupine, …)
     and a group rival is within `GROUP_RIVAL_MARGIN` (0.20) of it, a focused second CLIP pass
     over just that group (`GROUP_CONTRAST_PROMPTS`: "small pet tabby cat on concrete" vs
     "large wild tiger in the jungle") decides the single winner. Otherwise only labels within
     `CLIP_SPECIES_RELATIVE_MARGIN` (0.9) of the top CLIP probability stay selected, so a
     hedgehog at 0.16 no longer rides along with a cat at 0.40.
  The refined animal names go into `pet_classes`
  (`fox`, `crocodile`, `frog`, `rabbit`, `dog`, …), while the raw YOLO-World labels stay in
  `detected_classes` for the API/audit trail. If YOLO-World finds nothing at `0.20` but CLIP's
  animal-vs-non-animal gate is confident (e.g. a crocodile close-up), the photo still passes and
  is named by CLIP; plain landscapes still 422. When CLIP is unsure it falls back to the raw
  accepted YOLO labels. Verified on 18 real photos of one tabby cat: all classify as
  `['cat']` (raw labels like `bear`/`bird` stay in `detected_classes` only).
- **Breed & color classification**: a separate CLIP zero-shot `PetAttributeService`
  (`apps/vision/services.py`) runs on the gated photo — breed over curated lists (dog breeds
  and cat breeds only; any other species yields an empty breed, never a guess) and color over
  a fixed color list for every species. Raw confidences ship on the upload response as
  `breed`/`breed_confidence`/`color`/`color_confidence` (`PhotoUploadResponseSerializer`);
  the **0.80 prefill threshold is applied in the frontend** (`HIGH_CONFIDENCE` in
  `features/pets/api.ts`), so low-confidence results stay blank with a "Not detected"
  placeholder instead of guessing.
- The YOLO loader falls back to `yolov8s-worldv2.pt` if a stale non-World `YOLO_MODEL_PATH` is
  configured, and raises a clear `RuntimeError` if the checkpoint does not contain a World head.
  Generated weights (`backend/yolov8s-worldv2.pt`, `/weights/clip/ViT-B-32.pt`) are git-ignored;
  Ultralytics/CLIP load them on first lazy load. There is no other vision model and no
  Hugging Face download: the lost/found photo-matching feature (MegaDescriptor re-ID via timm)
  was removed in Phase 39.
- **Pass**: EXIF stripped via Pillow, thumbnail generated, upload to private Cloudinary
  (delivery type `private`), `PetDetectionLog(passed=True)`, signed preview URL returned.
- **Fail**: bytes discarded before any storage write, `PetDetectionLog(passed=False)`,
  `NoPetDetectedError` → HTTP 422 `{"error":{"code":"no_pet_detected","message":…,
  "detected_labels":[…]}}` so the user can retry instantly. Zero penalties.
- Frontend UX (`PhotoUpload`): a full-width, fixed-height drop rectangle supports click, keyboard,
  and drag-and-drop selection with a clear drag-active state — and **multiple files at once**
  (up to 4 photos, e.g. different angles of the same pet). Accepted photos upload sequentially
  behind the same overlay; a thumbnail strip appears under the cover frame with per-photo
  remove buttons and tap-to-make-cover, plus an "N photos" badge and a locked
  "Photo limit reached" state at the cap. During upload, the local pet preview
  stays visible behind an animated scan line and spinner; a live region reports **Uploading photo →
  Scanning photo → Detecting your pet → Saving securely**, with a four-step indicator and progress
  bar. Axios supplies the real byte-upload percentage; because `POST /api/pets/photos` is one
  synchronous request, the later labels follow its known processing pipeline rather than separate
  server telemetry. Backend processing switches the bar to an indeterminate animated state. Reduced
  motion disables the scan/spinner/progress animations without hiding status information.
- The 422 renders a friendly `no-pet-error` box ("No strikes, no bans — just pick another photo")
  and the picker stays open for an immediate retry; a passing photo shows a
  "Detected: `<animal>` ✓" badge using the refined `pet_classes`. In the builder the detected
  species is shown as **plain read-only text** — label "Species" with the hint "Auto detected:
  change photo to redetect", value e.g. "Dog" or "Cat, Dog" (refined `pet_classes`, falling
  back to raw `detected_classes`; ambiguous multi-species falls back to the first standard
  match for the stored value, non-standard animals map to `other`). Re-uploading a photo
  re-runs detection and updates the text automatically. Breed and color are prefilled only at
  confidence ≥ 0.80; below that they stay blank — the fields carry **only the "Not detected"
  placeholder, no confidence badges** — plus the helper tip "Auto-detected —
  change if not correct. Detection is not 100% accurate." — both fields always stay editable.
- E2E journey ④ drives both photos through the real models: `e2e/fixtures/dog.jpg`
  passes as refined `dog` (raw `cat` @ 0.717 + `dog` @ 0.655 stay in `detected_classes`),
  while `landscape.jpg` → 422.

## 9. Payments — Rewards (Stripe Test + GCash / QR Ph)

- `PaymentDriver` protocol with `StripeDriver` (SDK, test mode) and `PayMongoDriver`
  (httpx Basic auth; GCash Checkout + QR Ph Payment Intent).
- `RewardService` creates `RewardTransaction(status='pending')` atomically with
  `select_for_update`, then delegates to the driver.
- Webhooks (`/api/webhooks/stripe`, `/api/webhooks/paymongo`) are CSRF-exempt, signature-
  verified (Stripe `Stripe-Signature`; PayMongo HMAC-SHA256 of `{t}.{payload}` in
  `Paymongo-Signature: t=…,te=…`), deduplicated via `WebhookEvent(provider, event_id)`, and
  acknowledged with 200 in <50 ms while `process_reward_webhook` runs on the `webhooks`
  Celery queue with `select_for_update`.
- Frontend UX: `RewardCheckoutModal` (amount + provider) → Stripe redirects off-site, or
  GCash shows the QR payload in `GcashQrModal` and polls `GET /api/rewards/{id}/status` every
  2 s until terminal, showing "Payment received — thank you!" on `succeeded`.
  `POST /api/webhooks/paymongo` is exercised end-to-end in E2E journey ⑤ against a local stub
  (valid signature → 200 + `succeeded`; forged signature → 400).

## 10. Frontend (React 19 + TS) Guide

- Centralized axios client at `src/lib/api/client.ts` (`baseURL: '/api'`, credentials, CSRF
  headers, `ApiError` normalization incl. `no_pet_detected` labels, 401/`session_expired`
  handling). All calls via `src/features/{domain}/api.ts`; DTOs come only from the generated
  `src/lib/api/schema.d.ts` (`npm run typegen` over `backend/schema.yml`).
- Pages: `/` Home (emergency + outreach rails), `/flyers` Gallery (mode filter — Lost /
  **Found** / Adoptable — + FTS search + cursor pagination), `/map` **Pet map** (public:
  Leaflet/OpenStreetMap map with one circular photo pin per active lost/found flyer — crimson
  ring = lost, terracotta = found — popup card with name, species·breed·color, date, status and
  a "Show Full Details" link to `/flyers/:id`; if the map cannot be created it renders the
  same pins as a list), `/flyers/:id` Public Flyer + QR + print/export + owner resolve/delete + reward
  checkout (found flyers read "Found pet: X" / "Found at" / "Description" in terracotta, with a
  "View on map" link when pinned), `/builder` 3-step wizard with **three modes** — Lost —
  urgent / **Found pet** / Adoptable (`?mode=found`) — (photo gate → pet form → details;
  the photo step stays open until **Next** so up to 4 angle photos can be added, and going
  back with uploaded photos shows **Next** to continue without re-uploading; the pet is
  created with `photo_path` = cover + `photo_paths` = all angles). Found mode hides
  **Pet name**, **Age** and **Personality tags** and sends `age: null`. `/my-flyers`,
  `/rewards/success`, `/rewards/cancel`, `/auth/login`
  (also handles the Google `?code=` callback), `/auth/register`, `/settings` (profile
  settings: avatar upload with local preview + `PATCH /api/auth/profile` for display
  name/phone, read-only email). The header nav links Flyers, **Pet map**, the avatar + display
  name to `/settings` (`components/Avatar.tsx` renders the round picture with an
  initial-letter fallback).
- Builder step 3 uses `LocationPicker` (`components/maps/LocationPicker.tsx`): an embedded
  Leaflet (OpenStreetMap) map with a **draggable pin** plus Nominatim address suggestions on
  the text input; dropping the pin reverse-geocodes the address and the form stores
  `last_seen_location` + `location_lat`/`location_lng`. If the map cannot be created (jsdom
  unit tests) it degrades to a plain address input under the same id (`flyer-loc` /
  `flyer-loc-found`) with null coordinates. Maps plumbing lives in `src/lib/maps.ts` —
  `leaflet` npm dependency (+ `@types/leaflet`, `leaflet/dist/leaflet.css`), OSM tile-layer
  `createMap`, Nominatim `searchAddress`/`reverseGeocode`, circular photo `divIcon` pins
  (`petPinIcon`) and the draggable teardrop (`createDropMarker`) — no API key. Found mode
  shows Location found / Date & time found / Description and hides the reward toggle entirely.
  Auth forms use icon inputs
  (`IconInput` in `components/ui/field.tsx`): a Mail icon on email fields, a Lock icon
  plus an Eye/EyeOff **show/hide password toggle** (a real button with an accessible name
  and `aria-pressed`) on password fields via `PasswordInput`, a User icon on the
  display-name field, and the official multicolor Google "G" brand mark on the
  `GoogleButton` sign-in button.
- React 19 idioms: `useActionState` forms (dispatch wrapped in `startTransition` so `pending`
  works), `useOptimistic` publishing card on flyer create, ref-as-prop, React Compiler in
  `vite.config.ts` (disabled under Vitest so coverage maps to source). TanStack Query
  `queryOptions` factories; reward status polls every 2 s while `pending`. Zod + RHF forms.
  QR codes rendered as SVG data-URLs via the `qrcode` package (`src/components/QrImage.tsx`).
  `@media print` A4-exact stylesheet (`@page { size: A4 }`, `.print-sheet`, `.no-print`) +
  Print button.
- Dev proxy: Vite proxies `/api`, `/media`, `/ws` to the backend; the origin is env-driven
  (`PAWPRINT_API_URL`, default `http://127.0.0.1:8000`) so Playwright E2E can run the API on
  another port.
- Visual system per the `taste` skill: one type scale, one card recipe, equal edges,
  tactile hover/press, skeleton/empty/error states, dual palette (emergency crimson/amber vs
  outreach sage/teal/terracotta). The photo uploader uses a fixed 380px desktop rectangle (360px
  on phones), neutral/sage drop affordances, an animated processing overlay, accessible live status
  and progress semantics, and reduced-motion fallbacks.

## 11. Testing & Coverage

- Backend: `cd backend && .venv/bin/python -m pytest tests/ -q --cov=apps --cov-fail-under=80`
  → **168 passed, 94.99% total** (100% on all `services.py`, `drivers.py`,
  `apps/vision/services.py`, and the Cloudinary storage driver);
  `django_assert_max_num_queries` ceilings on list/detail endpoints (map endpoint at 6);
  429 tests for the
  `auth_write` (20/min) and `upload` (10/min) throttles; webhook idempotency tests (duplicate
  `(provider, event_id)` → single processing); 422-before-storage tests (non-animal bytes never
  reach Cloudinary); expanded YOLO-World + CLIP species tests (66 labels,
  `conf=0.20` asserted on the predictor call, EXIF-orientation/RGB normalization, stale-path
  fallback, non-World checkpoint rejection, rabbit/fox/frog/crocodile renaming from wrong raw
  labels, CLIP animal-gate fallback for YOLO misses, CLIP singleton/loader paths, ambiguous
  multi-species handling, `best_box` selection of the highest-confidence accepted animal,
  padded-crop padding/clamping/full-image fallback, the confusable-group contrast pass
  resolving tabby-cat-vs-tiger to `cat`, the 0.9 relative selection margin dropping distant
  lookalikes, and the contrast pass not firing without a close rival);
  CLIP breed/color classifier tests (`PetAttributeService`: dog/cat
  breed lists, other-species empty breed, color always classified, raw confidences on the
  upload response); found-mode + `location_lat`/`location_lng` + `GET /api/flyers/map`
  integration tests; `photo_paths` on `POST /api/pets` + PetPhoto rows (4-photo cap);
  Cloudinary
  driver unit tests (SDK mocked, 100% on the driver);
  profile/avatar tests (PATCH partial + validation, avatar 400s for missing/non-image/oversize
  file, EXIF-stripped ≤512px JPEG stored privately, old object deleted best-effort, signed
  `avatar_url`, signing-failure fallback); `responses`/MockTransport for Stripe/PayMongo HTTP;
  `factory-boy` factories.
- Frontend: `npm run test:run` → **131 Vitest tests, 11 files** (RTL + MSW, jsdom), including
  drag-and-drop, multi-file photo picking (sequential uploads, thumbnail strip, remove /
  make-cover, 4-photo cap + "Photo limit reached" lock), real Axios upload-progress callbacks,
  all four live processing labels, the animated
  indeterminate bar, read-only detected-species text (rabbit over raw `cat`, ambiguous cat+dog,
  re-detect on re-upload), breed/color prefill at ≥0.80 with only the "Not detected" placeholder
  below threshold (no confidence badges anywhere), the wizard staying on the photo step until
  **Next** and posting `photo_paths`, the found-pet wizard flow (`?mode=found`, no pet-name/age
  fields, `age: null` + `photo_paths` in the create payload, no
  reward toggle, location/date/description, `location_lat/lng: null` from the fallback input),
  the gallery Found filter, found rendering on detail/cards, per-mode resolve labels,
  `LocationPicker` map mode (fake `leaflet` via `src/test/fake-leaflet.ts`: pin drop + drag
  reverse-geocode through MSW-mocked Nominatim, address-suggestion dropdown) and its
  map-init-failure fallback, the `/map` page (Leaflet photo pins + popup, pin-list fallback,
  empty/error states), and `src/lib/maps.ts` helper tests (OSM tile layer, pin icons,
  Nominatim search/reverse incl. failure fallback);
  `npm run test:coverage` → **88.89% stmts / 81.31% branches / 83.67% funcs / 90.39% lines**
  (thresholds 70/60/70/70) with **`src/features/rewards/**` at 100%** (per-glob threshold).
  `npx tsc -b --noEmit` clean; `npm run build` green.
- E2E: `npm run test:e2e` (Playwright, `frontend/playwright.config.ts`) → **10 journeys /
  11 tests, all green**, fully self-contained: a stub PayMongo API (`e2e/stub-paymongo.mjs` on
  :9100), the Django backend on :8010 with `PAWPRINT_TESTING=1` (eager Celery, locmem, local
  PG :5433; filesystem `/media/` is served explicitly under TESTING so signed URLs load),
  and the Vite dev server on :5173 proxying to :8010. Journeys: ① guest browse →
  filter → search → detail+QR, ② register → logout → login (demo account), ③ create an
  emergency flyer through the 3-step wizard (YOLO-World-gated upload → preview → **Next** →
  read-only detected species) → public detail page, ④ landscape photo → 422 `no_pet_detected`
  retry UX → dog photo passes → preview → **Next**, ⑤ GCash reward checkout → QR modal →
  HMAC-signed PayMongo webhook flips
  status to `succeeded` (and a forged signature is 400), ⑥ open the flyer's
  `qr_target_value` like a scanner → public detail page with SVG QR, ⑦ profile settings →
  avatar upload + display name/phone save → header avatar, profile restored afterwards,
  ⑧ guest pet map (Leaflet/OSM map — `/api/flyers/map` pins seeded Bruno lost + Miso found
  with coords; tap Bruno's photo pin → popup card → open his flyer → "View on map" link
  back), ⑧b same-spot stacking (a second flyer pinned at Bruno's exact coords stacks into a
  ×N card deck — newest on top with the green/red ring, oldest peeking behind — and tapping
  the stack opens a popup listing every stacked flyer; the test cleans up after itself),
  ⑨ found-pet flow
  (`/builder?mode=found` → photo gate → **Next** → no pet-name/age/tags fields → publish →
  unnamed "Found pet" detail, mode `found`, no reward; guests get the register prompt).
- Static analysis: `mypy apps`, `ruff check .`, `npm run lint` (tsc), `npm run build`
  (0 TS errors). All of the above run in GitHub Actions (`.github/workflows/ci.yml`):
  `backend-lint` (ruff + mypy, no DB), `backend-test` (pytest + coverage against a
  `postgres:16` service container, coverage artifacts uploaded), `frontend-test`
  (`npm ci` + tsc + vitest coverage thresholds + build), and `e2e` (Playwright with a
  `postgres:16` service on :5433, migrate + seed_demo, cached YOLO-World weights,
  Playwright report artifact). Runs on push/PR to `main` + manual dispatch.
- Performance spot-check (Phase 7, local PG :5433): `EXPLAIN ANALYZE` on the public gallery
  query shows an index scan on `flyer_status_created_idx` + PK lookups for pet/owner/creator —
  **0.21 ms execution, 14 shared buffer hits** at seed scale; FTS uses the
  `pet_search_vector_gin` GIN index (planner seq-scans the 2-row seed table, switches to the
  bitmap index at scale); the reward webhook path holds `select_for_update` inside a short
  transaction and dedupes on the unique `(provider, event_id)`.

## 12. Tutorial (Living Build Log)

- **Phase 0** — Repo initialized. `pawprint` skill created at `.opencode/skills/pawprint/SKILL.md`;
  `AGENTS.md` points to it and the `taste` skill (`.agents/skills/design-taste-frontend`).
  `docs/DOCUMENTATION.md` (these 12 sections) + root `package.json` with
  `docs:pdf` (md-to-pdf) → `docs/documentation.pdf` generated and committed.
- **Phase 1** — Backend foundation in `backend/`: `pyproject.toml` (Django 5.2 LTS, DRF,
  drf-spectacular, psycopg, redis, celery, channels(+redis), django-allauth[socialaccount],
  django-cors-headers, cloudinary, Pillow, qrcode, stripe, httpx, ultralytics,
  weasyprint + pytest/factory-boy/responses/ruff/mypy dev deps). `django.contrib.admin`
  fully removed. `docker-compose.yml` (postgres:16, redis:7, mailpit, celery, web) +
  `.env.example`. Models with constraints/indexes: `users.User` (UUID PK, email login,
  google_id, stripe_customer_id), `pets.Pet` (SearchVector GIN, JSON GIN, composite
  `(status, created_at)`), `flyers.Flyer` (CheckConstraint reward>0, `(mode,status,created_at)`,
  `(creator,mode)`), `rewards.RewardTransaction` (unique provider_reference, select_for_update
  in service), `webhooks.WebhookEvent` (unique `(provider, event_id)`), `vision.PetDetectionLog`.
  factory-boy factories + `seed_demo` command. Tests: `test_health.py` (incl. admin-absent
  assertion, 0-query health) + `test_factories.py`. Local PG on :5433 used for tests;
  pytest switches to locmem cache / in-memory channels / eager Celery / filesystem storage.
- **Phase 2** — Auth: `POST /api/auth/register|login|logout`, `GET /api/auth/me` (401 +
  `session_expired` for guests via custom `SessionAuthenticationWith401`),
  `GET|POST /api/auth/google/url|callback` — Google/Gmail OAuth 2.0 via django-allauth
  SocialAccount with one-click Gmail registration, email-account linking, and existing
  sign-in. `auth_write` scope throttle 20/min (verified 429 on the 21st request).
  14 auth integration tests.
- **Phase 3** — Flyer core: cursor-paginated public `GET /api/flyers` (Guest allowed,
  `select_related('pet','creator')` + `only()`, SearchVector FTS `?q=`, `?mode=` filter,
  `django_assert_max_num_queries` ceilings), public `GET /api/flyers/{id}` (QR landing),
  creator-only `POST /api/flyers/new`, `PATCH/DELETE /api/flyers/{id}/edit`
  (`IsOwnerOrReadOnly`), `GET /api/flyers/mine`. `FlyerService` dispatches Celery
  `generate_flyer_assets` (queue `flyers`) → WeasyPrint A4 PDF + Playwright A4@300dpi PNG →
  private cloud storage → `flyer.generated` broadcast over Channels (`ws/flyers/`). A4
  templates `templates/flyers/{emergency,outreach}.html` with dual palettes.
- **Phase 3.5** — YOLOv8 gatekeeper: `PetDetectionService` singleton `YOLO("yolov8n.pt")`,
  COCO pet classes {14,15,16,17,18,19} @ conf ≥ 0.45 (configurable). Pass → EXIF stripped
  (Pillow) → private cloud storage → thumbnail task (queue `images`) → signed URL + detected
  labels. Fail → bytes discarded before any storage write, `PetDetectionLog(passed=False)`, HTTP 422
  `no_pet_detected` with detected labels; zero strikes/bans. `POST /api/pets/photos`
  (auth, `upload` throttle 10/min — 429 on 11th). ultralytics 8.4.215 + torch 2.15 CPU
  installed in the venv.
- **Phase 4** — Rewards: `PaymentDriver` protocol + `StripeDriver` (Checkout Session, test
  mode) + `PayMongoDriver` (httpx Basic auth; GCash checkout session + QR Ph payment intent;
  injectable client for MockTransport tests). `RewardService.create_reward` creates a
  pending `RewardTransaction` atomically then delegates to the driver.
  `POST /api/rewards`, `GET /api/rewards/{id}/status` (payer/creator only),
  `GET /api/rewards/mine`. Webhooks `POST /api/webhooks/stripe|paymongo` — CSRF-exempt,
  signature-verified (Stripe `Stripe-Signature`, PayMongo HMAC-SHA256 `te=`),
  deduped via `WebhookEvent(provider, event_id)`, 200 in <50 ms, processing on the
  `webhooks` queue with `select_for_update`.

- **Phase 5** — Frontend app in `frontend/` (React 19 + TS + Vite + Router v7 + TanStack Query
  v5 + Axios + Zustand + RHF/Zod + Tailwind v4, React Compiler on for app builds): pages Home,
  Gallery (mode filter + FTS + cursor), Flyer detail (SVG QR, print/PDF/PNG, owner
  resolve/delete double-click, reward modal), 3-step Builder wizard
  (`useActionState` + `useOptimistic` publishing card), My flyers, Login (incl. Google
  `?code=` callback), Register, Reward success/cancel. Features: `auth`, `pets`
  (`PhotoUpload` 422-retry UX), `flyers`, `rewards` (`RewardCheckoutModal` + `GcashQrModal`
  with 2 s status polling). DTOs generated via `openapi-typescript` →
  `src/lib/api/schema.d.ts`; `@/` alias; `@media print` A4 sheet + `.no-print` chrome.
  Backend contract tweaks: `@extend_schema` on reward status endpoints so `RewardStatus` is in
  the generated schema; `seed_demo` now writes real `qr_target_value`s; `PAWPRINT_TESTING=1`
  env switch in `config/settings.py`.
- **Phase 6** — Tests. Backend re-verified: **79 passed, 94.0%** (100% services/drivers/
  vision), ruff + mypy clean. Frontend: 6 Vitest files / **65 tests** (MSW handlers in
  `src/test/`), coverage **88.5% stmts / 81.0% br / 85.4% fn / 89.2% lines** with
  **`features/rewards` at 100%** (per-glob threshold in `vite.config.ts`); `tsc -b` clean;
  `npm run build` green. Playwright E2E (`playwright.config.ts`, `npm run test:e2e`): 6
  journeys / 7 tests green, self-contained — stub PayMongo on :9100
  (`e2e/stub-paymongo.mjs`), backend on :8010 with `PAWPRINT_TESTING=1` (eager Celery, locmem,
  PG :5433), Vite on :5173 proxying `/api`+`/media` (`PAWPRINT_API_URL`). Fixtures verified
  against real YOLOv8n (`e2e/fixtures/dog.jpg` → dog @0.81, `landscape.jpg` → 422). Vite proxy
  origin is env-driven; vitest excludes `e2e/**`.
- **Phase 7** — Hardening verification + docs. `EXPLAIN ANALYZE` on the public gallery: index
  scan on `flyer_status_created_idx`, PK joins, **0.21 ms / 14 buffer hits** at seed scale; FTS
  GIN index `pet_search_vector_gin`; reward webhook path = short transaction +
  `select_for_update` + unique `(provider, event_id)` dedupe. Confirmed by tests: throttles
  429 (auth 20/min, upload 10/min), webhook idempotency, 422-before-storage (non-pet bytes
  never stored), print CSS (`@page A4`, `.print-sheet`, `.no-print`), 401 `session_expired`
  flag. Docs updated (all 12 sections) + `docs/documentation.pdf` regenerated.
- **Phase 8** — Storage migration: MinIO/S3 → **Cloudinary**. `docker-compose.yml` drops the
  `minio`/`minio-setup` services and volume; `django-storages[s3]` + `boto3` replaced by the
  `cloudinary` SDK. New Django `Storage` backend `apps/common/cloudinary_storage.py`
  (`CloudinaryStorage`): uploads with delivery `type="private"`, `overwrite=True`; reads and
  URLs are HMAC-signed (`cloudinary_url(..., sign_url=True, expires_at=…)`); pdf/png/jpg map to
  resource_type `image`. Config via `CLOUDINARY_URL` (or discrete `CLOUDINARY_CLOUD_NAME` /
  `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET`) in `.env`; `PAWPRINT_TESTING=1` still uses
  filesystem storage. 11 new driver unit tests (SDK mocked) → driver at **100%**; suite:
  **90 passed @ 94.2%**, ruff + mypy clean. (The "p variable is not set" compose warnings were
  an unquoted `$` in `DJANGO_SECRET_KEY` inside `.env`, fixed by regenerating the key as hex.)
- **Phase 9** — `manage.py` hardening: (1) added `django.contrib.postgres` to
  `INSTALLED_APPS` — `pets.Pet` uses `SearchVectorField`/`GinIndex`, and without the app every
  `manage.py` command aborted with `postgres.E005` (pytest never caught it because
  pytest-django skips system checks); (2) settings now `load_dotenv(root .env)`
  (python-dotenv), so host-side `cd backend && python manage.py migrate` just works —
  compose containers are unaffected (real env vars win; web/celery also pin
  `POSTGRES_HOST=postgres`/`PORT=5432` via a compose `environment:` anchor, so a
  host-oriented `.env` can't break them); (3) Playwright backend server env pins
  `postgres`/`postgres` @ `127.0.0.1:5433` + `whsec_dev` webhook secrets so E2E stays
  self-contained. Verified: `manage.py check` → 0 errors (only the intentional urls.W002
  warnings), `migrate` + `seed_demo` exit 0, **90 pytest passed @ 94.2%**, ruff + mypy
  clean, **Playwright 7/7 green**.
- **Phase 10** — Host-side run fixes. With dotenv loading the root `.env`, host-side
  `python manage.py runserver` must point at **host-published** services: `.env` /
  `.env.example` now use `REDIS_URL=redis://127.0.0.1:6379/0` and `EMAIL_HOST=127.0.0.1`
  (compose's `redis`/`mailpit` hostnames don't resolve on the host); the compose
  `x-app-environment` anchor pins `redis:6379` / `mailpit:1025` inside web/celery so one
  `.env` serves both worlds. Verified host-side (no `PAWPRINT_TESTING`): `/api/health` →
  ok, demo login + `/api/auth/me` → 200 (throttle cache on Redis works). Google OAuth
  `redirect_uri_mismatch` is console config, not code: the frontend sends
  `redirect_uri = <origin>/auth/login`, so register exactly `http://localhost:5173/auth/login`
  (and the `127.0.0.1` variant) as an Authorized redirect URI of the OAuth client in
  Google Cloud Console. Health route is `/api/health` (bare `/health` is a 404).
- **Phase 11** — Upload hardening (no offline fallback; Cloudinary only): (1) Cloudinary
  SDK ≥1.47 `cloudinary_url()` returns a `(url, options)` tuple — the storage driver now
  unpacks it (it was returning a stringified tuple in API responses; fixed + regression
  tested with both return shapes, driver still 100%); (2) storage failures (e.g. wrong
  `CLOUDINARY_URL`) now return a JSON **502 `storage_unavailable`** envelope instead of an
  HTML 500 page (`apps/common/exceptions.py`); (3) the 422 `no_pet_detected` message is
  exactly "No pet detected in the photo. Please upload a clear photo of your pet." (asserted
  verbatim in backend tests, and the frontend asserts it renders exactly once); (4) the
  axios client never shows raw "Request failed with status code 500" anymore — non-JSON
  errors fall back to "Something went wrong. Please try again.". Verified live against real
  Cloudinary creds: pet photo → 201 signed URL; non-pet → 422 single message; celery
  thumbnail task → succeeded. Suite: **93 pytest passed @ 94.3%**, 66 vitest, Playwright
  7/7, ruff + mypy + tsc clean.

- **Phase 12** — A4 flyer print redesign (single page, unique per pet): both
  `templates/flyers/emergency.html` (lost pet) and `templates/flyers/outreach.html`
  (adoption) rebuilt for print fidelity: full-bleed A4 (210×297mm, zero margin),
  equal 15mm side edges, bold header band, large pet photo leading (no image
  captions), oversized pet name, detail cards, QR code + contact footer, bottom
  strip. Each flyer gets a deterministic design variant (1–4 derived from the flyer
  UUID) so every print looks unique — a different colored corner accent badge and a
  unique seal number — while keeping the same clear information hierarchy.
  `config/settings.py` / `apps/flyers/tasks.py` pass `design_variant` to the template
  context. Verified live: both modes render exactly **1 page at A4** via WeasyPrint.
- **Public visibility on create**: newly created flyers are now `ACTIVE` immediately
  (`apps/flyers/services.py`), so they appear in the lost/adoption public gallery
  right away instead of being hidden while assets generate. QR target is set after
  the flyer id exists. Assets (PDF/PNG) still generate in the background via Celery.
- **Frontend flyer-build UX**:
  - QR code renders beside the pet photo on the flyer detail card; a "Show QR code"
    / "Hide QR code" button toggles it when there is no space (`FlyerDetailPage.tsx`).
  - Photo detection auto-selects and disables the species field (dog/cat/bird/horse
    → other) from the YOLOv8 detected classes; confidence threshold raised to 0.60
    for efficiency (`PetUpload` / `StepPet`).
  - Back button on steps 2 and 3 of the flyer builder wizard (`BuilderWizard.tsx`).
- **Cache**: Redis removed as a cache backend — `CACHES` uses in-memory `LocMemCache`
  only (`settings.py`); `FallbackCache` removed. Channels/Celery brokers unchanged.
  Suite: **97 pytest passed @ 94.0%**, 66 vitest, Playwright 7/7, ruff + mypy + tsc
  clean.
- **Phase 13** — Photo-upload interaction redesign: replaced the small 360px-max placeholder with a
  full-width fixed rectangle (380px, 360px on phones), editorial empty-state typography, a tactile
  sage drag/hover treatment, and a keyboard-operable click target. Uploading now keeps the selected
  pet visible beneath a scan-line animation, spinner, four-step status tracker, and accessible live
  text. Axios `onUploadProgress` drives the exact upload percentage; scan/detect/save labels then
  follow the synchronous backend pipeline with an indeterminate progress bar. Reduced-motion users
  retain static status and progress. Added tests for drag/drop and the complete progress-stage
  sequence. Verified at desktop and phone browser sizes; **68 Vitest tests**, coverage
  **87.96/81.22/84.07/89.1**, `tsc -b` + `vite build`, and **7/7 Playwright journeys** green.

- **Phase 14** — Detection migration: COCO YOLOv8 → Ultralytics **YOLO-World**
  (`yolov8s-worldv2.pt`). `PetDetectionService` now lazily loads one lock-protected process
  singleton, calls `set_classes()` with 64 animal labels, accepts labels through
  `ANIMAL_CATEGORY_BY_LABEL` (Domestic Pet / Zoo-Exotic / Reptile / Small Mammal / Farm Animal /
  Bird / Fish), preserves raw labels in the API, and defaults `YOLO_CONFIDENCE_THRESHOLD` to
  `0.20`. A stale non-World `YOLO_MODEL_PATH` falls back to the required World checkpoint, and a
  checkpoint without a World head fails with a clear loader error instead of the raw
  `DetectionModel.set_classes` `AttributeError`. Generated weights are ignored. The builder now
  leaves ambiguous multi-species detections editable instead of auto-selecting the first label
  (covered by a new wizard test).
  Real inference: `dog.jpg` → `cat` @ 0.717 + `dog` @ 0.655; `landscape.jpg` → 422. Verified:
  **107 pytest passed @ 94.42%** (`apps/vision/services.py` 100%), **69 Vitest** @
  87.91/81.29/84.21/88.95, **7/7 Playwright**, ruff + mypy + `tsc -b` + `vite build` clean.
- **Phase 15** — Rabbit / low-confidence hardening: the configured `0.20` threshold is now passed
  straight into `YOLO-World.predict(conf=...)` instead of being applied only after inference
  (Ultralytics defaults the predictor to `conf=0.25`, silently dropping `0.20–0.25` detections).
  Uploads are also EXIF-orientation-normalized and converted to RGB before prediction, so rotated
  phone photos are analyzed as displayed. Added regression tests asserting the predictor receives
  `conf=0.20` and that an orientation-6 RGBA upload is transposed to RGB. E2E guest/reward specs
  now locate the seeded Bruno flyer via `q=Bruno` so accumulated local flyers cannot reorder the
  home rail/pagination. Verified: **109 pytest passed @ 94.43%** (`apps/vision/services.py`
  100%), **69 Vitest** @ 87.91/81.29/84.21/88.95, **7/7 Playwright**, ruff + mypy + `tsc -b` +
  `vite build` clean.
- **Phase 16** — Species identity fix: YOLO-World still gates at `conf=0.20`, but a lazily
  loaded lock-protected **CLIP ViT-B/32** second stage now names the actual animal from
  fine-grained prompts (`frog`/`toad` added as **Amphibian**; rabbit/fox/crocodile/dog prompts
  disambiguated). Refined names land in `pet_classes`; raw YOLO labels stay in
  `detected_classes`. If YOLO-World misses at 0.20, a CLIP animal-vs-non-animal gate can still
  pass clear animal photos (crocodile close-up) while landscapes remain 422. Frontend prefers
  refined `pet_classes`, shows `Detected: <animal> ✓`, and the builder states the exact detected
  animal (e.g. Rabbit) even when the standard species enum is `other`. Real-image checks:
  fox → `fox` (raw `dog`), frog → `frog` (raw `bird`), cottontail rabbits → `rabbit` (raw
  `cat`), dog fixture → `dog` (raw `cat`+`dog`), crocodile → `crocodile`/alligator close pair
  (raw often `bird`), landscape → 422. Verified: **121 pytest passed @ 94.77%**
  (`apps/vision/services.py` 100%), **70 Vitest** @ 88.12/81.31/84.21/89.18, **7/7 Playwright**,
  ruff + mypy + `tsc -b` + `vite build` clean.

- **Phase 17** — Builder photo-step fix: going back from step 2 to the photo step with an
  already-uploaded photo now shows a **Next** button, so continuing never requires
  re-uploading (`BuilderWizard.tsx` `StepPhotoMode` + `onNext`). Regression test walks
  upload → back → Next. Verified: **71 Vitest** tests green, `tsc -b` clean.
- **Phase 18** — Auth form icons: the Google sign-in button now carries the official
  multicolor "G" brand mark; email fields get a Mail icon, display name a User icon, and
  password fields a Lock icon plus an Eye/EyeOff show/hide toggle (accessible button with
  `aria-label` + `aria-pressed`) on both `/auth/login` and `/auth/register`
  (`IconInput` in `components/ui/field.tsx`, `PasswordInput.tsx`, `GoogleButton.tsx`).
  Verified: **74 Vitest** tests green, `tsc -b` clean.
- **Phase 19** — Profile settings page (`/settings`): backend `PATCH /api/auth/profile`
  (display_name/phone, `ProfileUpdateSerializer` + `AuthService.update_profile`) and
  `POST /api/auth/avatar` — a profile-picture pipeline deliberately **without** the
  YOLO-World pet gate (it is the user's own photo): Pillow-validated, ≤5 MB,
  EXIF-stripped, re-encoded as a ≤512px JPEG into private storage
  (`avatars/{user_id}/{uuid}.jpg`), old avatar deleted best-effort, `upload` throttle
  10/min (`AvatarUploadView` + `AuthService.update_avatar`).
  `UserSerializer` now also returns a fresh signed `avatar_url` (empty string on failure);
  schema.yml regenerated + `npm run typegen`. Frontend: `SettingsPage` (avatar card with
  local preview + account form with read-only email), `Avatar` component (round picture,
  initial-letter fallback), header nav link with avatar + name, `authApi.updateProfile` /
  `uploadAvatar`, MSW handlers. Under `PAWPRINT_TESTING=1` the root urls serve filesystem
  `/media/` explicitly so e2e loads signed URLs (prod uses Cloudinary). E2E journey ⑦
  covers avatar upload + profile save and restores the seeded demo profile afterwards.
  Verified: **136 pytest passed @ 95.03%** (`apps/users` services/serializers 100%),
  **80 Vitest** @ 88.41/80.83/84.76/89.38, **8/8 Playwright** (7 journeys), ruff + mypy +
  `tsc -b` + `vite build` clean.

- **Phase 20** — GitHub Actions CI (`.github/workflows/ci.yml`), triggered on push/PR to
  `main` + `workflow_dispatch`, with `cancel-in-progress` concurrency. Four jobs:
  **backend-lint** — `astral-sh/setup-uv` (Python 3.12, cache enabled) → `uv venv` +
  `uv pip install '.[dev]'` → `ruff check .` + `mypy apps` (no DB needed).
  **backend-test** — `postgres:16` service on :5432 (health-checked) → same uv install →
  `pytest --cov-fail-under=80 --cov-report=xml` (addopts already include `-n auto
  --cov=apps --cov-report=term-missing`) with `POSTGRES_*` env pointing at the service;
  coverage XML + HTML uploaded as artifact. **frontend-test** — `setup-node` 24 with npm
  cache → `npm ci` → `npm run lint` (tsc) → `npm run test:coverage` (enforces 70% global
  + 100% `features/rewards` thresholds from `vite.config.ts`) → `npm run build`;
  coverage HTML uploaded. **e2e** — `postgres:16` service on :5433 (matching
  `playwright.config.ts`) → pango system libs for WeasyPrint → backend uv venv at
  `backend/.venv` (required by the Playwright webServer `cwd: ../backend`) → `npm ci` →
  `npx playwright install --with-deps chromium` → cached YOLO-World weights
  (`actions/cache` keyed on `pyproject.toml` hash) → `manage.py migrate` + `seed_demo`
  with `PAWPRINT_TESTING=1` → `npm run test:e2e` (Playwright self-starts the Django
  backend on :8010, PayMongo stub on :9100, and Vite on :5173) → report artifacts.
  Docs §2/§11 updated.

- **Phase 21** — CI fix: `uv pip install '.[dev]'` in GitHub Actions failed with
  "Multiple top-level packages discovered in a flat-layout: ['apps', 'config', 'templates']"
  because a full checkout has source dirs present (the Dockerfile avoided this by installing
  deps before `COPY . .`). Fixed by adding an explicit `[build-system]` (setuptools ≥68) and
  `[tool.setuptools.packages.find] include = ["apps*", "config*"]` to
  `backend/pyproject.toml`. Verified locally: fresh venv + `uv pip install --no-deps .`
  builds the wheel cleanly, the installed `apps`/`config` don't shadow the source tree
  (cwd/`pythonpath=["."]` wins), and `pytest tests/integration/test_health.py` → 3 passed.
  CI workflow commands unchanged.

- **Phase 22** — CLIP breed/color classifier: new `PetAttributeService` in
  `apps/vision/services.py` (zero-shot over curated dog/cat breed lists — other species get an
  empty breed — and a fixed color list for every species), wired into
  `PetPhotoService.upload`; `AttributeDetection` DTO; `PhotoUploadResponseSerializer` +
  `UploadedPhoto` now carry `breed`/`breed_confidence`/`color`/`color_confidence` (raw
  confidences — the 0.80 prefill threshold lives in the frontend). Unit tests in
  `backend/tests/unit/test_attributes.py`. Verified: **150 pytest passed @ 95.41%**
  (`apps/vision/services.py` 100%).
- **Phase 23** — Found mode + geo pins (backend): `Flyer.Mode.FOUND`, `Pet.Status.FOUND`
  (migrations `pets/0003`, `flyers/0003`), `location_lat`/`location_lng` FloatFields +
  `flyer_status_location_idx`, public unpaginated `GET /api/flyers/map`
  (`list_map_flyers`: active emergency/found with coords), mode-aware A4 template (FOUND PET /
  Found at / Description), `seed_demo` pins Bruno and adds found pet "Miso", schema.yml
  regenerated + `npm run typegen`. Integration tests `test_flyer_map.py`. Suite green @
  95.41%.
- **Phase 24** — Builder detection UX: species is now **plain read-only text**
  (`#pet-species` paragraph, hint "Auto detected: change photo to redetect"; ambiguous
  multi-species → first standard match, non-standard → `other`); breed/color prefill only at
  confidence ≥ 0.80 (`HIGH_CONFIDENCE`) with High/Low-confidence badges, "Not detected"
  placeholder below threshold, autofill helper tip; re-upload re-detects and re-prefills.
  83 Vitest tests green, `tsc -b` clean.
- **Phase 25** — Found-pet flow + location picker (frontend; originally Google Maps, see
  Phase 27): third mode button "Found pet" (`?mode=found`; step 3 = Location found /
  Date & time found / Description, no reward, pet status `found`, `location_lat/lng` sent
  on create), `LocationPicker` (`src/components/maps/LocationPicker.tsx`) with draggable
  pin + address autocomplete + reverse-geocoded address; falls back to a plain input under
  the same id (`flyer-loc`) when no map is available, so e2e keeps working. Found labels
  across detail page ("Found pet: X", "Found at", "Description", "View on map"),
  `FlyerCard`, gallery Found filter, per-mode resolve labels ("Mark returned home").
  MSW: `*/api/flyers/map` handler (registered before `*/api/flyers/:id`) + `mockFoundFlyer`.
  E2E journey ⑨ (found-pet publish) + ③ updated for read-only species.
- **Phase 26** — Interactive pet map page `/map` (`src/pages/PetMapPage.tsx`, nav link in
  AppShell): `flyerMapQuery` → circular photo pins (crimson ring lost / terracotta found),
  tap a pin → popup card with badges, name, species·breed·color, lost/found date + place
  and a "Show Full Details" link to `/flyers/:id`; list fallback; legend, skeleton/empty/
  error states. E2E journey ⑧ (guest map → seeded Bruno/Miso pins → open flyer from a pin →
  "View on map" back).
- **Phase 27** — Leaflet replaces Google Maps everywhere (frontend): `leaflet` +
  `@types/leaflet` npm deps — no API key; `VITE_GOOGLE_MAPS_API_KEY`, the script loader and
  `src/lib/google-maps.d.ts` are gone. `src/lib/maps.ts` now wraps Leaflet: OSM tile-layer
  `createMap`, Nominatim `searchAddress`/`reverseGeocode` (with a coordinates-string
  fallback), circular photo `divIcon` pins (`petPinIcon`, crimson/terracotta ring,
  `data-pet-name` hook for e2e) and the draggable teardrop (`createDropMarker`).
  `LocationPicker` embeds the Leaflet map with a debounced Nominatim suggestion dropdown +
  draggable pin (plain-input fallback under the same id when map init fails);
  `/map` renders one photo pin per flyer with the same popup card and a pin-list fallback.
  Tests: shared `src/test/fake-leaflet.ts` mock (per-file `vi.mock("leaflet")`) + default
  MSW Nominatim handlers; e2e ⑧ now taps a real pin on the live Leaflet map. Verified:
  **150 pytest passed @ 95.41%**, **112 Vitest @ 90.07/82.07/86.10/91.10** (rewards 100%),
  **10/10 Playwright** (9 journeys), `tsc -b` + `vite build` green.
- **Phase 28** — One-command Docker stack (infra): `docker-compose.yml` now runs the
  frontend too — new `frontend` service (new `frontend/Dockerfile`, `node:24-alpine`,
  `npm ci`, Vite dev server published on **:5173** with `PAWPRINT_API_URL=http://web:8000`
  so `/api` + `/media` + `/ws` proxy to the `web` container, source mounted for hot
  reload), while `web` auto-runs `manage.py migrate --noinput` before `runserver :8000`
  and gained a `/api/health` healthcheck; `celery` also migrates first and waits for a
  healthy `web`; postgres/redis are waited on via `service_healthy`. So:
  `cp .env.example .env` → `docker compose up --build` → open http://localhost:5173
  (API :8000, mailpit :8025, postgres :5433, redis :6379) — nothing to run on the host.
  Verified: `docker compose config` clean, `docker compose build frontend` green;
  suites re-run unchanged (**150 pytest @ 95.41%**, **112 Vitest**, **10/10 Playwright**).
  *(Superseded by Phase 29 — the Docker stack was removed in favour of host-installed
  services.)*
- **Phase 29** — Docker removed; dependencies installed directly on the system. Deleted
  `docker-compose.yml`, `backend/Dockerfile`, `frontend/Dockerfile`,
  `frontend/.dockerignore` (and the built `pawprint-*` images). The stack now runs on
  host services: PostgreSQL cluster on 127.0.0.1:5433, valkey (redis-compatible, binaries
  in `~/.local/bin`) on 127.0.0.1:6379, mailpit on :1025/:8025 — all three as systemd
  **user** services (`pawprint-postgres`, `redis-pawprint`, `mailpit`) so they start at
  login without sudo. `.env.example` header now documents the one-time host setup and how
  to run backend + celery + frontend directly; `settings.py` comments no longer reference
  compose; §2 infra rewritten. Verified on the host: `redis-cli ping` → PONG, mailpit UI
  :8025 → 200, `pg_isready` :5433, `manage.py runserver` + `/api/health` → 200; suites
  re-run green (**150 pytest @ 95.41%**, **112 Vitest**, `tsc -b` clean).
- **Phase 30** — Lost/found photo matching + notifications + recoloured map pins.
  *(Phases 30–35 built the lost/found photo-matching feature (CLIP embeddings →
  MegaDescriptor re-ID) — **superseded: the whole feature was removed in Phase 39**;
  the entries below are kept as history.)*
  Backend: new `apps.notifications` app (`Notification` model; `GET /api/notifications`
  → `{results, unread_count}`, `POST /api/notifications/read`; per-user websocket
  `ws/notifications/` — ASGI now wraps websockets in `AuthMiddlewareStack`);
  `Pet.photo_embedding` JSONField (migration `pets/0004`); `vision.PetMatch` (unique
  lost/found pair + score, migration `vision/0002`); `clip_image_embedding` /
  `cosine_similarity` / `PetMatchService` in `apps/vision/services.py` + `match_flyer`
  task (queue `images`) dispatched from `FlyerService.create_flyer`/`update_flyer` for
  emergency/found flyers; threshold `PET_MATCH_SIMILARITY_THRESHOLD` (default 0.80);
  `GET /api/flyers/map` annotates each pin with a `match` counterpart (one extra query;
  map query ceiling 6→7). Tests: `tests/unit/test_vision_match.py`,
  `tests/integration/test_notifications.py`, updated `test_flyer_map.py`. Frontend:
  map pins are now **red = lost, green = found** (`PIN_RING`, new `--color-found` token;
  `badge--found` / `btn--found` / card accents switched to green), matched pins get a
  pulsing amber halo (`pp-pin--match`) plus a "Possible match" legend badge and popup
  banner linking to the counterpart flyer; new `NotificationBell` in the AppShell nav
  (unread badge, dropdown, mark-all-read; `ws/notifications/` push + 30 s polling) with
  `features/notifications/api.ts`; MSW `mockNotification` + handlers; `schema.yml`
  regenerated + `npm run typegen`; e2e ⑧ asserts the red/green ring colours on the live
  map. Verified: **162 pytest passed @ 94.17%**, **118 Vitest @ 89.61/82.23/85.75/90.45**,
  **10/10 Playwright** (9 journeys), `ruff` + `mypy` clean, `tsc -b` + `vite build` green.
- **Phase 31** — Circular pins restored, same-spot stacking, unnamed found pets.
  Frontend map (`src/lib/maps.ts`, `PetMapPage.tsx`, `index.css`): the photo pin is a
  perfect circle again (`overflow: hidden` on `.pp-pin__ring` clips photo/initial; the
  amber match halo moved to the marker element `.pp-pin--match::after` so it isn't
  clipped). Pins within ~30 m of each other (`groupPins` + `haversineMeters`, greedy
  clustering) render as a **card deck** (`stackPinIcon`): the newest flyer's circular
  pin on top with a `×N` count badge (`data-stack-count`), up to two older cards peeking
  out behind (offset 7 px), every card keeping its mode ring (red lost / green found);
  tapping the stack opens a `StackPopup` listing all stacked flyers (thumb ring, badges,
  "Open" link each). Single pins keep the old popup. Found-pet flow: the builder hides
  **Pet name** and **Personality tags** in found mode (heading "Describe the found pet"),
  the zod schema only requires a name for lost/adoptable, and the pet is created with
  `name: ""`. Backend: `Pet.name` is now `blank=True, default=""` (migration
  `pets/0005_alter_pet_name`), `PetCreateSerializer.name` optional/blank, A4 template
  falls back to "FOUND PET"/"this pet" when unnamed. Display fallback
  `petDisplayName()` ("Found pet") across `FlyerCard`, `FlyerDetailPage`, map popup/list
  and pin initials. Tests: `groupPins`/`haversineMeters`/`stackPinIcon` unit tests,
  map-page stack popup test, found-flow builder test (no name field, `name: ""`),
  backend `test_create_found_pet_without_name`; e2e ⑧b posts an unnamed found flyer at
  Bruno's exact coords and asserts the ×2 deck + stack popup (cleaned up afterwards),
  e2e ⑨ updated for the nameless found flow. `schema.yml` regenerated + `npm run typegen`.
  Verified: **163 pytest passed @ 94.22%**, **124 Vitest @ 89.91/82.62/86.17/90.68**,
  **11/11 Playwright** (10 journeys), `ruff` + `mypy` clean, `tsc -b` + `vite build` green.
- **Phase 32** — Fixed lost/found match notifications + centred map pin photos.
  Backend: `PetMatchService.ensure_embedding` was not fault-tolerant — one counterpart photo
  that failed to re-download from storage (e.g. a stale key) raised and killed the whole
  `match_flyer` task, so **no** `PetMatch`/notification was ever created (reproduced on the
  dev DB: 0 matches, 0 notifications, embeddings missing). Now storage/CLIP errors are caught
  and logged per pet, the embedding is also cached eagerly in `PetService.create_pet`, and
  `manage.py backfill_matches` (`PetMatchService.match_all_active_flyers`) re-runs matching
  for all active lost/found flyers idempotently — run once on the dev data it produced the
  expected same-photo match (score 1.000) + both notifications, and `GET /api/flyers/map`
  shows the `match` halo on both pins. `NotificationService.notify_match` falls back to
  "a found pet"/"your lost pet" for unnamed found pets. New tests: storage-error resilience,
  skip-broken-but-still-match, `backfill_matches` idempotency, eager embedding on pet create.
  Frontend map: Leaflet's own marker CSS (`.leaflet-marker-pane img { width: auto }`,
  specificity 0,2,1) outranked `.pp-pin__ring img { width: 100% }`, so pin photos rendered at
  their intrinsic aspect ratio (33×50) instead of filling the circle — added
  `.leaflet-container .leaflet-marker-pane …` scoped overrides (width/height 100%,
  `object-fit: cover; object-position: center`) for pin and stack-card images, verified live
  (photos now fill the 56 px circle, centred); tapping a pin also `panTo`s it into view.
  Tests: leaflet-scoped CSS assertion in `maps.test.ts`, `panTo` assertion in
  `PetMapPage.test.tsx`. Verified: **168 pytest passed @ 94.60%**,
  **125 Vitest** (coverage exit 0; rewards 100%), `tsc -b` clean.
- **Phase 33** — Match the same pet across different-angle photos + builder cleanup.
  Motivation: matching only compared the single cover photo, so a lost report and a found
  report of the *same dog photographed from another angle* did not match ("you only match the
  same picture, not what's on the picture"). Backend: new `pets.PetPhoto` model (one row per
  photo — `pet` FK `related_name="photos"`, `photo_path`, per-angle `photo_embedding`,
  migration `pets/0006`); `PetCreateSerializer` accepts `photo_paths` (list, max 6, `photo_path`
  stays the cover = first photo); `PetService.create_pet` creates a `PetPhoto` per photo with an
  eagerly cached, fault-tolerant CLIP embedding (cover row reuses the `Pet` embedding, no extra
  storage read). `PetMatchService.pet_embeddings(pet)` returns every photo embedding (legacy
  `Pet.photo_embedding` fallback), and `match_flyer` now scores a lost/found pair as the **max
  cosine similarity over the full cross-photo pair product** (both sides
  `prefetch_related("pet__photos")`) — the best angle pair decides, so different angles of the
  same pet match. Frontend builder: `PhotoUpload` is multi-file (up to 4 photos, sequential
  upload, thumbnail strip with remove + tap-to-make-cover, "N photos" badge, locked
  "Photo limit reached" at the cap); the wizard stays on the photo step until **Next** (extra
  angles can be added; going back keeps the photos); the create payload sends `photo_path` +
  `photo_paths`. Found mode now hides the **Age** field too and sends `age: null` (like the
  already-hidden name/tags), and breed/color no longer render High/Low **confidence badges** —
  only the "Not detected" placeholder (confident ≥0.80 detections still prefill). Tests:
  cross-angle match + notifications, no-match when no pair clears the threshold,
  `pet_embeddings` fallback, `create_pet` PetPhoto rows/cap/merge, `photo_paths` API
  integration, `PetPhotoFactory`; frontend multi-pick/remove/cover/cap, `photo_paths` payload,
  found-mode `age: null` + hidden age, badge removal; e2e ③④⑨ updated for the Next step and
  `#pet-age` absence. Verified: **176 pytest passed @ 94.80%** (ruff + mypy clean),
  **129 Vitest** @ 89.35/82.39/84.47/90.51 (coverage exit 0; rewards 100%), `tsc -b` clean,
  **11/11 Playwright journeys** green.
- **Phase 34** — MegaDescriptor re-ID matching replaces full-frame CLIP embeddings.
  Motivation: CLIP full-frame vectors mostly compare scene/picture similarity; pet
  re-identification needs the animal itself. Backend: `PetDetectionService` now also returns
  `best_box` (highest-confidence accepted animal `xyxy`) and exposes `best_animal_box(image)`;
  `padded_crop()` builds a generously padded crop (`PET_CROP_PADDING`=0.20 of the box per
  side, clamped) **in memory only** — stored display images stay full and uncropped. New
  `MegaDescriptorService`: lock-protected timm singleton
  (`hf-hub:BVRA/MegaDescriptor-L-384`, swappable to `hf-hub:BVRA/MegaDescriptor-DINOv2-518`
  via `MEGA_DESCRIPTOR_MODEL`), L2-normalized embeddings of the crop. `ensure_embedding`
  caches one embedding per `PetPhoto` with an `embedding_model` tag (migrations `pets/0007`,
  `vision/0003`; a tag mismatch with a stored photo re-embeds, so legacy CLIP rows migrate
  on the next `backfill_matches`). Scoring is the max cosine similarity over the full
  cross-photo pair product (`score_embedding_pairs`), same-species only (`pet__species`
  filter); threshold `PET_MATCH_SIMILARITY_THRESHOLD` default lowered 0.80 → 0.60 → 0.33 after real-photo calibration (Phase 35)
  (env-tunable). The winning image pair lands on `PetMatch.best_pair` and in the
  `/api/flyers/map` `match` payload; `rank_candidates(flyer_id, top_k)` exposes ranked
  candidates. Reports capped at 4 photos (`MAX_PET_PHOTOS`, serializer `max_length=4`,
  matching the frontend cap). CLIP ViT-B/32 unchanged for `pet_classes` species naming and
  `PetAttributeService` breed/color. `timm>=1.0` added; `schema.yml` + `schema.d.ts`
  regenerated. Tests: new `test_megadescriptor.py` + updated `test_vision_match.py`,
  `test_vision.py`, `test_flyer_map.py`. Verified: **200 pytest passed @ 95.31%** (100%
  `apps/vision/services.py`; ruff + mypy clean), **129 Vitest** green, `tsc -b` clean.

- **Phase 35** — Threshold calibrated on the user's 6 real cat photos (one cat, 6 angles:
  sitting / lounging / playing / close-up / yawning / window). All 6 pass the YOLO-World
  gate as `cat` (max_conf 0.74–0.84, `best_box` present). MegaDescriptor-L-384 embeddings
  (1536-d, L2-normalized padded crops, `PET_CROP_PADDING`=0.20; padding 0.10–0.35 barely
  moves scores) give same-cat cross-angle pairs 0.20–0.61 (mean 0.36) while 27 negative
  images (a dog + 26 other cats) score ≤ 0.32 (mean 0.12). End-to-end shuffle test
  (real upload → gate → `ensure_embedding` → `match_flyer`, scratch DB): **30/30
  4-lost × 1-found shuffle splits matched at threshold 0.33** (per-split max-pair scores
  0.3499–0.5861, `best_pair` stored on `PetMatch` and surfaced in `/api/flyers/map`),
  and other-cat found reports scored ≤ 0.3007 → no false `PetMatch`. Separation window
  [0.30 neg max, 0.35 same-cat min] → `PET_MATCH_SIMILARITY_THRESHOLD` default set to
  **0.33** (env-tunable). `MegaDescriptor-DINOv2-518` was downloaded (2.6 GB, HF token
  from root `.env`) but its CLS/patch features are near-degenerate under timm 1.0.31
  (cosine ≈ 1.0 even vs noise), so L-384 stays the default. HF downloads (timm hub +
  Ultralytics) use `HF_TOKEN` from the root `.env` (auto-loaded by `settings.py`);
  YOLO-World weights stay local (`backend/yolov8s-worldv2.pt`). Also fixed the dev-DB
  500 on `POST /api/pets`: migrations `pets/0007` + `vision/0003` were unapplied —
  `manage.py migrate` ran and the endpoint returns 201. Verified: **200 pytest passed @
  95.31%**, ruff clean (mypy has one pre-existing `test_profile.py` note).

- **Phase 36** — Fix Google OAuth sign-in race condition and craft editorial "Signing in" state ($design-taste-frontend).
  Motivation: In development with React 18/19 StrictMode (and during fast re-mounts), `LoginPage`
  triggered the single-use OAuth authorization code exchange twice concurrently. The second request
  was rejected by Google's token endpoint with `invalid_grant` (400 Bad Request), causing
  `AuthService.google_callback` to throw an error and flash a red "Google sign-in failed." alert box
  even though the first exchange was still in flight and succeeded in authenticating the user.
  Fix:
  1. Guarded authorization code exchange with `exchangedCodeRef` to guarantee strictly single
     execution per `code`, eliminating duplicate API dispatches under StrictMode and re-renders.
  2. Implemented a dedicated, editorial "Signing you in…" state obeying the `taste` skill
     (`design-taste-frontend`):
     - Editorial typography (`var(--font-display)` Fraunces + `var(--font-sans)` Public Sans).
     - Central multicolor Google brand mark (`GoogleBrandIcon` with official `#FFC107`, `#FF3D00`,
       `#4CAF50`, `#1976D2` fills) seated in a softly tinted badge with subtle border.
     - Reassuring copy: "Connecting your Google account and opening your PawPrint workspace."
     - Accessible indeterminate progress bar (`role="progressbar"`, `aria-label="Signing in with Google"`)
       rendered in PawPrint's sage palette (`var(--color-sage)`).
     - Rise entrance animation (`data-enter="3"`) and `@media (prefers-reduced-motion: reduce)` compliance.
     - Smooth navigation to the user's authenticated account (`/` or `next`/`redirect` target).
     - Clean fallback to error box only upon genuine failures or cancellation (`?error=access_denied`).
  3. Fixed `useEffect` navigation warnings in `MyFlyersPage` and `SettingsPage` so redirection occurs
     inside effects rather than during rendering.
  4. Added unit tests in `auth.test.tsx` verifying:
     - The dedicated signing-in card with Google icon and progress bar during in-flight exchange.
     - StrictMode duplicate-invocation prevention (exactly 1 exchange dispatched).
     - Clean handling of OAuth error query parameters.
  Verified: **132 vitest passed** (exit 0), `tsc -b` + `vite build` clean, backend **200 pytest passed @ 95.31%**.

- **Phase 37** — Elevate FlyerCard & interactive pet map with editorial design ($design-taste-frontend).
  Motivation: The flyer cards across the app (Home `/`, Gallery `/flyers`, My Flyers `/my-flyers`, and Wizard `/builder`) and the interactive pet map (`/map`) needed visual and UX elevation according to the `taste` skill (`design-taste-frontend` 2.5.1) and PawPrint 2-mode design guidelines. The map pins and popups needed tactile depth, distinct mode styling (Emergency crimson, Found green, Outreach sage), interactive filtering, real photo framing, and refined micro-interactions.
  Implementation:
  1. **FlyerCard Redesign** (`frontend/src/components/FlyerCard.tsx`):
     - Added mode-tinted top accent bar (`3px solid ${modeColor}`) giving instant visual orientation.
     - Upgraded pet photo frame with editorial 16:10 aspect ratio, smooth hover zoom (`1.04`), and subtle fallback paw mark.
     - Layered badge hierarchy: mode tag, reward pill (`₱5,000`), status tag (the match badge added here was removed in Phase 39).
     - Structured metadata with Lucide `MapPin` and `Calendar` icons for clear geographic and temporal hierarchy.
     - Added an interactive footer with "View flyer" and animated stepping arrow indicator (`translateX(4px)` on card hover).
  2. **Interactive Pet Map Elevation** (`frontend/src/pages/PetMapPage.tsx`):
     - Interactive filter pills in the legend bar ("All pets", "Lost — red pin", "Found — green pin"; the "Possible match" pill was removed in Phase 39) with live pet counts, allowing instant one-tap filtering of mapped markers.
     - Floating frosted glass status pill in the bottom-left of the map displaying active mapped pet counts and navigation tips.
     - Re-styled `PinPopup` into an editorial leaflet popup card (`.map-popup-card`) featuring an edge-to-edge pet photo header (16:10), frosted-glass close button, Fraunces serif headline, mode badge, reward callout, location/date badges, and full-width "Show Full Details" CTA (the possible-match banner added here was removed in Phase 39).
     - Multi-pet clustered `StackPopup` upgraded with circular photo rings, clear row dividers, and quick-open actions.
     - Resilient fallback `PinList` upgraded to match the grid aesthetic when WebGL / Leaflet tiles are loading.
  3. **CSS Design Tokens & Motion** (`frontend/src/index.css`):
     - Defined `.flyer-card`, `.flyer-card__photo`, `.flyer-card__arrow`, `.map-filter-btn`, `.map-filter-btn--active`, `.map-popup-card`, and `@keyframes map-popup-rise`.
     - Added strict `@media (prefers-reduced-motion: reduce)` disabling transforms and transitions for accessible motion preferences.
  Verified: **132 vitest tests passed** across all 11 suites, `tsc -b` and `vite build` clean, zero accessibility or navigation regressions.

- **Phase 38** — Precise species naming (tabby cat was detected as "tiger"/"hedgehog").
  Motivation: YOLO-World open-vocabulary labels fired `tiger`/`hedgehog` ≥ 0.20 on a striped
  house cat, and CLIP's species pass ranked the **full scene** with a loose 0.5 relative margin,
  so `pet_classes` came back as `["tiger", "hedgehog"]`-style multi-label noise. Fix in
  `apps/vision/services.py` (`validate_pet_image` / `_refine_species`): (1) CLIP now ranks the
  **in-memory padded crop** of YOLO-World's best animal box (`padded_crop`,
  `SPECIES_CROP_PADDING`=0.25, clamped; stored image untouched), (2) richer contrastive
  `SPECIES_PROMPT_OVERRIDES` for confusable labels ("small domestic house cat, not a wild big
  cat" vs "large wild tiger … much bigger than a house cat"), (3) selection margin tightened to
  `CLIP_SPECIES_RELATIVE_MARGIN`=0.9 of the top probability, and (4) a **confusable-group
  contrast pass**: when the top pick is in a `CONFUSABLE_GROUPS` lookalike set (feline
  cat/tiger/lion, canine dog/wolf/fox, spiny, lagomorph, rodent, crocodilian, anuran) with a
  group rival within `GROUP_RIVAL_MARGIN`=0.20, a focused CLIP pass over just that group's
  `GROUP_CONTRAST_PROMPTS` decides the single winner. Verified on 18 real photos of one tabby
  cat on mossy concrete: **all classify as `['cat']`** (raw `bear`/`bird` labels remain in
  `detected_classes` only). Tests: crop-instead-of-full-image, relative-margin drop, contrast
  pass resolving tiger→cat, no contrast without a close rival, group-contrast prompt ranking,
  `padded_crop` clamp/fallback, `best_animal_box`. Verified: **168 pytest passed @ 94.99%**
  (100% on `apps/vision/services.py`; ruff + mypy clean).

- **Phase 39** — Removed the lost/found photo-matching feature entirely (supersedes
  Phases 30–35). Backend: deleted `vision.PetMatch` (+migration `vision/0004`),
  `PetMatchService`/`MegaDescriptorService` and all embedding helpers from
  `apps/vision/services.py`, the `match_flyer` celery task, the `backfill_matches` command,
  `photo_embedding`/`embedding_model` columns on `Pet` and `PetPhoto` (migration `pets/0008`),
  the eager embedding cache in `PetService.create_pet`, the `match` dispatch in
  `FlyerService.create_flyer`/`update_flyer`, the `match` annotation in `FlyerMapView`,
  `FlyerMatchSerializer` + the `match` field on `FlyerSerializer`, the `MATCH_FOUND`/
  `MATCH_LOST` notification kinds + `NotificationService.notify_match` (migration
  `notifications/0002`; only `SYSTEM` remains), the `MEGA_DESCRIPTOR_*` /
  `PET_CROP_PADDING` / `PET_MATCH_SIMILARITY_THRESHOLD` settings and the `timm>=1.0`
  dependency (the Hugging Face `BVRA/MegaDescriptor-*` model is gone — no HF downloads for
  matching anymore). Deleted tests `test_vision_match.py` + `test_megadescriptor.py`; updated
  `test_vision.py`, `test_notifications.py`, `test_flyer_map.py` (map query ceiling 7→6).
  `backend/schema.yml` regenerated. Frontend: removed `PinMatch`, the match halo classes
  (`pp-pin--match` / `pp-stack-pin--match` + `pp-halo` keyframes), the "Possible match"
  legend filter/badge, the popup match banner, the `FlyerCard` match badge, the
  `badge--match` style, match copy in `PhotoUpload`/`BuilderWizard`/`pets/api.ts`, the
  `match: null`/`kind: "match_found"` MSW fixtures and the empty-state copy; `schema.d.ts`
  regenerated via `npm run typegen`; tests updated (`PetMapPage.test.tsx`, `maps.test.ts`,
  `NotificationBell.test.tsx`). Verified: backend **168 passed @ 94.99%** (100% on all
  services; ruff + mypy clean), frontend **131 Vitest tests** green (coverage exit 0;
  rewards 100%), `tsc -b` clean.

**Final status:** backend **168 passed @ 94.99%** (100% on all services/drivers incl.
`apps/vision/services.py`);
frontend **131 vitest tests** @ 88.89/81.31/83.67/90.39 + Playwright journeys
green; `ruff` + `mypy` clean; `tsc -b` + `vite build` green; GitHub Actions
CI with 4 jobs (lint / backend-test / frontend-test / e2e); dependencies run directly on
the host (PostgreSQL :5433, Redis :6379, Mailpit :1025/:8025) — no Docker;
vision = YOLO-World gate + CLIP species/breed/color only (no matching model);
`npm run docs:pdf` regenerated.
