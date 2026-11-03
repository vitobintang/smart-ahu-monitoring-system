import { test } from "node:test";
import { strict as assert } from "node:assert";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";

test("both manual panels clear and cancel on browser privacy events", async () => {
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
    signal: AbortSignal | null | undefined;
    resolve: (response: Response) => void;
  }[] = [];

  Object.assign(g, {
    window: dom.window,
    document: dom.window.document,
    self: dom.window,
    IS_REACT_ACT_ENVIRONMENT: true,

    fetch: (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((resolve) => {
        requests.push({
          signal: init?.signal,
          resolve,
        });
      }),
  });

  Object.defineProperty(g, "navigator", {
    value: dom.window.navigator,
    configurable: true,
    writable: true,
  });

  const { createRoot } = await import("react-dom/client");

  const { default: Units } =
    await import("../src/components/ProtectedUnitList");

  const { default: History } =
    await import("../src/components/HistoricalObservationsPanel");

  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);

  const row = {
    ahuId: "AHU-01",
    configuredSource: "SIMULATION",
    observedSource: "SIMULATION",
    measuredAt: "2026-01-01T10:00:00.000Z",
    timestampStatus: "past_or_present",
    roomTemp: { configured: true, value: 31 },
    humidity: { configured: true, value: 45 },
  };

  const unitResult = () =>
    Response.json({
      units: [
        {
          id: "AHU-01",
          name: "Private unit name",
          location: "Private location",
        },
      ],
    });

  const historyResult = () =>
    Response.json({ observations: [row] });

  async function click(label: string) {
    const button = Array.from(
      container.querySelectorAll("button"),
    ).find((item) => item.textContent?.includes(label));

    assert.ok(button, `Missing button: ${label}`);

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

  async function visibility(value: "visible" | "hidden") {
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

  try {
    await act(async () => {
      root.render(
        createElement(
          "div",
          null,
          createElement(Units),
          createElement(History, { ahuId: "AHU-01" }),
        ),
      );
    });

    assert.equal(requests.length, 0);

    await click("Load configured units");
    await click("Load historical observations");

    await finish(0, unitResult());
    await finish(1, historyResult());

    assert.match(container.textContent ?? "", /Private unit name/);
    assert.match(container.textContent ?? "", /31 °C/);

    // Hiding the tab clears displayed values.
    await visibility("hidden");

    assert.doesNotMatch(
      container.textContent ?? "",
      /Private unit name|31 °C/,
    );

    // A hidden document does not start a new manual request.
    await click("Load configured units");
    await click("Load historical observations");

    assert.equal(requests.length, 2);

    // Returning to the tab does not reload automatically.
    await visibility("visible");

    assert.equal(requests.length, 2);

    // Hiding aborts pending requests, including late responses.
    await click("Load configured units");
    await click("Load historical observations");

    await visibility("hidden");

    assert.equal(requests[2].signal?.aborted, true);
    assert.equal(requests[3].signal?.aborted, true);

    await finish(2, unitResult());
    await finish(3, historyResult());

    assert.doesNotMatch(
      container.textContent ?? "",
      /Private unit name|31 °C/,
    );

    await visibility("visible");

    await click("Load configured units");
    await click("Load historical observations");

    await finish(4, unitResult());
    await finish(5, historyResult());

    // Page navigation clears displayed values.
    await act(async () => {
      dom.window.dispatchEvent(
        new dom.window.PageTransitionEvent("pagehide", {
          persisted: true,
        }),
      );
    });

    assert.doesNotMatch(
      container.textContent ?? "",
      /Private unit name|31 °C/,
    );

    await click("Load configured units");
    await click("Load historical observations");

    await finish(6, unitResult());
    await finish(7, historyResult());

    // Restoring a cached page also clears displayed values.
    await act(async () => {
      dom.window.dispatchEvent(
        new dom.window.PageTransitionEvent("pageshow", {
          persisted: true,
        }),
      );
    });

    assert.doesNotMatch(
      container.textContent ?? "",
      /Private unit name|31 °C/,
    );

    assert.equal(requests.length, 8);

    // Page navigation cancels an unfinished response body too.
    await click("Load configured units");
    await click("Load historical observations");

    let finishBody!: (value: unknown) => void;

    const body = new Promise<unknown>((resolve) => {
      finishBody = resolve;
    });

    await finish(
      8,
      {
        status: 200,
        ok: true,
        json: () => body,
      } as Response,
    );

    await act(async () => {
      dom.window.dispatchEvent(
        new dom.window.PageTransitionEvent("pagehide", {
          persisted: true,
        }),
      );
    });

    assert.equal(requests[8].signal?.aborted, true);
    assert.equal(requests[9].signal?.aborted, true);

    await act(async () => {
      finishBody({
        units: [
          {
            id: "AHU-01",
            name: "Private unit name",
            location: "Private location",
          },
        ],
      });
    });

    await finish(9, historyResult());

    assert.doesNotMatch(
      container.textContent ?? "",
      /Private unit name|31 °C/,
    );
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