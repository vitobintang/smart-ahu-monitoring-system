import { test } from "node:test";
import { strict as assert } from "node:assert";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";

type Pending = {
  input: RequestInfo | URL;
  init: RequestInit | undefined;
  resolve: (response: Response) => void;
  reject: (error: Error) => void;
};

function exampleRow(ahuId: string, value: number) {
  return {
    ahuId,
    configuredSource: "SIMULATION",
    observedSource: "SIMULATION",
    measuredAt: "2026-01-01T10:00:00.000Z",
    timestampStatus: "past_or_present",
    roomTemp: { configured: true, value },
    humidity: { configured: true, value: 45 },
  };
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("historical panel handles cancellation, late responses and errors", async () => {
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

  const requests: Pending[] = [];

  // Ignore abort in the mock deliberately, to test late responses.
  const mockFetch: typeof fetch = (input, init) =>
    new Promise<Response>((resolve, reject) => {
      requests.push({ input, init, resolve, reject });
    });

  Object.assign(g, {
    window: dom.window,
    document: dom.window.document,
    self: dom.window,
    IS_REACT_ACT_ENVIRONMENT: true,
    fetch: mockFetch,
  });

  Object.defineProperty(g, "navigator", {
    value: dom.window.navigator,
    configurable: true,
    writable: true,
  });

  const { createRoot } = await import("react-dom/client");
  const { default: HistoricalObservationsPanel } =
    await import("../src/components/HistoricalObservationsPanel");

  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  let unmounted = false;

  async function click(index: number) {
    const button = container.querySelectorAll("button")[index];
    assert.ok(button);

    await act(async () => {
      button.click();
    });
  }

  function text() {
    return container.textContent ?? "";
  }

  async function resolveRequest(index: number, result: Response) {
    assert.ok(requests[index]);

    await act(async () => {
      requests[index].resolve(result);
    });
  }

  try {
    await act(async () => {
      root.render(
        createElement(HistoricalObservationsPanel, {
          key: "AHU-01",
          ahuId: "AHU-01",
        }),
      );
    });

    assert.equal(requests.length, 0);
    assert.match(text(), /No observations displayed/);

    // Clear cancels a request, even if the mock returns afterward.
    await click(0);

    assert.equal(requests.length, 1);
    assert.equal(requests[0].input, "/api/monitoring/observations");
    assert.equal(requests[0].init?.cache, "no-store");
    assert.equal(requests[0].init?.credentials, "same-origin");
    assert.equal(container.querySelectorAll("button")[0].disabled, true);

    await click(1);

    assert.equal(requests[0].init?.signal?.aborted, true);

    await resolveRequest(
      0,
      response({ observations: [exampleRow("AHU-01", 99)] }),
    );

    assert.match(text(), /No observations displayed/);
    assert.doesNotMatch(text(), /99 °C/);

    // A late old response cannot replace a newer successful result.
    await click(0);
    await click(1);
    await click(0);

    assert.equal(requests[1].init?.signal?.aborted, true);

    await resolveRequest(
      2,
      response({ observations: [exampleRow("AHU-01", 21)] }),
    );

    assert.match(text(), /21 °C \(unit to confirm\)/);
    assert.match(text(), /freshness not verified/);

    await resolveRequest(
      1,
      response({ observations: [exampleRow("AHU-01", 98)] }),
    );

    assert.match(text(), /21 °C \(unit to confirm\)/);
    assert.doesNotMatch(text(), /98 °C/);

    await click(1);
    assert.doesNotMatch(text(), /21 °C/);

    // Cancel while the response body is still being read.
    await click(0);

    let finishBody!: (body: unknown) => void;

    const bodyPromise = new Promise<unknown>((resolve) => {
      finishBody = resolve;
    });

    const slowBody = {
      status: 200,
      ok: true,
      json: () => bodyPromise,
    } as Response;

    await resolveRequest(3, slowBody);
    await click(1);

    assert.equal(requests[3].init?.signal?.aborted, true);

    await act(async () => {
      finishBody({ observations: [exampleRow("AHU-01", 97)] });
    });

    assert.match(text(), /No observations displayed/);
    assert.doesNotMatch(text(), /97 °C/);

    // Failures are shown without exposing the mock error.
    await click(0);
    await resolveRequest(4, response({}, 401));
    assert.match(text(), /Access is unavailable/);

    await click(0);
    await resolveRequest(5, response({}, 503));
    assert.match(text(), /Historical observations are unavailable/);

    await click(0);
    await resolveRequest(6, response({ observations: "invalid" }));
    assert.match(text(), /Historical observations are unavailable/);

    await click(0);

    await act(async () => {
      requests[7].reject(new Error("private mock error"));
    });

    assert.match(text(), /Historical observations are unavailable/);
    assert.doesNotMatch(text(), /private mock error/);

    // The detail page uses key={id}; changing keys resets the panel.
    await click(0);

    await act(async () => {
      root.render(
        createElement(HistoricalObservationsPanel, {
          key: "AHU-02",
          ahuId: "AHU-02",
        }),
      );
    });

    assert.equal(requests[8].init?.signal?.aborted, true);
    assert.match(text(), /No observations displayed/);

    await resolveRequest(
      8,
      response({ observations: [exampleRow("AHU-01", 96)] }),
    );

    assert.doesNotMatch(text(), /96 °C/);

    await click(0);

    await resolveRequest(
      9,
      response({
        observations: [
          exampleRow("AHU-01", 95),
          exampleRow("AHU-02", 22),
        ],
      }),
    );

    assert.match(text(), /22 °C \(unit to confirm\)/);
    assert.doesNotMatch(text(), /95 °C/);

    // An old completion must not prevent cancellation of a newer request.
    await click(1);
    await click(0);
    await click(1);
    await click(0);

    await resolveRequest(
      10,
      response({ observations: [exampleRow("AHU-02", 93)] }),
    );

    assert.match(text(), /Loading historical observations/);

    await click(1);

    assert.equal(requests[11].init?.signal?.aborted, true);

    await resolveRequest(
      11,
      response({ observations: [exampleRow("AHU-02", 92)] }),
    );

    assert.match(text(), /No observations displayed/);
    assert.doesNotMatch(text(), /92 °C|93 °C/);

    // Unmount aborts a pending request and ignores a late completion.
    await click(0);

    await act(async () => {
      root.unmount();
    });

    unmounted = true;
    assert.equal(requests[12].init?.signal?.aborted, true);

    await resolveRequest(
      12,
      response({ observations: [exampleRow("AHU-02", 94)] }),
    );

    assert.equal(container.textContent, "");
  } finally {
    if (!unmounted) {
      await act(async () => {
        root.unmount();
      });
    }

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