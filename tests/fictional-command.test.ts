import { test } from "node:test";
import { equal, match } from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import FictionalControl from "../src/components/FictionalControl";
import {
  initialExampleState,
  requestExample,
  acceptExample,
  confirmExample,
  failExample,
  advanceExampleClock,
} from "../src/lib/fictional-command";

test("fictional roles, statuses and setpoint rules reject examples", () => {
  const state = initialExampleState();

  match(
    requestExample(
      { ...state, role: "Viewer" },
      "START",
      "",
    ).notice,
    /role cannot/,
  );

  match(
    requestExample(
      { ...state, status: "OFFLINE" },
      "STOP",
      "",
    ).notice,
    /OFFLINE/,
  );

  match(
    requestExample(
      { ...state, status: "FAULT" },
      "START",
      "",
    ).notice,
    /only STOP/,
  );

  equal(
    requestExample(
      { ...state, status: "FAULT" },
      "STOP",
      "",
    ).active?.state,
    "REQUESTED",
  );

  for (const text of ["", "15.9", "30.1", "1e1", "NaN", "1,5"]) {
    equal(requestExample(state, "SETPOINT", text).active, null);
  }

  equal(requestExample(state, "SETPOINT", "16").active?.setpoint, 16);
  equal(requestExample(state, "SETPOINT", "30").active?.setpoint, 30);
});

test("one active example, accepted feedback and failure remain fictional", () => {
  const initial = initialExampleState();
  const requested = requestExample(initial, "START", "");

  equal(initial.active, null);
  match(requestExample(requested, "STOP", "").notice, /another example/);
  match(confirmExample(requested).notice, /before fictional confirmation/);

  const accepted = acceptExample(requested);
  equal(accepted.active?.state, "ACCEPTED");

  const done = confirmExample(accepted);
  equal(done.active, null);
  equal(done.history[0].state, "SUCCEEDED");

  equal(failExample(requested).history[0].state, "FAILED");
});

test("example expires at 60 fictional seconds even after acceptance", () => {
  const requested = requestExample(initialExampleState(), "START", "");
  const thirty = advanceExampleClock(acceptExample(requested));

  equal(thirty.active?.state, "ACCEPTED");

  const sixty = advanceExampleClock(thirty);

  equal(sixty.active, null);
  equal(sixty.history[0].state, "EXPIRED");
  match(confirmExample(sixty).notice, /before fictional confirmation/);
});

test("preview is labelled fictional and warns STOP is not an emergency stop", () => {
  const html = renderToStaticMarkup(
    React.createElement(FictionalControl),
  );

  match(html, /Fictional command lifecycle/);
  match(html, /not an emergency stop/);
  match(html, /does not authenticate users/);
});