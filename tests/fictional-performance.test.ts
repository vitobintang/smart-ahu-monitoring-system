import { test } from "node:test";
import { equal, match, ok } from "node:assert/strict";
import React, { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";

import SimulatorPage from "../src/app/simulator/page";
import FictionalPerformance, {
  makeExamplePoints,
} from "../src/components/FictionalPerformance";

test("fictional windows select consecutive one-minute example points", () => {
  for (const window of [5, 15, 30] as const) {
    const points = makeExamplePoints(29, window);

    equal(points.length, window);
    equal(points[0].minute, 30 - window);
    equal(points[points.length - 1].minute, 29);
  }

  equal(
    makeExamplePoints(29, 5).filter((point) => point.running).length,
    4,
  );

  equal(
    makeExamplePoints(29, 30).filter((point) => point.running).length,
    24,
  );
});

test("chart preview is explicitly fictional with no automatic playback", () => {
  const html = renderToStaticMarkup(
    React.createElement(FictionalPerformance),
  );

  match(html, /not live telemetry/);
  match(html, /no automatic playback or timer/);
  match(html, /4 of 5 fictional samples marked RUN/);
  equal((html.match(/role="img"/g) ?? []).length, 3);
});

test("simulator page includes both sample and chart sections", () => {
  const html = renderToStaticMarkup(
    React.createElement(SimulatorPage),
  );

  match(html, /Generate a sample/);
  match(html, /Performance examples/);
});

test("window selection, pause, advance and reset remain local", async () => {
  const dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>",
    { url: "http://localhost/" },
  );

  const saved = {
    window: Object.getOwnPropertyDescriptor(globalThis, "window"),
    self: Object.getOwnPropertyDescriptor(globalThis, "self"),
    document: Object.getOwnPropertyDescriptor(globalThis, "document"),
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
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

  Object.defineProperty(globalThis, "self", {
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
      root.render(React.createElement(FictionalPerformance));
    });

    match(container.textContent!, /Fictional minute 29; showing 5/);

    await act(async () => {
      button("15 minutes").click();
    });

    equal(button("15 minutes").getAttribute("aria-pressed"), "true");
    match(container.textContent!, /showing 15 one-minute/);

    await act(async () => {
      button("30 minutes").click();
    });

    match(container.textContent!, /24 of 30 fictional samples/);

    await act(async () => {
      button("Pause example").click();
    });

    ok(button("Advance example").disabled);

    await act(async () => {
      button("Advance example").click();
    });

    match(container.textContent!, /Fictional minute 29/);

    await act(async () => {
      button("Resume example").click();
    });

    await act(async () => {
      button("Advance example").click();
    });

    match(container.textContent!, /Fictional minute 30/);

    await act(async () => {
      button("Reset chart example").click();
    });

    match(container.textContent!, /Fictional minute 29; showing 5/);
    equal(button("5 minutes").getAttribute("aria-pressed"), "true");
    equal(requests, 0);
  } finally {
    await act(async () => {
      root.unmount();
    });

    dom.window.close();

    for (const [key, descriptor] of [
      ["window", saved.window],
      ["self", saved.self],
      ["document", saved.document],
      ["navigator", saved.navigator],
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