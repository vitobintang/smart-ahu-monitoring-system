"use client";

import React, { useState } from "react";
import Link from "next/link";

type Section = "admin" | "audit";
type AdminTab = "users" | "access" | "telemetry";

const card =
  "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";

const button =
  "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600";

const disabled =
  "cursor-not-allowed rounded-lg bg-slate-200 px-3 py-2 text-sm font-semibold text-slate-500";

const rows = [
  {
    id: "sample-1",
    time: "Example time 09:00",
    action: "Sign-in",
    actor: "Example user A",
    entity: "Example browser",
    detail: "Invented sign-in event for layout practice.",
  },
  {
    id: "sample-2",
    time: "Example time 10:00",
    action: "Configuration",
    actor: "Example user B",
    entity: "Example AHU",
    detail: "Invented configuration event for layout practice.",
  },
  {
    id: "sample-3",
    time: "Example time 11:00",
    action: "Report export",
    actor: "Example user A",
    entity: "Example report",
    detail: "Invented report event for layout practice.",
  },
] as const;

function DisabledAction({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <button type="button" disabled className={disabled}>
      {children}
    </button>
  );
}

function Administration() {
  const [tab, setTab] = useState<AdminTab>("users");

  const tabs: { id: AdminTab; label: string }[] = [
    { id: "users", label: "Users" },
    { id: "access", label: "Browser access" },
    { id: "telemetry", label: "Telemetry devices" },
  ];

  return (
    <div className="mt-6 space-y-5">
      <section className={card}>
        <h2 className="text-lg font-bold text-[#12294d]">
          Administration areas
        </h2>

        <p className="mt-1 text-sm leading-6 text-slate-600">
          Explore invented examples only. No account, browser or
          device information is loaded.
        </p>

        <div
          aria-label="Administration sections"
          className="mt-4 flex flex-wrap gap-2"
        >
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={tab === item.id}
              className={`${button} ${
                tab === item.id
                  ? "border-blue-700 bg-blue-50 text-blue-800"
                  : ""
              }`}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      {tab === "users" && (
        <section className={card}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-[#12294d]">
                Fictional users
              </h2>

              <p className="mt-1 text-sm text-slate-600">
                These invented rows are not actual accounts or
                permissions.
              </p>
            </div>

            <DisabledAction>
              Create real user unavailable
            </DisabledAction>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[380px] text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
                <tr>
                  <th scope="col" className="px-3 py-2">
                    Example
                  </th>

                  <th scope="col" className="px-3 py-2">
                    Example role
                  </th>
                </tr>
              </thead>

              <tbody className="text-slate-700">
                <tr className="border-b border-slate-100">
                  <td className="px-3 py-3">Example user A</td>
                  <td className="px-3 py-3">Viewer</td>
                </tr>

                <tr>
                  <td className="px-3 py-3">Example user B</td>
                  <td className="px-3 py-3">Engineering</td>
                </tr>
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-xs text-slate-600">
            Role changes, password resets and account deactivation
            are not available here.
          </p>
        </section>
      )}

      {tab === "access" && (
        <section className={card}>
          <h2 className="text-lg font-bold text-[#12294d]">
            Browser access
          </h2>

          <p className="mt-2 text-sm leading-6 text-slate-600">
            The planned sign-in design requires an Admin-issued
            browser authorization in addition to the user account.
            No invitations or browser authorizations can be issued,
            viewed or revoked here.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <DisabledAction>
              Issue real invitation unavailable
            </DisabledAction>

            <DisabledAction>
              Revoke real access unavailable
            </DisabledAction>
          </div>
        </section>
      )}

      {tab === "telemetry" && (
        <section className={card}>
          <h2 className="text-lg font-bold text-[#12294d]">
            Telemetry devices
          </h2>

          <p className="mt-2 text-sm leading-6 text-slate-600">
            Telemetry device credentials identify data sources and
            are separate from user browser access. No real devices
            or credentials are shown or managed here.
          </p>

          <div className="mt-4">
            <DisabledAction>
              Provision real device unavailable
            </DisabledAction>
          </div>
        </section>
      )}
    </div>
  );
}

function Audit() {
  const [action, setAction] = useState("All actions");
  const [open, setOpen] = useState<string | null>(null);

  const visible = rows.filter(
    (row) => action === "All actions" || row.action === action,
  );

  return (
    <div className="mt-6 space-y-5">
      <section className={card}>
        <h2 className="text-lg font-bold text-[#12294d]">
          Fictional audit examples
        </h2>

        <p className="mt-1 text-sm leading-6 text-slate-600">
          These invented rows are not audit records. No real audit
          feed is connected.
        </p>

        <label className="mt-4 block max-w-xs text-sm font-semibold text-slate-700">
          Filter example action

          <select
            value={action}
            onChange={(event) => {
              setAction(event.target.value);
              setOpen(null);
            }}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            <option>All actions</option>
            <option>Sign-in</option>
            <option>Configuration</option>
            <option>Report export</option>
          </select>
        </label>

        <p aria-live="polite" className="mt-3 text-sm text-slate-600">
          {visible.length} fictional{" "}
          {visible.length === 1 ? "row" : "rows"}
        </p>
      </section>

      <section
        className={`${card} overflow-x-auto`}
        aria-label="Fictional audit table"
      >
        <table className="w-full min-w-[650px] text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
            <tr>
              <th scope="col" className="px-3 py-2">
                Example time
              </th>

              <th scope="col" className="px-3 py-2">
                Action
              </th>

              <th scope="col" className="px-3 py-2">
                Actor
              </th>

              <th scope="col" className="px-3 py-2">
                Entity
              </th>

              <th scope="col" className="px-3 py-2">
                Details
              </th>
            </tr>
          </thead>

          <tbody className="text-slate-700">
            {visible.map((row) => (
              <React.Fragment key={row.id}>
                <tr className="border-b border-slate-100">
                  <td className="px-3 py-3">{row.time}</td>
                  <td className="px-3 py-3">{row.action}</td>
                  <td className="px-3 py-3">{row.actor}</td>
                  <td className="px-3 py-3">{row.entity}</td>

                  <td className="px-3 py-3">
                    <button
                      type="button"
                      className={button}
                      aria-expanded={open === row.id}
                      aria-label={`Details for ${row.action} example`}
                      onClick={() =>
                        setOpen(open === row.id ? null : row.id)
                      }
                    >
                      {open === row.id ? "Hide" : "Show"}
                    </button>
                  </td>
                </tr>

                {open === row.id && (
                  <tr>
                    <td colSpan={5} className="bg-blue-50 px-3 py-3">
                      {row.detail}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

export default function AdministrationPreview({
  section,
}: {
  section: Section;
}) {
  return (
    <main
      className="min-h-screen bg-[#eef3fa] px-4 py-6 text-slate-900 sm:px-8"
      style={{ colorScheme: "light" }}
    >
      <div className="mx-auto max-w-7xl">
        <Link
          href="/"
          className="inline-block rounded text-sm font-semibold text-blue-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          <span aria-hidden="true">← </span>
          Back to dashboard
        </Link>

        <header className="mt-6 border-b border-slate-200 pb-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-blue-700">
            Development preview
          </p>

          <h1 className="mt-2 text-3xl font-bold tracking-tight text-[#12294d] sm:text-4xl">
            {section === "admin"
              ? "User & device administration"
              : "Audit log"}
          </h1>

          <p className="mt-2 text-sm text-slate-600">
            Explore the reference-inspired layout with fictional
            examples.
          </p>
        </header>

        <section
          aria-label="Development notice"
          className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950"
        >
          <strong>Not operational:</strong> This page is not protected
          by login. No real users, devices or audit records are loaded
          or changed. Authorization and audit logging are not
          implemented here.
        </section>

        {section === "admin" ? <Administration /> : <Audit />}
      </div>
    </main>
  );
}