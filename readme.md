# Smart AHU Monitoring System

A Next.js application for monitoring seven air-handling units (AHUs). It records telemetry in Supabase PostgreSQL, displays dashboards and reports, evaluates alarms and trends, and includes a simulator. Administrators sign in with Supabase Auth email and password; Engineering, Operator and Viewer roles sign in using one-time browser access tokens issued by an Administrator.

> **Status: prototype, not a commissioned industrial control system.** Physical control commands are disabled. The web STOP button is **not** an emergency stop. Independent local safety interlocks, control hardware, communications, failover, access security and operational procedures must be designed and validated by qualified professionals. Do not use this software to protect people or equipment.

## Contents

- [What it does](#what-it-does)
- [Architecture and limitations](#architecture-and-limitations)
- [Prerequisites](#prerequisites)
- [Local setup](#local-setup)
- [Browser access and recovery](#browser-access-and-recovery)
- [Deployment and upgrade](#deployment-and-upgrade)
- [Telemetry](#telemetry)
- [Development and verification](#development-and-verification)

## What it does

- Monitors AHU-01 through AHU-07, with configurable installed sensors and up to 12 readings per unit.
- Offers dashboards, histories, source-filtered reports, CSV downloads, and browser print/PDF.
- Records threshold, fault and communication alarms; acknowledgement is separate from resolution. Trend proximity uses regression, not an AI prediction of equipment failure.
- Uses four server-checked roles: Admin, Engineering, Operator and Viewer. Admin signs in with email and password only; Admin creates non-Admin members and issues/revokes one-time access tokens (no email or password needed for non-Admin roles).
- Includes an experimental simulator and simulated command workflow. Physical commands are always rejected; an environment variable cannot unlock them.

The project is informed by FR-01–FR-29 and NFR-01–NFR-09, but **full compliance has not been demonstrated**. Supabase replaces the specification's MySQL/Firebase choices by project decision. See the limitations below before any deployment.

## Architecture and limitations

| Component | Implementation |
| --- | --- |
| Web application | Next.js, React, TypeScript, Tailwind CSS, Recharts |
| Identity | Supabase Auth; public sign-up should be disabled |
| Roles and data | Server-side Drizzle queries against the private `ahu_private` PostgreSQL schema |
| Live updates | Browser polling of application APIs, approximately every 5 seconds—not a push service |
| Background work | Simulator and monitoring loops run within the Next.js Node process |

**Important boundaries:**

- The scheduled simulator is enabled by default. Set `SIMULATION_ENABLED=false` to stop its automatic ticks; the manual simulator endpoint remains available to authorized operators. Set `SEED_SIMULATED_HISTORY=false` to suppress example history on first startup. On a fresh empty database by default the application seeds sample AHUs, simulation devices and approximately 75 minutes of **synthetic** history. This is demonstration data, not a record of actual equipment. Simulation overrides are process-local.
- When an enabled physical device exists for an AHU, simulated ingestion for that unit is rejected, the simulator skips it, and live status/trend queries select physical data. Reports can explicitly include either or both sources; use the source filter to avoid mixing them. Switching the enabled source changes which history is authoritative for live views. Existing alarms and alarm timers are not source-tagged or automatically reset on a source change, so old simulation alarms can still influence the displayed status; review this limitation and resolve it before real-equipment use.
- There is no independent local/offline database or local controller fallback in this cloud-only implementation. A Supabase, network or app outage can interrupt monitoring. Browser polling is not guaranteed delivery. The background loops can stop or duplicate on serverless/multiple instances, and delayed notifications are not guaranteed. A durable, independently supervised worker and operational failover are needed for reliable operation.
- When fresh telemetry has neither running state nor fan speed, or reports contradictory state and speed, the display fails closed as OFFLINE rather than inferring a STOP. OFFLINE in this case means unavailable/invalid state, not necessarily a communication outage. Alarm timers and login throttling are stored in PostgreSQL, but the complete alarm/monitoring system has not been load-tested, fault-tested or commissioned. In-app notifications do not provide email, SMS or closed-app alerts. Audit logging is application-level; privileged database users can modify it.
- Current `1 A` and voltage `220 V` are treated as legacy fallback values unless the sender explicitly identifies them as measured. Fallback values are excluded from report statistics, report buckets, trend estimates and threshold calculations, but retained and labeled in CSV. Reports are limited to a 31-day range. CSV is streamed in batches without the former 20,000-row cap; concurrent writes mean it is not a point-in-time snapshot.
- App browser credentials are revocable bearer cookies, **not hardware-bound authentication or a replacement for MFA**. Anyone who copies a valid cookie may be able to use it. Protect the browser and deliver enrollment tokens privately. Rate limiting is per account in the database; use a trusted reverse proxy, platform-level IP throttling and Supabase protections too.
- The code and migrations have not been tested end-to-end with the live Supabase project, against real devices, or under production load. A green build does not establish specification compliance or safety.

## Prerequisites

- Node.js 20.9 or newer (Node 22 LTS recommended) and npm.
- A Supabase project. Disable **public sign-ups** in its Authentication settings. Note the project URL, publishable key, server-only service-role key, and PostgreSQL **session pooler** connection string. Keep `ahu_private` out of the exposed Data API schemas.
- A local copy of this repository. Commands below are run in a terminal in its folder. Environment files and keys are secret; never commit or send them in chat.

## Local setup

1. Install packages:

   ```bash
   npm ci