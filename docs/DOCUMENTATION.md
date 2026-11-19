# PawPrint — Documentation

PawPrint is a dual-mode lost-pet alert + adoption flyer generator. Guests can browse alerts
and scan QR codes; one unified registered account (email or Google/Gmail OAuth) can post
lost-pet emergencies, publish adoptable pets, generate print-ready A4 flyers, and fund
rewards via Stripe (test mode) or GCash/QR Ph via PayMongo.

---

## 1. Overview & Product Vision

PawPrint helps a lost pet come home and helps a shelter pet find one. Two modes share one
product:

- **Emergency Lost-Pet Mode** — urgent, high-contrast alerts with last-seen details,
  distinctive markings, an optional reward, and a scannable QR code on a print-ready A4 flyer.
- **Adoption Outreach Mode** — warm, welcoming adoption flyers with personality tags and
  shelter/foster framing.

Every uploaded pet photo passes a YOLO-World open-vocabulary animal-detection gatekeeper before
it ever reaches storage, and a CLIP second stage names the actual species. Non-animal photos are
rejected with a friendly 422 — no strikes, no bans.
The web app (`frontend/`, React 19 + TS + Vite) implements the full product in the browser, and
Playwright E2E covers the 6 critical journeys end-to-end.

## 2. Architecture & Stack

- **Backend**: Django 5.2+ (Python 3.12+), DRF, drf-spectacular (OpenAPI), PostgreSQL 16,
  Redis 7, Celery, Django Channels (WebSockets), django-allauth (email + Google OAuth 2.0).
  **No Django Admin** — `django.contrib.admin` is completely removed.
  Packaging: `pyproject.toml` declares an explicit setuptools build backend with
  `packages.find include = ["apps*", "config*"]` so `uv pip install .[dev]` succeeds on a
  full checkout (flat-layout auto-discovery otherwise aborts on `apps/`+`config/`+`templates/`;
  the Dockerfile never hit this because it installs deps before `COPY . .`).
- **Frontend**: React 19 + TypeScript + Vite, React Router v7, TanStack Query v5, Axios,
  Zustand, React Hook Form + Zod, Shadcn/UI, Tailwind v4. React Compiler enabled.
- **Storage**: Cloudinary (private delivery type, HMAC-signed URLs only) via the `cloudinary`
  SDK, wrapped in a Django `Storage` backend (`apps/common/cloudinary_storage.py`).
- **Payments**: Stripe Python SDK (test mode) + PayMongo REST via httpx (GCash Checkout, QR Ph).
- **AI Vision**: Ultralytics YOLO-World (`yolov8s-worldv2.pt`) with 66 configured animal labels as
  the gate/boxer, plus CLIP ViT-B/32 zero-shot species naming; labels are grouped into domestic,
  zoo/exotic, reptile, amphibian, small-mammal, farm, bird, and fish categories.
- **Exports**: WeasyPrint A4@300dpi PNG/PDF flyers + Pillow thumbnails; Playwright for
  browser-side exports.
- **Infra**: `docker-compose.yml` provides `postgres:16`, `redis:7`, `mailpit` (storage is
  Cloudinary, so no MinIO service). Host-side `python manage.py ...` auto-loads the root
  `.env` via python-dotenv (compose sets real env vars, which always win inside containers;
  web/celery additionally pin the in-network `postgres:5432` via `environment:`). For tests
  and Playwright E2E, `PAWPRINT_TESTING=1` (or running under pytest) switches to locmem
  cache, in-memory channel layer, eager Celery, `memory://` broker and filesystem storage —
  no Redis/Cloudinary needed.
- **CI**: GitHub Actions (`.github/workflows/ci.yml`) runs four jobs on every push/PR to
  `main`: `backend-lint` (ruff + mypy), `backend-test` (pytest `-n auto` with
  `--cov-fail-under=80` against a `postgres:16` service), `frontend-test` (`npm ci` →
  `tsc` → `vitest --coverage` with thresholds → `vite build`), and `e2e` (Playwright 7
  journeys against a `postgres:16` service on :5433, with migrate + `seed_demo` and cached
  YOLO-World weights). Coverage HTML/XML and Playwright reports upload as artifacts.

