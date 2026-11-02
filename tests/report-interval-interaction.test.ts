import { test } from "node:test";
import { strict as assert } from "node:assert";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";

test("fictional interval table follows unit and window filters", async () => {
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
  const { default: ReportFilterExample } =
    await import("../src/components/ReportFilterExample");

  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);

  function rows() {
    return Array.from(
      container.querySelectorAll(
        '[aria-labelledby="example-intervals-heading"] tbody tr',
      ),
      (row) =>
        Array.from(
          row.querySelectorAll("td"),
          (cell) => cell.textContent?.trim(),
        ),
    );
  }

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
      root.render(createElement(ReportFilterExample));
    });

    let table = rows();

    assert.equal(table.length, 6);
    assert.deepEqual(table[0], [
      "2026-01-01T09:00:00.000Z",
      "2026-01-01T10:00:00.000Z",
      "1",
      "0",
      "20 / 20",
      "20.0",
    ]);
    assert.deepEqual(table[2].slice(2), [
      "0", "1", "Unavailable", "Unavailable",
    ]);
    assert.deepEqual(table[4].slice(2), [
      "0", "1", "Unavailable", "Unavailable",
    ]);
    assert.deepEqual(table[5].slice(2), [
      "0", "0", "Unavailable", "Unavailable",
    ]);
    assert.ok(container.querySelector("a[download]"));

    await choose("#report-example-window", "LATE");
    table = rows();

    assert.equal(table.length, 3);
    assert.deepEqual(table[0].slice(2), ["1", "0", "24 / 24", "24.0"]);

    await choose("#report-example-ahu", "AHU-02");
    table = rows();

    assert.equal(table.length, 3);
    assert.deepEqual(table[0].slice(2), ["1", "0", "23 / 23", "23.0"]);
    assert.deepEqual(table[1].slice(2), [
      "0", "0", "Unavailable", "Unavailable",
    ]);
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