---
name: pawprint
description: Engineering and UI conventions for PawPrint. Always follow the `taste` skill for UI design. Every code change MUST ship with tests, a regenerated documentation.pdf, an updated Tutorial section, and a clean git commit.
---

# PawPrint Engineering & Design Skill

## UI & Visual Design Mandate (`taste` skill)
- **Read and enforce the `taste` skill** on every frontend task and A4 flyer layout:
  - Craft an editorial, trustworthy, emotionally resonant aesthetic tailored to pet rescue and emergency recovery.
  - Maintain clear visual distinction between **Emergency Lost-Pet Mode** (urgent crimson/amber accents, high-contrast scannability, prominent last-seen badges) and **Adoption Outreach Mode** (warm sage/teal/terracotta accents, personality tags, welcoming shelter/foster framing).
  - Enforce strict typographic hierarchy, balanced padding, accessible contrast ratios, tactile hover/focus states, and clean skeleton/empty/error states.

## User Access Model (STRICT — 2 Modes Only)
- **No Admin System**: Do NOT include `django.contrib.admin`, admin dashboards, staff flags, or moderation strike/ban systems.
- **Guest Mode**: Unauthenticated visitors (`AllowAny` on read-only endpoints) can browse lost/adoptable flyers, search/filter pets, view flyer details, and scan QR codes.
- **Registered Mode**: Single unified user model (`User`) supporting both standard email registration and **Google/Gmail OAuth 2.0 registration & login**. Any authenticated user (`IsAuthenticated`) can create lost-pet alerts, post adoptable pets (acting as owner, foster, or shelter volunteer), and generate flyers. Object-level mutations (`PATCH`/`DELETE`) are restricted to the flyer's creator (`IsOwnerOrReadOnly`).

## Django 5.2+ & ORM Best Practices (MANDATORY)
- **Strict Type Annotations (Python 3.12+)**: Type-annotate all services, selectors, DTOs (`@dataclass(frozen=True)`), and views.
- **Selector + Service Layer Pattern**:
  - `selectors/` handles ALL database reads using optimized QuerySets: `select_related()` for FKs/OneToOne, `prefetch_related()` for reverse/M2M, `only()`/`defer()` where appropriate, PostgreSQL `SearchVector` + GIN index for full-text search (never `icontains` table scans), and cursor pagination.
  - `services/` handles ALL writes wrapped in `@transaction.atomic`, external API calls, and Celery task dispatches.
  - Views/ViewSets (`APIView` / `GenericViewSet`) stay thin (≤15 lines): validate via Serializer → call Selector/Service → return Serialized response. Zero raw ORM queries in views.
- **Database Integrity**: Use `UniqueConstraint`, `CheckConstraint`, and composite indexes; keep all write paths wrapped in atomic transactions.
- **OpenAPI Schema**: `drf-spectacular` generates `schema.yml` automatically for `openapi-typescript`.
- **Celery Routing**: Centralized `CELERY_TASK_ROUTES` in `config/settings.py` (`flyers`, `images`).

## React 19 + TypeScript + Axios Best Practices (MANDATORY)
- **Centralized Axios Instance (`src/lib/api/client.ts`)**:
  - Single configured `axios.create({ baseURL: '/api', withCredentials: true, xsrfCookieName: 'csrftoken', xsrfHeaderName: 'X-CSRFToken' })`.
  - Typed request/response interceptors for global error normalization (`ApiError`) and automatic 401 session-expiry handling.
  - All API calls go through domain API modules (`src/features/{domain}/api.ts`) using the Axios client — never raw `fetch` or inline URLs in components.
- **React 19 Modern Idioms**:
  - `useActionState` for form submissions with pending/error state.
  - `useOptimistic` for optimistic UI updates (instant flyer card insert on create).
  - React Compiler enabled in `vite.config.ts` (auto-memoization — avoid redundant `useMemo`/`useCallback`).
  - Ref as prop (no `forwardRef` in React 19).
- **TanStack Query v5 + Type Safety**:
  - Use `queryOptions` factories for type-safe query keys and Axios fetchers.
  - Use `useMutation` with `onMutate` + `onError` context rollback for optimistic mutations.
  - Generate all API DTOs via `openapi-typescript` from `drf-spectacular` schema (`src/lib/api/schema.d.ts`) — never hand-write backend DTOs.
  - Zod + React Hook Form for all forms.

## AI Pet Detection Gatekeeper (YOLO-World gate + CLIP species naming — Replaces Moderation/Bans)
- Every uploaded pet photo passes `PetDetectionService.validate_pet_image(image_bytes)` BEFORE any write to private local storage under `flyers/{user_id}/{losts,adoptions,found}/`.
- Uses `ultralytics.YOLOWorld("yolov8s-worldv2.pt")`, lazily loaded and cached once per process, with `model.set_classes()` configured for expanded open-vocabulary animal labels; a lazily loaded lock-protected CLIP ViT-B/32 second stage names the actual species (`pet_classes`) while raw YOLO labels stay in `detected_classes`.
- `ANIMAL_CATEGORY_BY_LABEL` groups specific outputs into Domestic Pet, Zoo / Exotic, Reptile, Amphibian, Small Mammal, Farm Animal, Bird, and Fish categories; acceptance is label-based (never COCO class IDs), with configurable confidence defaulting to `>= 0.20` passed into `predict(conf=...)`.
- **If a pet is detected**: Strip EXIF metadata via Pillow, generate thumbnail, and save into the private local root with `0600` files / `0700` dirs; reads only via short-lived HMAC-signed `/private-media/` URLs.
- **If NO pet is detected**: Discard immediately (never saved to storage) and raise `NoPetDetectedError` → HTTP `422 Unprocessable Entity` with clear message (`"No pet detected in the photo. Please upload a clear photo of your pet."`) and detected labels so the user can retry.
- **Zero penalties**: No user strikes, no suspensions, no banning. Users can immediately select another photo.

## Git Commit Discipline (MANDATORY)
- Commit after EVERY phase AND after EVERY major/minor impactful change (e.g., new service, model migration, API integration, UI feature, or test suite milestone).
- Never batch multiple phases into one giant commit. Keep git history clean, atomic, and bisectable.

## Verification & Living Documentation (MANDATORY)
- Automated test suites are not part of this repository by project direction. Do not add test runners, test suites, or test-only dependencies.
- Run backend static checks (`ruff check .`, `mypy apps`) and frontend type-check/build (`npm run lint`, `npm run build`) when relevant.
- Update all 12 sections of `docs/DOCUMENTATION.md` (including the **Tutorial** build log) and regenerate `docs/documentation.pdf` via `npm run docs:pdf` before committing each phase.