## 3. Access Model (Guest vs Registered — STRICT 2 Modes)

| Capability | Guest | Registered |
|---|---|---|
| Browse lost-pet alerts & adoptable pets | ✅ | ✅ |
| Full-text search / filter flyers | ✅ | ✅ |
| View flyer detail (incl. QR scan landing) | ✅ | ✅ |
| Download / print A4 flyer exports | ✅ (active flyers) | ✅ |
| Create / edit / delete own flyers | ❌ | ✅ |
| Upload pet photos (YOLO-World-gated) | ❌ | ✅ |
| Fund rewards (Stripe / GCash) | ❌ | ✅ |

There is **no admin role, no staff flag, no strike/ban system**. Object-level mutations are
restricted to the creator via `IsOwnerOrReadOnly`. The frontend enforces the same split in
the UI: guests see browse/scan actions, registered users additionally see New flyer, My
flyers, photo upload and Fund reward.

## 4. Backend — Models & ORM

Apps under `backend/apps/`: `users`, `pets`, `flyers`, `rewards`, `webhooks`, `vision`.

- `users.User` — AbstractUser, UUID PK, email login, `display_name`, `phone`, `avatar_path`,
  `google_id` (nullable unique), `email_verified`, `stripe_customer_id`.
- `pets.Pet` — UUID PK, `owner` FK, species/breed/color/age, `temperament_tags` & `health_tags`
  JSON (GIN indexes), `photo_path`, `status` (`lost|adoptable|reunited|adopted`),
  `SearchVector` GIN index on `(name, breed, color)`, composite index `(status, created_at)`.
- `flyers.Flyer` — UUID PK, `pet` FK, `creator` FK, `mode` (`emergency|outreach`), last-seen
  fields, contact fields, reward fields, QR target, export paths, `status`
  (`draft|generating|active|resolved`); indexes `(mode, status, created_at)`, `(creator, mode)`.
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
| `GET /api/flyers` | Guest | Cursor-paginated gallery, FTS `?q=`, mode filter `?mode=` |
| `GET /api/flyers/{id}` | Guest | Public flyer detail (QR scan landing) |
| `POST /api/flyers/new` | Auth | Create flyer (dispatches A4 asset generation) |
| `PATCH/DELETE /api/flyers/{id}/edit` | Auth (owner) | Update / resolve / delete own flyer |
| `GET /api/flyers/mine` | Auth | Creator's own flyers |
| `POST /api/pets/photos` | Auth | YOLO-World-gated photo upload (10/min) |
| `POST /api/pets` | Auth | Create pet record (links an uploaded photo) |
| `POST /api/rewards` | Auth | Create reward payment (Stripe/GCash) → checkout URL / QR payload |
| `GET /api/rewards/{id}/status` | Auth (payer/creator) | Poll payment status |
| `GET /api/rewards/mine` | Auth | Own reward history |
| `POST /api/webhooks/stripe` / `POST /api/webhooks/paymongo` | Signature | Idempotent webhooks |
| `GET /api/health` | Public | Liveness probe |
| `GET /api/schema` | Public | drf-spectacular OpenAPI schema |

## 6. Auth & OAuth Flow

- Email registration & login issue an HttpOnly session cookie plus a CSRF cookie; the
  frontend axios client sends `X-CSRFToken` on mutations (`src/lib/api/client.ts`).
