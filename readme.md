<div align="center">

# 🌬️ Smart AHU Monitoring System

**Real-time monitoring, alarms & a 3D facility editor for seven air-handling units — built on Next.js 16, Supabase PostgreSQL and Three.js.**

[![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=flat&logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat&logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?style=flat&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Three.js](https://img.shields.io/badge/Three.js-r187-000000?style=flat&logo=threedotjs&logoColor=white)](https://threejs.org/)
[![Drizzle ORM](https://img.shields.io/badge/Drizzle_ORM-0.45-C5F74F?style=flat&logo=drizzle&logoColor=black)](https://orm.drizzle.team/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Supabase_Cloud-4169E1?style=flat&logo=postgresql&logoColor=white)](https://supabase.com/)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520.9-339933?style=flat&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Tests](https://img.shields.io/badge/tests-339_passing-16A34A?style=flat&logo=checkmark&logoColor=white)](#-development--verification)
[![License](https://img.shields.io/badge/license-ISC-8A2BE2)](#-license)

</div>

---

## 📖 About

A production-shaped **HVAC monitoring platform**: it ingests telemetry from seven air-handling units (`AHU-01` → `AHU-07`), renders live dashboards, equipment schematics and printable reports, evaluates threshold / fault / communication alarms, projects linear trends — and lets you lay out the entire plant floor in an **interactive 3D room editor** with grid-snapped walls and drag-and-drop AHU placement.

A built-in **telemetry simulator** drives the whole loop out of the box, and a device-token provisioning flow is ready for real gateways.

> ⚠️ **Status: prototype — not a commissioned industrial control system.** Physical control commands are disabled. The web STOP button is **not** an emergency stop. Independent local safety interlocks, control hardware, communications, failover, access security and operational procedures must be designed and validated by qualified professionals. Do not use this software to protect people or equipment.

---

## ✨ Features

| | Feature | Details |
| --- | --- | --- |
| 📊 | **Live fleet dashboard** | Auto-refreshing every ~5 s (`FR-24`) with stale-while-revalidate caching, status tiles and alarm roll-ups |
| 🧊 | **Interactive 3D room editor** | Draw polygon walls, drag AHUs in 3D, 2 m grid snapping, magnetic wall flush-snap, rotate with `R` / `Shift+R` |
| 📈 | **Live charts** | 5 / 15 / 30-minute windows per parameter, powered by Recharts |
| 🚨 | **Alarm engine** | Low/high thresholds with activation delay & priority, controller `FAULT` (`CRITICAL`), communication timeout (`HIGH`); acknowledgement records user + time and never clears an active condition (`FR-15`) |
| 📉 | **Trend projections** | 15/30-minute linear regression proximity warnings (`FR-16`–`FR-18`) that honestly flag low samples, short spans, or high residual variance (`R² < 0.35`) |
| 📄 | **Reports & data logger** | Source-filtered history, streamed CSV exports, browser print/PDF with a clean print stylesheet |
| 🧪 | **Built-in simulator** | Full `REQUESTED` → `ACCEPTED` → `SUCCEEDED` / `FAILED` / `EXPIRED` command lifecycle (`FR-26`/`FR-27`), fault abortion, NACK injection, `STOP`-only override during `FAULT` |
| 🔐 | **Four-role RBAC** | `Admin` / `Engineering` / `Operator` / `Viewer`, enforced server-side on every query, with unified per-IP login rate limiting (10 attempts / 15 min, `NFR-02`) |
| 📝 | **Audit trail** | Who changed what, when — visible to `Admin` and `Engineering` |
| 📡 | **Gateway-ready ingestion** | Bearer-token device API with idempotent deduplication (`FR-23`) |

**Monitored parameters (up to 12 per unit):** `roomTemp`, `supplyTemp`, `returnTemp`, `humidity`, `filterDiffPressure`, `fanSpeed`, `coilTemp`, `damperPosition`, `current`, `voltage`, `runHours`, `heaterOutput`.

---

## 🧰 Tech Stack

| Layer | Technology |
| --- | --- |
| 🖥️ Web app | [Next.js 16](https://nextjs.org/) (App Router) · [React 19](https://react.dev/) · TypeScript 5.9 |
| 🎨 UI & charts | [Tailwind CSS 4](https://tailwindcss.com/) · [Recharts 3](https://recharts.org/) · [Lucide](https://lucide.dev/) icons |
| 🧊 3D facility | [Three.js r187](https://threejs.org/) — custom WebGL room editor (no heavy 3D framework) |
| 🗄️ Database | [Supabase Cloud PostgreSQL](https://supabase.com/) via [Drizzle ORM](https://orm.drizzle.team/) — private `ahu_private` schema + typed migrations |
| 🔑 Identity | Supabase Auth (Admin email/password) + server-verified one-time browser tokens (`Engineering` / `Operator` / `Viewer`) |
| 🧪 Testing | Node's built-in test runner (`node --test`) + tsx, against real SQL via [PGlite](https://github.com/electric-sql/pglite) — 339 tests |
| ⚙️ Background work | In-process simulator (5 s) & monitoring (10 s) loops in the Next.js Node server |

---

## 🏗️ Architecture at a Glance

```text
┌────────────────────────────────────────────────────────────────────┐
│                        Browser (Next.js UI)                        │
│   Dashboard · 3D Room Editor · Unit Detail · Trends · Reports      │
└────────────────────────────┬───────────────────────────────────────┘
                             │  HTTP polling ~5 s (stale-while-revalidate)
┌────────────────────────────▼───────────────────────────────────────┐
│                     Next.js Node server (API)                      │
│  RBAC · rate limiting · alarm engine · trend engine · CSV stream   │
│  ┌───────────────┐  ┌──────────────────────────────────────────┐   │
│  │ Simulator loop│  │ Monitoring loop (alarms, comm-loss, ...) │   │
│  │    every 5s   │  │                every 10s                 │   │
│  └───────┬───────┘  └────────────────────┬─────────────────────┘   │
└──────────┼───────────────────────────────┼─────────────────────────┘
           │        Drizzle ORM (SQL)      │
┌──────────▼───────────────────────────────▼─────────────────────────┐
│           Supabase Cloud PostgreSQL · private "ahu_private"        │
│      telemetry · alarms · commands · users · devices · audit       │
└────────────────────────────────▲───────────────────────────────────┘
                                 │  POST /api/telemetry (Bearer token)
                        ┌────────┴─────────┐
                        │ Gateway / device │  (or the built-in simulator)
                        └──────────────────┘
```

<details>
<summary><b>🔁 Why the sync badge shows <code>Supabase Cloud · HTTP Polling 5s</code></b></summary>

In the original specification (`FR-24`), "Cloud Mode" meant Firebase Realtime Database push while "Local Mode" meant ~5-second SQL polling. This project stores all data directly in **Supabase Cloud PostgreSQL** and updates the browser via ~5-second HTTP polling (no Firebase), so the UI reports **`Supabase Cloud` (`HTTP Polling · 5s`)** when connected to a remote Supabase project, and `Local Mode` only when connected to a `localhost` PostgreSQL instance.

</details>

<details>
<summary><b>🔀 Telemetry source precedence & device enable/disable behavior</b></summary>

- An enabled **`PHYSICAL`** device is authoritative: simulated ingestion for that unit is rejected and the simulator skips it.
- Otherwise an enabled **`SIMULATION`** device is authoritative.
- When the authoritative source changes (`SIMULATION` ↔ `PHYSICAL`) or all devices for an AHU are disabled in **Admin → Devices**: pending breach timers and stale controller fault codes are cleared, active non-communication alarms from the outgoing source are resolved into alarm history (with `ALARM_RESOLVED` audit entries), and incompatible active commands transition to `FAILED` (`COMMAND_FAILED`).
- With no enabled devices left, live views immediately treat the AHU as **`OFFLINE`** and raise a communication-loss alarm, while history stays preserved in `ahu_private.telemetry` for **Reports & Data Logger**. Re-enabling a simulation device resumes simulation instantly.
- **Simulator is enabled by default** — set `SIMULATION_ENABLED=false` to disable automatic ticks, or `SEED_SIMULATED_HISTORY=false` to suppress initial synthetic history on an empty database.

</details>

<details>
<summary><b>☁️ Cloud-only boundary & data quality rules</b></summary>

- **No edge fallback:** there is no separate local SQLite/MySQL failover database — a network or Supabase outage interrupts monitoring. Background `setInterval` workers assume a persistent Node process (`npm run dev` / `npm start`) rather than stateless serverless functions.
- **Data quality (`NFR-06`):** sentinel readings (current `1 A`, voltage `220 V`, unless explicitly `quality: "measured"`) are flagged `ESTIMATED_FALLBACK` and excluded from report averages/min-max, trend regressions, and threshold alarms — but remain labeled in CSV exports.

</details>

---

## 🔐 Roles & Access

| Role | Sign-in | Capabilities |
| --- | --- | --- |
| 🛡️ **Admin** | Email + password (Supabase Auth) | Everything: user management (with self/last-Admin lockout protection), device provisioning, configurations, controls, acknowledgements, audit logs |
| 🔧 **Engineering** | One-time browser token | Configures AHU/sensor thresholds, controls simulated units, acknowledges alarms/trends, views audit logs |
| 🎛️ **Operator** | One-time browser token | Controls simulated units, acknowledges alarms/trends, views monitoring/reports |
| 👁️ **Viewer** | One-time browser token | Read-only monitoring dashboards, unit details, alarms, trends, reports |

All role checks are enforced **server-side**; the UI only mirrors what the API already guarantees.

---

## 🚀 Quick Start

**Prerequisites:** Node.js ≥ 20.9 (Node 22 LTS recommended) + `npm`, and a [Supabase](https://supabase.com/) project with **public sign-ups disabled**, using the PostgreSQL pooler connection string (`sslmode=require`) and `ahu_private` kept out of the public Data API.

```bash
# 1 · Install dependencies
npm ci

# 2 · Configure environment
cp .env.example .env.local
#    ↓ then fill in:
#    DATABASE_URL                       PostgreSQL connection string (?sslmode=require)
#    NEXT_PUBLIC_SUPABASE_URL
#    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
#    SUPABASE_SERVICE_ROLE_KEY          (server-only)

# 3 · Run database migrations
npm run db:migrate

# 4 · (First-time empty database only) bootstrap the initial Admin account
BOOTSTRAP_ADMIN_EMAIL="admin@example.com" \
BOOTSTRAP_ADMIN_PASSWORD="StrongPassword123!" \
npm run db:bootstrap-admin

# 5 · Start developing
npm run dev
```

> 🪟 **Windows PowerShell** equivalent for step 4:
> `$env:BOOTSTRAP_ADMIN_EMAIL="admin@example.com"; $env:BOOTSTRAP_ADMIN_PASSWORD="StrongPassword123!"; npm run db:bootstrap-admin`

---

## 🔑 Browser Access & Admin Recovery

- 🛡️ **Admin** → sign in at `/login` (**Administrator** tab) with email + password only.
- 🎫 **Everyone else** → an Admin generates a **one-time 64-character hex token** in **Users (`/admin?tab=users`)**; the member redeems it at `/login` (**Member Token** tab). Tokens are valid for **24 h** and claim one browser session (90-day `ahu_device` cookie). Signing out revokes the cookie.

<details>
<summary><b>🔄 Changing or resetting an Administrator password</b></summary>

**From the web UI (signed in as Admin):** **Users (`/admin?tab=users`)** → **Change Admin password** → select the account, enter the new password (8+ chars) → **Update Admin password**.

**From the terminal** (`scripts/reset-admin.mjs` accepts direct CLI arguments):

```bash
# Reset when only one Admin account exists:
npm run db:reset-admin -- <new_password>

# Reset for a specific Admin email:
npm run db:reset-admin -- <admin_email> <new_password>
```

Environment variables are also supported (`BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD`) in both PowerShell and Bash.

</details>

<details>
<summary><b>📟 Device provisioning (gateway tokens)</b></summary>

Administrators manage telemetry sources in **Devices (`/admin?tab=devices`)**:

- **Provisioning (`FR-21`)** issues a bearer token (`phy_<ahu>_…` or `sim_<ahu>_…`) bound to one AHU (`AHU-01`–`AHU-07`) and one source type (`PHYSICAL` or `SIMULATION`).
- **Disabling** a device immediately blocks its telemetry ingestion and updates the AHU's live status (the full transition rules are in the *Telemetry source precedence* section above).
- **Re-enabling** a `SIMULATION` device triggers a fresh simulation reading and restores the unit's live status instantly.

</details>

---

## 📡 Telemetry API

Gateways send JSON readings to `POST /api/telemetry` with `Authorization: Bearer <device_token>`:

```json
{
  "ahuId": "AHU-01",
  "messageId": "msg-20261105-0001",
  "timestamp": "2026-11-05T08:00:00.000Z",
  "runState": "RUN",
  "faultCode": null,
  "parameters": {
    "supplyTemp": 14.8,
    "roomTemp": 22.4,
    "humidity": 51.2,
    "filterDiffPressure": 135,
    "fanSpeed": 78
  }
}
```

🔁 Duplicate resends with the same `(ahuId, messageId)` are safely deduplicated (`FR-23`) — no duplicated history, no falsified heartbeat freshness.

---

## 🧪 Development & Verification

```bash
npm run typecheck   # strict TypeScript, zero errors expected
npm test            # 339 tests — SQL-backed, via PGlite
npm run build       # production build
```

| Script | Purpose |
| --- | --- |
| `npm run dev` | Development server with in-process simulator & monitoring loops |
| `npm run build` / `npm start` | Production build & serve |
| `npm run db:generate` / `db:migrate` | Generate & apply Drizzle migrations |
| `npm run db:bootstrap-admin` | Create the initial Admin account |
| `npm run db:reset-admin` | Reset an Admin password from the CLI |
| `npm run db:bootstrap-device` | Provision a device token from the CLI |

**Deployment:** run migrations before building and starting the production Node server:

```bash
npm run db:migrate && npm run build && npm start
```

<details>
<summary><b>🗂️ Project structure</b></summary>

```text
src/
├── app/                  # Next.js App Router — (app)/ routes, /api endpoints, login
│   ├── (app)/            # dashboard, ahu units, trends, reports, admin, settings
│   └── api/              # telemetry ingest, queries, commands, auth, devices
├── components/           # React UI — incl. AhuFacilityMap3D (Three.js room editor)
├── db/                   # Drizzle schema ("ahu_private"), migrations, pooled connections
├── lib/                  # domain logic: alarms, trends, RBAC, device tokens,
│                         # facility layout & snapping physics, report rendering
└── instrumentation.ts    # background simulator & monitoring loops
tests/                    # 339 node:test suites — real SQL via PGlite
drizzle/                  # generated SQL migrations
scripts/                  # bootstrap / reset admin, bootstrap device
```

</details>

---

## 📚 Specification Coverage

The implementation is informed by `FR-01`–`FR-29` and `NFR-01`–`NFR-09`. By project architecture decision, **Supabase Cloud PostgreSQL + Supabase Auth** replaces the specification's original MySQL + Firebase Realtime Database stack.

## 📄 License

[ISC](https://opensource.org/licenses/ISC) — see `package.json`.
