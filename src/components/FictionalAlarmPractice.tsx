"use client";

import React, { useReducer } from "react";

import {
  exampleAlarmReducer,
  initialExampleAlarmState,
  type ExampleCondition,
} from "../lib/fictional-alarm";

const button =
  "rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600";

export default function FictionalAlarmPractice() {
  const [state, dispatch] = useReducer(
    exampleAlarmReducer,
    undefined,
    initialExampleAlarmState,
  );

  const active = state.alarms.find(
    (alarm) => alarm.resolvedAt === null,
  );

  const conditions: {
    value: ExampleCondition;
    label: string;
  }[] = [
    { value: "NORMAL", label: "Normal example" },
    { value: "HIGH", label: "High example" },
    { value: "UNKNOWN", label: "Unknown example" },
  ];

  return (
    <section
      aria-labelledby="practice-title"
      className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
    >
      <h2
        id="practice-title"
        className="text-xl font-bold text-[#12294d]"
      >
        Fictional lifecycle exercise
      </h2>

      <p className="mt-2 text-sm leading-6 text-slate-600">
        Choose High, then advance the example clock twice. After 20
        fictional seconds, an example alarm appears. Acknowledging it
        does not resolve it; choose Normal to demonstrate recovery.
        Unknown cancels a pending delay but does not resolve an active
        example.
      </p>

      <p className="mt-2 text-sm font-semibold text-amber-900">
        Invented condition and delay only. No real thresholds, alarm
        monitoring, notifications, authentication, or equipment
        connection. Do not use for operations.
      </p>

      <fieldset className="mt-5">
        <legend className="text-sm font-semibold text-slate-700">
          Example condition
        </legend>

        <div className="mt-2 flex flex-wrap gap-2">
          {conditions.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              className={button}
              aria-pressed={state.condition === value}
              onClick={() =>
                dispatch({ type: "condition", value })
              }
            >
              {label}
              {state.condition === value ? " (selected)" : ""}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className={button}
          onClick={() => dispatch({ type: "advance" })}
        >
          Advance example 10 seconds
        </button>

        <button
          type="button"
          className={button}
          onClick={() => dispatch({ type: "reset" })}
        >
          Reset exercise
        </button>
      </div>

      <div
        aria-live="polite"
        className="mt-5 rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-800"
      >
        <p>Example clock: {state.seconds} seconds</p>

        <p>Example condition: {state.condition}</p>

        <p>
          Example state:{" "}
          {active
            ? "ACTIVE"
            : state.pendingSince !== null
              ? "PENDING"
              : "NO ACTIVE EXAMPLE"}
        </p>

        {state.pendingSince !== null && (
          <p>
            Example delay: {state.seconds - state.pendingSince} / 20
            seconds
          </p>
        )}

        <p>Real alarm status remains unknown.</p>
      </div>

      <h3 className="mt-6 font-bold text-[#12294d]">
        Example history
      </h3>

      <p className="mt-1 text-sm text-slate-600">
        Newest first, up to 10. Memory only; reset or reload removes it.
      </p>

      {state.alarms.length === 0 ? (
        <p className="mt-3 text-sm text-slate-600">
          No example alarms yet.
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {state.alarms.map((alarm) => (
            <li
              key={alarm.id}
              className="rounded-xl border border-slate-200 p-4 text-sm text-slate-800"
            >
              <p className="font-bold">
                Example #{alarm.id} —{" "}
                {alarm.resolvedAt === null ? "ACTIVE" : "RESOLVED"}
              </p>

              <p>
                Activated at example second {alarm.activatedAt}.
              </p>

              <p>
                {alarm.resolvedAt === null
                  ? "Not resolved."
                  : `Resolved at example second ${alarm.resolvedAt}.`}
              </p>

              <p>
                {alarm.acknowledgedAt === null
                  ? "Not acknowledged."
                  : `Acknowledged at example second ${alarm.acknowledgedAt}.`}
              </p>

              {alarm.acknowledgedAt === null && (
                <button
                  type="button"
                  className={`${button} mt-3`}
                  onClick={() =>
                    dispatch({
                      type: "acknowledge",
                      id: alarm.id,
                    })
                  }
                >
                  Acknowledge example #{alarm.id}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}