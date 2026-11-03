import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createElement, act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";

import HistoricalFleetPanel from "../src/components/HistoricalFleetPanel";

test("fleet panel initially discloses limitations and shows no data", () => {
  const html = renderToStaticMarkup(
    createElement(HistoricalFleetPanel),
  );

  assert.match(html, /not live status/i);
  assert.match(html, /not protected by login/i);
  assert.match(html, /No request is made automatically/);
  assert.doesNotMatch(html, /<tbody/);
});

test("manual fleet read, filters, failures and privacy stay safe with mocked responses", async () => {
  const dom = new JSDOM(
    "<!doctype html><div id='root'></div>",
    {
      url: "http://localhost",
      pretendToBeVisual: true,
    },
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

  const requests: {
    input: RequestInfo | URL;
    init?: RequestInit;
    resolve: (response: Response) => void;
  }[] = [];

  Object.assign(g, {
    window: dom.window,
    document: dom.window.document,
    self: dom.window,
    IS_REACT_ACT_ENVIRONMENT: true,

    fetch: (input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((resolve) => {
        requests.push({ input, init, resolve });
      }),
  });

  Object.defineProperty(g, "navigator", {
    value: dom.window.navigator,
    configurable: true,
    writable: true,
  });

  const { createRoot } = await import("react-dom/client");

  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);

  const row = (
    ahuId: string,
    source: "PHYSICAL" | "SIMULATION",
    temperature: number,
  ) => ({
    ahuId,
    configuredSource: source,
    observedSource: source,
    measuredAt: "2026-01-01T10:00:00.000Z",
    timestampStatus: "past_or_present",
    roomTemp: { configured: true, value: temperature },
    humidity: { configured: false, value: null },
  });

  const normal = {
    observations: [
      row("AHU-02", "SIMULATION", 25),
      row("AHU-01", "PHYSICAL", 20),
    ],
  };

  async function click(label: string) {
    const button = Array.from(
      container.querySelectorAll("button"),
    ).find((item) => item.textContent?.includes(label));

    assert.ok(button, `Missing button ${label}`);

    await act(async () => {
      button.click();
    });
  }

  async function finish(index: number, response: Response) {
    assert.ok(requests[index]);

    await act(async () => {
      requests[index].resolve(response);
    });
  }

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

  async function visibility(value: "hidden" | "visible") {
    Object.defineProperty(dom.window.document, "visibilityState", {
      configurable: true,
      value,
    });

    await act(async () => {
      dom.window.document.dispatchEvent(
        new dom.window.Event("visibilitychange"),
      );
    });
  }

  const text = () => container.textContent ?? "";

  try {
    await act(async () => {
      root.render(createElement(HistoricalFleetPanel));
    });

    assert.equal(requests.length, 0);

    await click("Load historical fleet observations");

    assert.equal(
      requests[0].input,
      "/api/monitoring/observations",
    );

    assert.equal(requests[0].init?.cache, "no-store");

    assert.equal(
      requests[0].init?.credentials,
      "same-origin",
    );

    await finish(0, Response.json(normal));

    assert.match(text(), /2 of 2 returned units shown/);
    assert.match(text(), /20 °C \(unit to confirm\)/);
    assert.match(text(), /Not listed in configuration/);
    assert.match(text(), /freshness not verified/);

    const rows = container.querySelectorAll("tbody tr");

    assert.match(rows[0].textContent ?? "", /AHU-01/);
    assert.match(rows[1].textContent ?? "", /AHU-02/);

    await choose(1, "SIMULATION");

    assert.match(text(), /1 of 2 returned units shown/);

    assert.doesNotMatch(
      container.querySelector("tbody")?.textContent ?? "",
      /AHU-01/,
    );

    await choose(0, "AHU-01");
    assert.match(text(), /No returned observations match/);

    await choose(0, "ALL");
    await choose(1, "ALL");

    // A new request clears previously displayed data.
    await click("Load historical fleet observations");

    assert.doesNotMatch(text(), /20 °C/);

    await finish(1, Response.json({}, { status: 401 }));

    assert.match(text(), /Access is unavailable/);
    assert.doesNotMatch(text(), /20 °C/);

    // Duplicate units are rejected by the existing parser.
    await click("Load historical fleet observations");

    await finish(
      2,
      Response.json({
        observations: [
          row("AHU-01", "PHYSICAL", 20),
          row("AHU-01", "PHYSICAL", 21),
        ],
      }),
    );

    assert.match(
      text(),
      /Historical fleet observations are unavailable/,
    );

    // Hiding the tab cancels a pending request.
    await click("Load historical fleet observations");
    await visibility("hidden");

    assert.equal(requests[3].init?.signal?.aborted, true);

    await finish(3, Response.json(normal));

    assert.doesNotMatch(text(), /20 °C/);

    await click("Load historical fleet observations");
    assert.equal(requests.length, 4);

    await visibility("visible");

    // Returning does not automatically reload.
    assert.equal(requests.length, 4);

    await click("Load historical fleet observations");
    await finish(4, Response.json(normal));

    await act(async () => {
      dom.window.dispatchEvent(
        new dom.window.PageTransitionEvent("pagehide", {
          persisted: true,
        }),
      );
    });

    assert.doesNotMatch(text(), /20 °C/);

    // Clear also cancels a response whose body is still pending.
    await click("Load historical fleet observations");

    let finishBody!: (value: unknown) => void;

    const body = new Promise<unknown>((resolve) => {
      finishBody = resolve;
    });

    await finish(
      5,
      {
        status: 200,
        ok: true,
        json: () => body,
      } as Response,
    );

    await click("Clear fleet / cancel");

    assert.equal(requests[5].init?.signal?.aborted, true);

    await act(async () => {
      finishBody(normal);
    });

    assert.doesNotMatch(text(), /20 °C/);

    // Future timestamps cannot display values.
    await click("Load historical fleet observations");

    const future = {
      ...row("AHU-01", "PHYSICAL", 20),
      timestampStatus: "future",
      roomTemp: { configured: true, value: null },
      humidity: { configured: false, value: null },
    };

    await finish(
      6,
      Response.json({ observations: [future] }),
    );

    assert.match(text(), /Future timestamp; values withheld/);
    assert.doesNotMatch(text(), /20 °C/);

    await act(async () => {
      dom.window.dispatchEvent(
        new dom.window.PageTransitionEvent("pageshow", {
          persisted: true,
        }),
      );
    });

    assert.doesNotMatch(
      text(),
      /Future timestamp; values withheld/,
    );

    // An empty response is not interpreted as equipment status.
    await click("Load historical fleet observations");

    await finish(
      7,
      Response.json({ observations: [] }),
    );

    assert.match(text(), /0 of 0 returned units shown/);
    assert.match(text(), /does not establish equipment status/);
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