import { test } from "node:test";
import { strict as assert } from "node:assert";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";

test("unit, metric and window filters change only fictional data", async () => {
  const dom = new JSDOM(
    "<!doctype html><div id='root'></div>",
    { url: "http://localhost" },
  );

  const g = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };

  const original = {
    window: g.window,
    document: g.document,
    navigator: g.navigator,
    self: g.self,
    act: g.IS_REACT_ACT_ENVIRONMENT,
    fetch: g.fetch,
  };

  let requests = 0;

  Object.assign(g, {
    window: dom.window,
    document: dom.window.document,
    self: dom.window,
    IS_REACT_ACT_ENVIRONMENT: true,

    fetch: async () => {
      requests++;
      throw new Error("Unexpected request");
    },
  });

  Object.defineProperty(g, "navigator", {
    value: dom.window.navigator,
    configurable: true,
    writable: true,
  });

  const { createRoot } = await import("react-dom/client");

  const { default: Analytics } =
    await import("../src/components/FictionalAnalytics");

  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);

  async function choose(index: number, value: string) {
    const select = container.querySelectorAll("select")[index];

    assert.ok(select);

    await act(async () => {
      select.value = value;

      select.dispatchEvent(
        new dom.window.Event("change", { bubbles: true }),
      );
    });
  }

  try {
    await act(async () => {
      root.render(
        createElement(Analytics, { section: "energy" }),
      );
    });

    assert.match(
      container.textContent ?? "",
      /Fixed invented values for AHU-01/,
    );

    await choose(0, "AHU-02");

    assert.match(
      container.textContent ?? "",
      /Fixed invented values for AHU-02/,
    );

    assert.match(
      container.textContent ?? "",
      /Example voltageUnavailable/,
    );

    await choose(1, "voltage");
    await choose(2, "3");

    assert.equal(
      container.querySelectorAll("tbody tr").length,
      3,
    );

    assert.match(
      container.textContent ?? "",
      /1 included, 2 missing/,
    );

    assert.equal(
      container.querySelectorAll("svg line").length,
      0,
    );

    assert.equal(requests, 0);
  } finally {
    await act(async () => {
      root.unmount();
    });

    g.window = original.window;
    g.document = original.document;
    g.self = original.self;
    g.IS_REACT_ACT_ENVIRONMENT = original.act;
    g.fetch = original.fetch;

    Object.defineProperty(g, "navigator", {
      value: original.navigator,
      configurable: true,
      writable: true,
    });

    dom.window.close();
  }
});