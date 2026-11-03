import { test } from "node:test";
import { strict as assert } from "node:assert";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";

test("practice controls change only the in-memory example", async () => {
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

  const { default: Practice } =
    await import("../src/components/FictionalAlarmPractice");

  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);

  async function click(text: string) {
    const button = Array.from(
      container.querySelectorAll("button"),
    ).find((item) => item.textContent?.includes(text));

    assert.ok(button, `Missing button: ${text}`);

    await act(async () => {
      button.click();
    });
  }

  try {
    await act(async () => {
      root.render(createElement(Practice));
    });

    await click("High example");
    await click("Advance example");
    assert.match(container.textContent ?? "", /PENDING/);

    await click("Advance example");
    assert.match(
      container.textContent ?? "",
      /Example #1 — ACTIVE/,
    );

    await click("Acknowledge example #1");

    assert.match(
      container.textContent ?? "",
      /Example #1 — ACTIVE/,
    );

    assert.match(
      container.textContent ?? "",
      /Acknowledged at example second 20/,
    );

    await click("Unknown example");

    assert.match(
      container.textContent ?? "",
      /Example #1 — ACTIVE/,
    );

    await click("Normal example");

    assert.match(
      container.textContent ?? "",
      /Example #1 — RESOLVED/,
    );

    await click("Reset exercise");

    assert.match(
      container.textContent ?? "",
      /No example alarms yet/,
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