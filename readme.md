# Smart AHU Monitoring System

A Next.js application for monitoring seven air-handling units (`AHU-01` through `AHU-07`). It records telemetry in Supabase Cloud PostgreSQL, displays live dashboards, equipment schematics and reports, evaluates alarms and linear trend projections, and includes a built-in telemetry simulator. Administrators sign in with Supabase Auth email and password; Engineering, Operator and Viewer roles sign in using one-time browser access tokens issued by an Administrator.

> **Status: prototype, not a commissioned industrial control system.** Physical control commands are disabled. The web STOP button is **not** an emergency stop. Independent local safety interlocks, control hardware, communications, failover, access security and operational procedures must be designed and validated by qualified professionals. Do not use this software to protect people or equipment.

## Contents

- [What it does](#what-it-does)
- [Architecture and limitations](#architecture-and-limitations)
- [Prerequisites](#prerequisites)
- [Local setup](#local-setup)
- [Browser access and recovery](#browser-access-and-recovery)
- [Device provisioning and enable/disable behavior](#device-provisioning-and-enabledisable-behavior)
- [Deployment and upgrade](#deployment-and-upgrade)
- [Telemetry](#telemetry)
- [Development and verification](#development-and-verification)

## What it does

- Monitors `AHU-01` through `AHU-07`, with configurable installed sensors and up to 12 parameters per unit (`roomTemp`, `supplyTemp`, `returnTemp`, `humidity`, `filterDiffPressure`, `fanSpeed`, `coilTemp`, `damperPosition`, `current`, `voltage`, `runHours`, `heaterOutput`).
- Offers fleet dashboards, side-elevation & schematic equipment visualizations, live charts (5 / 15 / 30 min windows), source-filtered historical reports, streamed CSV exports, and browser print/PDF.
- Evaluates low/high threshold alarms (with configurable activation delay and priority), controller fault alarms (`CRITICAL`), and communication timeout alarms (`HIGH`). Alarm acknowledgement records user + timestamp and never clears an active alarm condition (`FR-15`).
- Computes 15/30-minute linear regression trend proximity warnings (`FR-16`–`FR-18`), explicitly flagging insufficient sample counts, short time spans, or high residual variance (`R² < 0.35`).
- Enforces server-side RBAC across four roles:
  - **`Admin`**: signs in with email and password only; manages users, one-time member tokens, device provisioning, configurations, controls, acknowledgements, and audit logs.
  - **`Engineering`**: signs in via one-time browser token; configures AHU/sensor thresholds, controls simulated units, acknowledges alarms/trends, and views audit logs.
  - **`Operator`**: signs in via one-time browser token; controls simulated units, acknowledges alarms/trends, and views monitoring/reports.
  - **`Viewer`**: signs in via one-time browser token; read-only access to monitoring dashboards, unit details, alarms, trends, and reports.
- Includes a built-in telemetry & command simulator (`SIMULATION` source). Physical commands (`PHYSICAL` source) are locked by default (`403 PHYSICAL_LOCKED`).

The project is informed by `FR-01`–`FR-29` and `NFR-01`–`NFR-09`. By project architecture decision, **Supabase Cloud PostgreSQL + Supabase Auth** replaces the specification's original MySQL + Firebase Realtime Database stack.

## Architecture and limitations

| Component | Implementation |
| --- | --- |
| Web application | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS, Recharts |
| Identity | Supabase Auth for `Admin` email/password; server-verified `ahu_device` bearer cookies for `Engineering`, `Operator`, and `Viewer` |
| Roles and data | Server-side Drizzle ORM queries against the private `ahu_private` PostgreSQL schema on Supabase |
| Sync & live updates | Connected to **Supabase Cloud** (`CLOUD` mode when `NEXT_PUBLIC_SUPABASE_URL` / `DATABASE_URL` points to remote Supabase; `LOCAL` mode only on `localhost`). Browser views poll application APIs every ~5 seconds (`FR-24`) with stale-while-revalidate client caching—Firebase Realtime push is not used |
| Background work | Simulator (`5 s` default) and monitoring (`10 s` default) loops run within the Next.js Node server process |

**Important boundaries:**

- **Why the sync badge shows `Supabase Cloud · HTTP Polling 5s`:** In the original specification (`FR-24`), "Cloud Mode" referred to Firebase Realtime Database push while "Local Mode" referred to ~5-second SQL polling. Because this project stores all data directly in **Supabase Cloud PostgreSQL** and updates the browser via ~5-second HTTP polling (without Firebase), the UI reports **`Supabase Cloud`** (`HTTP Polling · 5s`) when connected to a remote Supabase project and `Local Mode` only when connected to a `localhost` PostgreSQL instance.
- **Simulator & synthetic seed data:** The scheduled simulator is enabled by default (`SIMULATION_ENABLED=false` disables automatic ticks; `SEED_SIMULATED_HISTORY=false` suppresses initial synthetic history on an empty database).
- **Source precedence (`PHYSICAL` vs `SIMULATION`) & disabling devices:**
  - When an enabled `PHYSICAL` device exists for an AHU, `PHYSICAL` telemetry is authoritative for live views, simulated ingestion for that unit is rejected, and the simulator skips it.
  - When no `PHYSICAL` device is enabled and a `SIMULATION` device is enabled, `SIMULATION` telemetry is authoritative.
  - **When all devices for an AHU are disabled** in **Admin -> Devices**, live views (`Dashboard`, `AHU Units`, `AHU Detail`, `Trends`) immediately treat that AHU as **`OFFLINE`** (no active telemetry source) and raise a communication loss alarm, while preserving historical rows in `ahu_private.telemetry` for **Reports & Data Logger**. Re-enabling a simulation device immediately resumes simulation and restores live status.
- **Cloud-only deployment boundary:** There is no separate edge/local SQLite/MySQL fallback database; a network or Supabase outage interrupts monitoring. Background `setInterval` workers assume a persistent Node process (`npm run dev` / `npm start`) rather than stateless serverless functions.
- **Data quality (`NFR-06`):** Current `1 A` and voltage `220 V` sentinel values (unless explicitly marked `quality: "measured"`) are flagged as `ESTIMATED_FALLBACK` and excluded from report averages/min/max, trend regressions, and threshold alarms, while remaining labeled in CSV exports.

## Prerequisites

- Node.js 20.9 or newer (Node 22 LTS recommended) and `npm`.
- A Supabase project with **public sign-ups disabled** in Authentication settings, using the PostgreSQL pooler connection string (`sslmode=require`) and keeping `ahu_private` unexposed in the public Data API.

## Local setup

1. Install dependencies:

   ```bash
   npm ci
   ```

2. Copy `.env.example` to `.env.local` and configure your Supabase credentials:
   - `DATABASE_URL` (PostgreSQL connection string with `?sslmode=require`)
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (server-only)

3. Run database migrations:

   ```bash
   npm run db:migrate
   ```

4. *(First-time empty database only)* Bootstrap the initial `Admin` account:

   ```powershell
   # Windows PowerShell:
   $env:BOOTSTRAP_ADMIN_EMAIL="admin@example.com"; $env:BOOTSTRAP_ADMIN_PASSWORD="StrongPassword123!"; npm run db:bootstrap-admin
   ```

   ```bash
   # Bash (macOS / Linux / Git Bash):
   BOOTSTRAP_ADMIN_EMAIL="admin@example.com" BOOTSTRAP_ADMIN_PASSWORD="StrongPassword123!" npm run db:bootstrap-admin
   ```

5. Start the development server:

   ```bash
   npm run dev
   ```

## Browser access and recovery

- **Administrator (`Admin`)**: signs in at `/login` (**Administrator** tab) with **email and password only** (no browser token needed).
- **Non-Admin roles (`Engineering`, `Operator`, `Viewer`)**: sign in at `/login` (**Member Token** tab) using a **one-time 64-character hex token** generated by an Administrator in **Users (`/admin?tab=users`)**. Each token is valid for 24 hours to claim one browser session (90-day `ahu_device` cookie). Signing out revokes that browser cookie, requiring a new token from an Administrator.

### Changing or resetting an Administrator password

1. **From the Web UI (when signed in as Admin):**
   Open **Users (`/admin?tab=users`)** -> **Change Admin password**, select the Administrator account, enter the new password (8+ characters), and click **Update Admin password**.

2. **From Terminal (Windows PowerShell, CMD, macOS, or Linux):**
   `scripts/reset-admin.mjs` accepts direct CLI arguments so you do not need shell-specific environment variable syntax:

   ```powershell
   # Reset password when only one Admin account exists:
   npm run db:reset-admin -- <new_password>

   # Reset password for a specific Admin email:
   npm run db:reset-admin -- <admin_email> <new_password>
   ```

   *(Environment variables are also supported: in PowerShell use `$env:BOOTSTRAP_ADMIN_EMAIL="..."; $env:BOOTSTRAP_ADMIN_PASSWORD="..."; npm run db:reset-admin`; in Bash use `BOOTSTRAP_ADMIN_EMAIL="..." BOOTSTRAP_ADMIN_PASSWORD="..." npm run db:reset-admin`.)*

## Device provisioning and enable/disable behavior

Administrators manage telemetry sources in **Devices (`/admin?tab=devices`)**:

- **Provisioning (`FR-21`)**: issues a bearer token (`phy_<ahu>_...` or `sim_<ahu>_...`) bound to a specific AHU (`AHU-01`–`AHU-07`) and source type (`PHYSICAL` or `SIMULATION`).
- **Disable / Enable**:
  - Disabling a device immediately blocks new telemetry ingestion using its token and updates the AHU's live status. If an AHU has **no enabled devices remaining**, it immediately transitions to **`OFFLINE`** across the Dashboard and unit views.
  - Re-enabling a `SIMULATION` device immediately triggers a fresh simulation reading and restores the unit's live operating status.

## Deployment and upgrade

Run database migrations before building and starting the production Node server:

```bash
npm run db:migrate
npm run build
npm start
```

## Telemetry

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

Duplicate resends with the same `(ahuId, messageId)` are safely deduplicated (`FR-23`) without duplicating history or falsifying heartbeat freshness.

## Development and verification

```bash
npm run typecheck
npm test
npm run build
```
