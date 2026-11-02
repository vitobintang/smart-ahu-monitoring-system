import { test } from "node:test";
import { strict as assert } from "node:assert";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";

test("fictional chart follows the report filters", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "http://localhost",
  });

  const g = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };

  const original = {
    window: g.window,
    document: g.document,
    navigator: g.navigator,
    self: g.self,
    act: g.IS_REACT_ACT_ENVIRONMENT,
  };

  Object.assign(g, {
    window: dom.window,
    document: dom.window.document,
    self: dom.window,
    IS_REACT_ACT_ENVIRONMENT: true,
  });

  Object.defineProperty(g, "navigator", {
    value: dom.window.navigator,
    configurable: true,
    writable: true,
  });

  const { createRoot } = await import("react-dom/client");
  const { default: ReportFilterExample } =
    await import("../src/components/ReportFilterExample");

  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(createElement(ReportFilterExample));
    });

    assert.equal(container.querySelectorAll("tbody tr").length, 5);
    assert.equal(container.querySelectorAll("circle").length, 3);

    const windowSelect = container.querySelector<HTMLSelectElement>(
      "#report-example-window",
    );

    assert.ok(windowSelect);

    await act(async () => {
      windowSelect.value = "LATE";
      windowSelect.dispatchEvent(
        new dom.window.Event("change", { bubbles: true }),
      );
    });

    assert.equal(container.querySelectorAll("tbody tr").length, 2);
    assert.equal(container.querySelectorAll("circle").length, 1);
    assert.match(container.textContent ?? "", /ESTIMATED · excluded/);

    const unitSelect = container.querySelector<HTMLSelectElement>(
      "#report-example-ahu",
    );

    assert.ok(unitSelect);

    await act(async () => {
      unitSelect.value = "AHU-02";
      unitSelect.dispatchEvent(
        new dom.window.Event("change", { bubbles: true }),
      );
    });

    assert.equal(container.querySelectorAll("tbody tr").length, 1);
    assert.equal(container.querySelectorAll("circle").length, 1);
    assert.match(
      container.textContent ?? "",
      /2026-01-01T12:30:00.000Z/,
    );
    assert.doesNotMatch(
      container.textContent ?? "",
      /2026-01-01T13:00:00.000Z/,
    );
  } finally {
    await act(async () => {
      root.unmount();
    });

    g.window = original.window;
    g.document = original.document;
    g.self = original.self;
    g.IS_REACT_ACT_ENVIRONMENT = original.act;

    Object.defineProperty(g, "navigator", {
      value: original.navigator,
      configurable: true,
      writable: true,
    });

    dom.window.close();
  }
});