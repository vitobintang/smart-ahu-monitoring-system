"use client";

import { useState } from "react";

import {
  initialExampleState,
  requestExample,
  acceptExample,
  confirmExample,
  failExample,
  advanceExampleClock,
  type ExampleCommandType,
  type ExampleRole,
  type ExampleStatus,
} from "../lib/fictional-command";

const roles: ExampleRole[] = [
  "Admin",
  "Engineering",
  "Operator",
];

const statuses: ExampleStatus[] = [
  "RUN",
  "STOP",
  "FAULT",
  "OFFLINE",
];

const commands: ExampleCommandType[] = [
  "START",
  "STOP",
  "AUTO",
  "MANUAL",
  "SETPOINT",
];

const button =
  "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600";

export default function FictionalControl() {
  const [state, setState] = useState(initialExampleState);
  const [setpoint, setSetpoint] = useState("22");

  return (
    <section
      aria-labelledby="fictional-control-heading"
      className="mt-6 rounded-2xl border border-violet-200 bg-white p-5 shadow-sm sm:p-6"
    >
      <h2
        id="fictional-control-heading"
        className="text-xl font-bold text-[#12294d]"
      >
        Fictional command lifecycle
      </h2>

      <p className="mt-2 text-sm leading-6 text-slate-600">
        Practice only: role, status, clock and feedback are invented.
        This does not authenticate users, enforce real interlocks,
        contact a controller, save commands or control equipment.
        STOP here is not an emergency stop.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <label className="text-sm font-semibold text-slate-700">
          Example role

          <select
            value={state.role}
            onChange={(event) => {
              const role = roles.find(
                (item) => item === event.target.value,
              );

              if (role) {
                setState((current) => ({ ...current, role }));
              }
            }}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
          >
            {roles.map((role) => (
              <option key={role}>{role}</option>
            ))}
          </select>
        </label>

        <label className="text-sm font-semibold text-slate-700">
          Example unit status

          <select
            value={state.status}
            onChange={(event) => {
              const status = statuses.find(
                (item) => item === event.target.value,
              );

              if (status) {
                setState((current) => ({ ...current, status }));
              }
            }}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
          >
            {statuses.map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
        </label>

        <label className="text-sm font-semibold text-slate-700">
          Example setpoint (°C)

          <input
            type="text"
            inputMode="decimal"
            value={setpoint}
            maxLength={8}
            onChange={(event) => setSetpoint(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
          />
        </label>
      </div>

      <p className="mt-2 text-xs leading-5 text-slate-600">
        Example setpoint range 16–30 °C follows the practice scenario,
        not confirmed equipment limits. Changing the example role or
        status does not change actual access or equipment. The example
        role and status are checked only when requesting an example.
      </p>

      <div
        aria-label="Example commands"
        className="mt-4 flex flex-wrap gap-2"
      >
        {commands.map((command) => (
          <button
            key={command}
            type="button"
            onClick={() =>
              setState((current) =>
                requestExample(current, command, setpoint),
              )
            }
            className={button}
          >
            Request example {command}
          </button>
        ))}
      </div>

      <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm font-semibold text-[#12294d]">
          Fictional clock: {state.clock} seconds
        </p>

        <p className="mt-2 text-sm text-slate-700">
          {state.active
            ? `Active example: ${state.active.type}${
                state.active.setpoint === null
                  ? ""
                  : ` (${state.active.setpoint} °C)`
              } · ${state.active.state} · expires at ${
                state.active.expiresAt
              } seconds`
            : "No active example command."}
        </p>

        <p aria-live="polite" className="mt-2 text-sm text-slate-700">
          {state.notice}
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className={button}
            disabled={state.active?.state !== "REQUESTED"}
            onClick={() => setState(acceptExample)}
          >
            Simulate acceptance
          </button>

          <button
            type="button"
            className={button}
            disabled={state.active?.state !== "ACCEPTED"}
            onClick={() => setState(confirmExample)}
          >
            Simulate matching feedback
          </button>

          <button
            type="button"
            className={button}
            disabled={!state.active}
            onClick={() => setState(failExample)}
          >
            Simulate failure
          </button>

          <button
            type="button"
            className={button}
            disabled={state.clock >= 3660}
            onClick={() => setState(advanceExampleClock)}
          >
            Advance example clock 30 seconds
          </button>

          <button
            type="button"
            className={button}
            onClick={() => {
              setState(initialExampleState());
              setSetpoint("22");
            }}
          >
            Reset command example
          </button>
        </div>
      </div>

      <h3 className="mt-5 text-sm font-bold text-[#12294d]">
        Fictional history (last 20)
      </h3>

      {state.history.length === 0 ? (
        <p className="mt-2 text-sm text-slate-600">
          No finished examples.
        </p>
      ) : (
        <ol className="mt-2 list-inside list-decimal space-y-1 text-sm text-slate-700">
          {state.history.map((item, index) => (
            <li key={`${index}-${item.type}-${item.state}`}>
              {item.type} · {item.state} (fictional)
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}