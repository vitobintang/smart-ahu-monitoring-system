# 🗂️ Smart AHU Monitoring System — Project Board

> **Last updated:** 2026-11-09 · **Timeline:** 2026-11-01 → 2026-11-09 (day 9 of active development)
> **Sources of truth:** GitHub commit history (159 commits), merged PR records (#1–#19), and the current codebase.
> Companion documents: [`readme.md`](./readme.md) (product overview) · [`PROJECT_BRIEF.md`](./PROJECT_BRIEF.md) (original goal).

## 📊 Status Overview

| Status | Count | Meaning |
| --- | --- | --- |
| ✅ **Done** | 41 | Shipped, merged to `main`, and verified (tests/build green at merge time) |
| 🔄 **In Progress** | 3 | Actively being worked on or awaiting an operational step |
| 📝 **Todo** | 12 | Planned next — not started |
| 🧊 **On Hold** | 2 | Valid work paused on an external dependency |
| ❌ **Canceled** | 7 | Dropped by decision or superseded by a better approach |
| **Σ Total** | **65** | |

**Velocity:** 19 PRs merged in 6 working days (Nov 1 → Nov 9, excluding the Nov 6–8 maintainer-fix window). 339 automated tests, 0 type errors, clean production build at last verification.

---

## 🔄 In Progress

| ID | Item | Started | Notes |
| --- | --- | --- | --- |
| IP-1 | **Apply migration `0006_remove_viewer_role` on the production Supabase DB** (`npm run db:migrate`) | 2026-11-05 | Shipped in PR #18 but the live database still needs the run — existing `Viewer` accounts become `Operator`. |
| IP-2 | **CI pipeline stabilization** | 2026-11-09 | `.github/workflows/ci.yml` landed on `main` (commit `2c30cd9` window); getting typecheck + 339-test suite green on every PR is the acceptance bar. |
| IP-3 | **Optional DB hardening: drop dormant `Viewer` enum label** | 2026-11-05 | Run `sql/compatibility/drop-viewer-enum-value.sql` once after IP-1 on the real PostgreSQL instance (PGlite dev/test keeps the label). |

---

## 📝 Todo (Planned Backlog)

| ID | Item | Priority | Added | Rationale |
| --- | --- | --- | --- | --- |
| T-1 | **Forgot-password / email reset flow** | High | 2026-11-09 | Admins can reset passwords via CLI/UI, but members have no self-service recovery. |
| T-2 | **Email member invitations via Supabase Auth invite API** | High | 2026-11-09 | Accounts are currently created manually by an Admin in `/admin?tab=users`. |
| T-3 | **Real gateway pilot: Modbus/BACnet → `POST /api/telemetry`** | High | 2026-11-09 | Ingestion API + device tokens are shipped (FR-21/FR-23); needs the first physical device onboarding runbook. |
| T-4 | **E2E test suite (Playwright) wired into CI** | Medium | 2026-11-09 | 339 node:test suites cover logic/SQL; no browser-level flow tests yet. |
| T-5 | **Live push upgrade: SSE/WebSocket to replace 5 s polling** | Medium | 2026-11-09 | `FR-24` polling works; push would cut latency and DB read load (see ❌ C-2 for history). |
| T-6 | **Dockerfile + production deployment guide** | Medium | 2026-11-09 | Background workers require a persistent Node process; document the supported deploy topology. |
| T-7 | **Supabase backup / DR runbook** | Medium | 2026-11-09 | Telemetry history is the product's core asset; define PITR/snapshot policy. |
| T-8 | **Dark mode** | Low | 2026-11-09 | The 3D facility map already has a daylight theme system to extend. |
| T-9 | **Bahasa Indonesia UI localization** | Low | 2026-11-09 | Primary site is Indonesian; i18n scaffold for operations staff. |
| T-10 | **Trend-projection notifications digest** | Low | 2026-11-09 | `FR-16`–`FR-18` warnings exist in-app; batch them into an operator digest. |
| T-11 | **Energy page: cost tariffs & monthly comparison** | Low | 2026-11-09 | Energy dashboard is shipped; tariff input makes the numbers actionable. |
| T-12 | **Accessibility audit (WCAG AA) of dashboard + 3D HUD** | Low | 2026-11-09 | Contrast was overhauled in PR #11; formal audit still pending. |

---

## 🧊 On Hold

| ID | Item | Paused | Blocked on |
| --- | --- | --- | --- |
| H-1 | **Physical (`PHYSICAL`) telemetry source activation** | 2026-11-01 | Hardware/BMS vendor — API, token provisioning, dedup and source-precedence logic are all shipped and tested; awaiting a real gateway. |
| H-2 | **Push notifications for `CRITICAL` alarms (email/Telegram)** | 2026-11-05 | Channel choice + operator contact list; the in-app alarm center covers current needs. |

---

## ❌ Canceled

| ID | Item | Canceled | Reason |
| --- | --- | --- | --- |
| C-1 | **MySQL persistence layer** | 2026-11-01 | Architecture decision recorded in the brief: **Supabase Cloud PostgreSQL** replaces the spec's original MySQL. |
| C-2 | **Firebase Realtime Database push sync** | 2026-11-01 | Replaced by Supabase + ~5 s HTTP polling with stale-while-revalidate (documented in README "Why the sync badge…"). |
| C-3 | **Viewer role** | 2026-11-05 | Removed in PR #18; `Operator` became the base tier. Migration `0006` upgrades existing accounts. |
| C-4 | **One-time browser-token member login (Member Token tab)** | 2026-11-05 | Superseded by unified Supabase Auth (email/username + password, Google) for **all** roles (PRs #4, #7, #18). Browser-authorization internals live on for session verification only. |
| C-5 | **Physical control commands (real actuation)** | 2026-11-01 | Canceled by safety design — prototype boundary; `PHYSICAL` writes stay locked (`403 PHYSICAL_LOCKED`), web STOP is explicitly not an e-stop. |
| C-6 | **Local SQLite/edge failover database** | 2026-11-03 | Cloud-only boundary accepted; workers assume a persistent Node process. |
| C-7 | **Spec PDFs stored in-repo** | 2026-11-09 | Obsolete requirement documents removed (`2c30cd9`); README + PROJECT_BRIEF are the living references. |

---

## ✅ Done

### Phase 0 · Kickoff & Scaffolding — 2026-11-01

- ✅ Repository init, project brief, Git hygiene (`cb6b21c`, `18f94ca`)
- ✅ Node + Next.js + React + TypeScript setup, Tailwind & global styles (`031ebd8`…`35f9105`)
- ✅ AHU monitoring domain model, role permissions, status calculation, telemetry validation, data-quality classification (`4b58919`…`75eb9e7`)
- ✅ First UI previews: dashboard, AHU detail, login (`624a202`, `dc9e34f`, `a099edf`)

### Phase 1 · Data & Auth Foundations — 2026-11-02

- ✅ User DB schema, initial migration, local-DB migration test (`b8bf072`, `612caae`, `e9ac488`)
- ✅ Browser authorization stack: storage, token hashing, one-time invitations, verification, Admin issue/revoke (`7c5f696`…`2f05a18`)
- ✅ Security helpers, protected session endpoint, combined request authorization (`ff47ea5`, `6c8ff90`, `90d638c`)
- ✅ Historical observation endpoints & panels, report summaries/filters, dashboard wiring (`9b00692`…`f813799`)
- ✅ Rolling login rate limiter groundwork (`28a5cc7`, `dd3276b`)

### Phase 2 · Full-Stack Wiring — 2026-11-03

- ✅ Staged login authorization: gateway guard, Supabase password adapter, staged cookies, enrollment (`352926c`…`aaffaba`)
- ✅ Core spec build-out in 8 structured commits: schema/migrations/seed + admin bootstrap, session proxy & user-management APIs, authoritative-source engine (telemetry/alarms/commands/trends), queries + simulator/monitoring workers + instrumentation, all API routes, visual assets & UI SDK (`16a01e2`…`e5bff53`)
- ✅ Fictional practice modules: report print view, command & alarm lifecycles, analytics (`eaff70c`…`9bd6f50`)

### Phase 3 · Application Complete + First PR — 2026-11-04

- ✅ AppShell, protected route group, root redirect, live login page (`0cc2f7a`)
- ✅ Side-elevation/cross-section schematic, live charts, control panel (`a9788ad`, `bd4c843`)
- ✅ All pages live: dashboard, fleet, unit detail, alarms, trends, data-logger reports (FR-10/11/12), energy, maintenance, simulator, config (FR-19), admin, audit (`2c013fa`…`5f812a3`)
- ✅ **PR #1** — separate Admin email/password sign-in from member token-only sign-in (merged 2026-11-04)

### Phase 4 · Spec Hardening & Experience Overhaul — 2026-11-05 (PRs #2–#8)

- ✅ **PR #2** — coil schematic fix, device-disable status, sync-mode label, Admin password reset, page-load speed
- ✅ **PR #3** — Priority-1 spec compliance: FAILED command transitions, per-IP rate limit (NFR-02), source hygiene, user lifecycle (FR-20/FR-26/27)
- ✅ **PR #4** — unified email/username login, profile menu, portal control panel, mobile/tablet UI
- ✅ **PR #5** — mountain-vista login visual, frosted alpine glass
- ✅ **PR #6** — formal A4-default engineering report, compact square mobile cards
- ✅ **PR #7** — Supabase pool-exhaustion 500s fixed, login snap-back & hydration fixes, unified Google OAuth
- ✅ **PR #8** — duplicate simulation-module prevention + device delete action

### Phase 5 · 3D Digital Twin — 2026-11-05 (PRs #9–#13)

- ✅ **PR #9** — 3D branched facility map & AHU placement, STOP→START fix, seamless airflow, LCP optimization
- ✅ **PR #10** — full-page 3D facility view, AHU list toggle, instant Top View, wall-mounted outdoor AHUs, solid wall physics/snap
- ✅ **PR #11** — full-height canvas, daylight theme & high-contrast UI, smooth Top-View glide, morphing AHU badge→card
- ✅ **PR #12** — Supavisor pool unification + circuit-breaker backoff, 3D outdoor trees, GPU-smooth card pop
- ✅ **PR #13** — interactive 3D room editor (draw/split/drag walls), mountain topbar, trees that sprout/hide with room size

### Phase 6 · Performance & Code Health — 2026-11-05 (PRs #14–#17)

- ✅ **PR #14** — zero-lag room editor (pooled in-place mesh updates, per-frame pointer coalescing, 2 m drag grid); instant AHU move-save (dedicated worker DB pool, fire-and-forget pulses, optimistic pinning)
- ✅ **PR #15** — ~600-line dead-code purge, PDF mountain-leak fix, grid-snapped Add-Corner preview, drag smoothing
- ✅ **PR #16** — AHU placement snaps to visible 2 m floor grid; `R` / `Shift+R` rotate hotkeys (direction-aware button)
- ✅ **PR #17** — three r187 deprecation fixes (manual frame clock, explicit PCF shadows); professional README (badges, architecture diagram, quick start)

### Phase 7 · RBAC Simplification & Docs — 2026-11-05 (PR #18)

- ✅ Viewer role removed (3-role model: Admin / Engineering / Operator), migration `0006`, corrected sign-in docs (all roles use Supabase Auth: password or Google)
- ✅ Migration-journal fix: `0005_add_facility_floorplan` registered (fresh `db:migrate` no longer skips the floorplan table)

### Phase 8 · Maintainer Window — 2026-11-06 → 2026-11-08

- ✅ Report gradient fix (`a517bdd`), telemetry ingestion & trend-analysis refactor (`3785eb5`), linear-gradient consistency (`45844a9`)

### Phase 9 · UX & Health Pass — 2026-11-09 (PR #19)

- ✅ Context-aware back button on AHU detail (`← 3D Facility Map` vs `← Dashboard`, internal-path guarded `?from=`)
- ✅ `AhuFacilityMap3D` split (2,819 → 2,488 lines + pure builders module; upstream parallel refactor adopted during merge)
- ✅ Full project health audit: strict typecheck 0 errors · **339/339 tests** · clean build · zero `any`/empty catches · images verified optimal

### Continuous Quality Gates (verified at every merge since Phase 2)

- ✅ Strict TypeScript (`--noEmit --noUnusedLocals --noUnusedParameters`) — 0 errors
- ✅ 339 automated tests (logic + real-SQL via PGlite) — all passing
- ✅ Clean Next.js 16 production build; security headers, HTTPS redirect option, asset caching configured

---

## 🗓️ Milestone Timeline

```text
2026-11-01  ██ Kickoff: repo, stack, domain model, first previews
2026-11-02  ████ Foundations: schema, auth stack, history APIs
2026-11-03  ██████ Full-stack wiring: engine, workers, API routes, practice modules
2026-11-04  ████████ All pages live · PR #1 merged
2026-11-05  ████████████████████ Hardening + 3D twin + perf + docs + RBAC (PRs #2–#18)
2026-11-06  – maintainer fixes
2026-11-09  ████ Gradient/telemetry fixes, spec cleanup, PR #19 merged
```

---

*Maintained by hand from GitHub history — update the ✅/🔄/📝 rows as work lands, and keep the dates honest.*
