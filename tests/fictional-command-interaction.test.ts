import { test } from "node:test";
import { doesNotMatch, equal, match, ok } from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";

import FictionalControl from "../src/components/FictionalControl";

test("command practice interacts locally and does not send requests", async () => {
  const dom = new JSDOM(
    "<!doctype html><div id='root'></div>",
    { url: "http://localhost/" },
  );

  const saved = {
    window: Object.getOwnPropertyDescriptor(globalThis, "window"),
    document: Object.getOwnPropertyDescriptor(globalThis, "document"),
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
    self: Object.getOwnPropertyDescriptor(globalThis, "self"),
    act: Object.getOwnPropertyDescriptor(
      globalThis,
      "IS_REACT_ACT_ENVIRONMENT",
    ),
    fetch: globalThis.fetch,
  };

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: dom.window,
  });

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: dom.window.document,
  });

  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: dom.window.navigator,
  });

  Object.defineProperty(globalThis, "self", {
    configurable: true,
    value: dom.window,
  });

  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
  });

  let requests = 0;

  globalThis.fetch = (async () => {
    requests++;
    throw new Error("Unexpected request");
  }) as typeof fetch;

  const { createRoot } = await import("react-dom/client");
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);

  const button = (text: string) =>
    Array.from(container.querySelectorAll("button")).find(
      (item) => item.textContent === text,
    )!;

  try {
    await act(async () => {
      root.render(React.createElement(FictionalControl));
    });

    ok(button("Simulate matching feedback").disabled);

    await act(async () => {
      button("Request example START").click();
    });

    match(container.textContent!, /Active example: START.*REQUESTED/);

    await act(async () => {
      button("Request example STOP").click();
    });

    match(container.textContent!, /another example is active/);

    await act(async () => {
      button("Simulate acceptance").click();
    });

    match(container.textContent!, /Active example: START.*ACCEPTED/);

    await act(async () => {
      button("Simulate matching feedback").click();
    });

    match(container.textContent!, /START.*SUCCEEDED \(fictional\)/);

    await act(async () => {
      button("Request example STOP").click();
    });

    await act(async () => {
      button("Advance example clock 30 seconds").click();
    });

    await act(async () => {
      button("Advance example clock 30 seconds").click();
    });

    match(container.textContent!, /STOP.*EXPIRED \(fictional\)/);

    const role =
      container.querySelectorAll<HTMLSelectElement>("select")[0];

    // Tampered/unknown role values are ignored by the role select (Viewer was
    // removed) — the previous role stays active and the request still succeeds.
    await act(async () => {
      role.value = "Viewer";
      role.dispatchEvent(
        new dom.window.Event("change", { bubbles: true }),
      );
    });

    await act(async () => {
      button("Request example START").click();
    });

    doesNotMatch(
      container.textContent!,
      /fictional role cannot issue commands/,
    );
    match(
      container.textContent!,
      /Example requested; nothing was sent\./,
    );

    await act(async () => {
      button("Reset command example").click();
    });

    match(container.textContent!, /No finished examples/);
    equal(requests, 0);
  } finally {
    await act(async () => {
      root.unmount();
    });

    dom.window.close();

    for (const [key, descriptor] of [
      ["window", saved.window],
      ["document", saved.document],
      ["navigator", saved.navigator],
      ["self", saved.self],
      ["IS_REACT_ACT_ENVIRONMENT", saved.act],
    ] as const) {
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
      } else {
        Reflect.deleteProperty(globalThis, key);
      }
    }

    globalThis.fetch = saved.fetch;
  }
});