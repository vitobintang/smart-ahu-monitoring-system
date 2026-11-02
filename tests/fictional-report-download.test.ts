import { test } from "node:test";
import { strict as assert } from "node:assert";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";

test("fictional CSV download follows the visible example filters", async () => {
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

  function csv() {
    const link = container.querySelector<HTMLAnchorElement>("a[download]");
    assert.ok(link);

    const href = link.getAttribute("href");
    const prefix = "data:text/csv;charset=utf-8,";

    assert.ok(href);
    assert.ok(href.startsWith(prefix));

    const decoded = decodeURIComponent(href.slice(prefix.length));
    assert.ok(decoded.startsWith("\uFEFF"));

    return { link, body: decoded.slice(1) };
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

    let result = csv();

    assert.equal(
      result.link.download,
      "fictional-room-temperature-AHU-01.csv",
    );
    assert.match(
      result.body,
      /"2026-01-01T09:00:00\.000Z","20","INCLUDED"/,
    );
    assert.match(
      result.body,
      /"2026-01-01T13:00:00\.000Z","","ESTIMATED - EXCLUDED"/,
    );
    assert.doesNotMatch(result.body, /"26"/);

    await choose("#report-example-window", "LATE");
    result = csv();

    assert.match(
      result.body,
      /"Start UTC \(inclusive\)","2026-01-01T12:00:00\.000Z"/,
    );
    assert.match(
      result.body,
      /"2026-01-01T12:00:00\.000Z","24","INCLUDED"/,
    );
    assert.doesNotMatch(
      result.body,
      /"2026-01-01T09:00:00\.000Z","20"/,
    );

    await choose("#report-example-ahu", "AHU-02");
    result = csv();

    assert.equal(
      result.link.download,
      "fictional-room-temperature-AHU-02.csv",
    );
    assert.match(
      result.body,
      /"2026-01-01T12:30:00\.000Z","23","INCLUDED"/,
    );
    assert.doesNotMatch(
      result.body,
      /"2026-01-01T12:00:00\.000Z","24"/,
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