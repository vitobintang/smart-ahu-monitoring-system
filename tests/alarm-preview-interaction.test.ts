import { test } from "node:test";
import { strict as assert } from "node:assert";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";

test("example filters and reset affect only fictional rows", async () => {
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
  const { default: AlarmPreviewExample } =
    await import("../src/components/AlarmPreviewExample");

  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);

  async function choose(id: string, value: string) {
    const select = container.querySelector<HTMLSelectElement>(id);
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
      root.render(createElement(AlarmPreviewExample));
    });

    assert.equal(container.querySelectorAll("tbody tr").length, 3);
    assert.match(container.textContent ?? "", /3 fictional scenarios shown/);

    await choose("#example-alarm-state", "RESOLVED");

    assert.equal(container.querySelectorAll("tbody tr").length, 1);
    assert.match(container.textContent ?? "", /1 fictional scenario shown/);
    assert.match(container.querySelector("tbody")?.textContent ?? "", /AHU-01/);

    await choose("#example-alarm-priority", "CRITICAL");

    assert.match(container.textContent ?? "", /No fictional scenarios match/);
    assert.match(container.textContent ?? "", /Real alarm status is unavailable/);

    await choose("#example-alarm-unit", "AHU-02");

    assert.match(container.textContent ?? "", /0 fictional scenarios shown/);

    const reset = container.querySelector("button");
    assert.ok(reset);

    await act(async () => {
      reset.click();
    });

    assert.equal(container.querySelectorAll("tbody tr").length, 3);

    for (const id of [
      "#example-alarm-state",
      "#example-alarm-unit",
      "#example-alarm-priority",
    ]) {
      assert.equal(
        container.querySelector<HTMLSelectElement>(id)?.value,
        "ALL",
      );
    }

    await choose("#example-alarm-unit", "AHU-02");
    await choose("#example-alarm-state", "ACTIVE");
    await choose("#example-alarm-priority", "CRITICAL");

    assert.equal(container.querySelectorAll("tbody tr").length, 1);
    assert.match(container.querySelector("tbody")?.textContent ?? "", /AHU-02/);
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