- Google/Gmail OAuth 2.0 via django-allauth: one click registers a new Gmail account,
  links an existing email account, or signs in an existing Google user. The SPA handles the
  redirect at `/auth/login?code=…` (`LoginPage` exchanges the code via
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
- Flyer templates (`templates/flyers/{emergency,outreach}.html`) and the on-screen
  `.print-sheet` follow the `taste` skill print typography (`@page { size: A4; margin: 0 }`,
  `.no-print` chrome hidden): emergency mode uses crimson/amber high-contrast scannability;
  outreach mode uses sage/teal/terracotta warmth. The detail page's Print button uses the
  same sheet.

## 8. AI Pet Detection (YOLO-World gate + CLIP species naming)

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
- **Species naming**: YOLO-World alone can pass a clear animal under a nearby label (rabbit →
  `cat`, crocodile → `bird`, fox → `dog`). After the YOLO-World gate proves an animal is present,
  a second lazily loaded, lock-protected **CLIP ViT-B/32** zero-shot classifier (the same
  `/weights/clip/ViT-B-32.pt` encoder YOLO-World uses for prompts) ranks fine-grained species
  prompts over the whole photo. The refined animal names go into `pet_classes`
  (`fox`, `crocodile`, `frog`, `rabbit`, `dog`, …), while the raw YOLO-World labels stay in
  `detected_classes` for the API/audit trail. If YOLO-World finds nothing at `0.20` but CLIP's
  animal-vs-non-animal gate is confident (e.g. a crocodile close-up), the photo still passes and
  is named by CLIP; plain landscapes still 422. When CLIP is unsure it falls back to the raw
  accepted YOLO labels.
- The YOLO loader falls back to `yolov8s-worldv2.pt` if a stale non-World `YOLO_MODEL_PATH` is
  configured, and raises a clear `RuntimeError` if the checkpoint does not contain a World head.
  Generated weights (`backend/yolov8s-worldv2.pt`, `/weights/`) are git-ignored; Ultralytics
  downloads them on first lazy load.
- **Pass**: EXIF stripped via Pillow, thumbnail generated, upload to private Cloudinary
  (delivery type `private`), `PetDetectionLog(passed=True)`, signed preview URL returned.
- **Fail**: bytes discarded before any storage write, `PetDetectionLog(passed=False)`,
  `NoPetDetectedError` → HTTP 422 `{"error":{"code":"no_pet_detected","message":…,
  "detected_labels":[…]}}` so the user can retry instantly. Zero penalties.
- Frontend UX (`PhotoUpload`): a full-width, fixed-height drop rectangle supports click, keyboard,
  and drag-and-drop selection with a clear drag-active state. During upload, the local pet preview
  stays visible behind an animated scan line and spinner; a live region reports **Uploading photo →
  Scanning photo → Detecting your pet → Saving securely**, with a four-step indicator and progress
  bar. Axios supplies the real byte-upload percentage; because `POST /api/pets/photos` is one
  synchronous request, the later labels follow its known processing pipeline rather than separate
  server telemetry. Backend processing switches the bar to an indeterminate animated state. Reduced
  motion disables the scan/spinner/progress animations without hiding status information.
- The 422 renders a friendly `no-pet-error` box ("No strikes, no bans — just pick another photo")
  and the picker stays open for an immediate retry; a passing photo shows a
  "Detected: `<animal>` ✓" badge using the refined `pet_classes`. In the builder the refined
  `pet_classes` drive species selection (falling back to raw `detected_classes`); one recognized
  standard species auto-selects and disables the species field, ambiguous multi-species results
  (e.g. `cat` + `dog`) stay editable, non-standard animals map to `other`, and the UI states the
  exact detected animal name (e.g. "Detected animal: Rabbit") instead of only "other".
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
- Pages: `/` Home (emergency + outreach rails), `/flyers` Gallery (mode filter + FTS search +
  cursor pagination), `/flyers/:id` Public Flyer + QR + print/export + owner resolve/delete +
  reward checkout, `/builder` 3-step wizard (photo gate → pet form → details/reward; going
  back to the photo step with an uploaded photo shows a **Next** button to continue without
  re-uploading), `/my-flyers`, `/rewards/success`, `/rewards/cancel`, `/auth/login` (also
  handles the Google `?code=` callback), `/auth/register`, `/settings` (profile settings:
  avatar upload with local preview + `PATCH /api/auth/profile` for display name/phone,
  read-only email). The header nav links the avatar + display name to `/settings`
  (`components/Avatar.tsx` renders the round picture with an initial-letter fallback).
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
  → **136 passed, 95.03% total** (100% on all `services.py`, `drivers.py`,
  `apps/vision/services.py`, and the Cloudinary storage driver);
  `django_assert_max_num_queries` ceilings on list/detail endpoints; 429 tests for the
  `auth_write` (20/min) and `upload` (10/min) throttles; webhook idempotency tests (duplicate
  `(provider, event_id)` → single processing); 422-before-storage tests (non-animal bytes never
  reach Cloudinary); expanded YOLO-World + CLIP species tests (66 labels,
  `conf=0.20` asserted on the predictor call, EXIF-orientation/RGB normalization, stale-path
  fallback, non-World checkpoint rejection, rabbit/fox/frog/crocodile renaming from wrong raw
  labels, CLIP animal-gate fallback for YOLO misses, CLIP singleton/loader paths, ambiguous
  multi-species editability); Cloudinary driver unit tests (SDK mocked, 100% on the driver);
  profile/avatar tests (PATCH partial + validation, avatar 400s for missing/non-image/oversize
  file, EXIF-stripped ≤512px JPEG stored privately, old object deleted best-effort, signed
  `avatar_url`, signing-failure fallback); `responses`/MockTransport for Stripe/PayMongo HTTP;
  `factory-boy` factories.
- Frontend: `npm run test:run` → **80 Vitest tests, 7 files** (RTL + MSW, jsdom), including
  drag-and-drop, real Axios upload-progress callbacks, all four live processing labels, the animated
  indeterminate bar, refined-`pet_classes` species selection (rabbit over raw `cat`), ambiguous-species
  editability, builder Next-after-back navigation, auth field icons + password visibility toggle,
  Google brand icon colours, and the settings page (guest redirect, profile save, avatar upload
  success/failure, initial fallback);
  `npm run test:coverage` → **88.41% stmts / 80.83% branches / 84.76% funcs / 89.38% lines**
  (thresholds 70/60/70/70) with **`src/features/rewards/**` at 100%** (per-glob threshold).
  `npx tsc -b --noEmit` clean; `npm run build` green.
- E2E: `npm run test:e2e` (Playwright, `frontend/playwright.config.ts`) → **7 journeys /
  8 tests, all green**, fully self-contained: a stub PayMongo API (`e2e/stub-paymongo.mjs` on
  :9100), the Django backend on :8010 with `PAWPRINT_TESTING=1` (eager Celery, locmem, local
  PG :5433; filesystem `/media/` is served explicitly under TESTING so signed URLs load),
  and the Vite dev server on :5173 proxying to :8010. Journeys: ① guest browse →
  filter → search → detail+QR, ② register → logout → login (demo account), ③ create an
  emergency flyer through the 3-step wizard (YOLO-World-gated upload) → public detail page,
  ④ landscape photo → 422 `no_pet_detected` retry UX → dog photo passes, ⑤ GCash reward
  checkout → QR modal → HMAC-signed PayMongo webhook flips status to `succeeded` (and a
  forged signature is 400), ⑥ open the flyer's `qr_target_value` like a scanner → public
  detail page with SVG QR, ⑦ profile settings → avatar upload + display name/phone save →
  header avatar, profile restored afterwards.
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

**Final status:** backend **136 passed @ 95.03%** (100% services/drivers/vision/storage);
frontend **80 vitest tests** @ 88.41/80.83/84.76/89.38 (rewards 100%) + **8 Playwright tests
green** (7 journeys); `ruff` + `mypy` clean; `tsc -b` + `vite build` green; GitHub Actions
CI with 4 jobs (lint / backend-test / frontend-test / e2e); `npm run docs:pdf` regenerated.
