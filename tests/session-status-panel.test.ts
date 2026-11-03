import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createElement, act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";

import SessionStatusPanel from "../src/components/SessionStatusPanel";
import LoginPage from "../src/app/login/page";

test("login remains disabled and explains separate browser access", () => {
  const html = renderToStaticMarkup(createElement(LoginPage));

  assert.match(html, /Login is not connected yet/);
  assert.match(html, /Sign in unavailable/);
  assert.match(html, /Admin-issued token/);
  assert.match(html, /Telemetry device credentials are separate/);
  assert.match(html, /No check is made automatically/);

  assert.equal(
    (html.match(/<input[^>]*disabled/g) ?? []).length,
    2,
  );
});

test("session check is manual, validates response and clears safely", async () => {
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

  const text = () => container.textContent ?? "";

  async function click(label: string) {
    const button = Array.from(
      container.querySelectorAll("button"),
    ).find((item) => item.textContent?.includes(label));

    assert.ok(button);

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

  try {
    await act(async () => {
      root.render(createElement(SessionStatusPanel));
    });

    assert.equal(requests.length, 0);

    await click("Check current session");

    assert.equal(requests[0].input, "/api/auth/session");
    assert.equal(requests[0].init?.cache, "no-store");

    assert.equal(
      requests[0].init?.credentials,
      "same-origin",
    );

    await finish(
      0,
      Response.json({
        user: {
          id: "private-user-id",
          role: "Admin",
        },
      }),
    );

    assert.match(text(), /Reported role: Admin/);
    assert.doesNotMatch(text(), /private-user-id/);

    // A new check clears the previous result.
    await click("Check current session");

    assert.doesNotMatch(text(), /Reported role: Admin/);

    await finish(1, Response.json({}, { status: 401 }));

    assert.match(text(), /does not identify which/);

    // Unknown roles fail closed in the display.
    await click("Check current session");

    await finish(
      2,
      Response.json({
        user: { id: "x", role: "Superuser" },
      }),
    );

    assert.match(text(), /Session check unavailable/);

    // Hiding cancels the pending request and ignores a late response.
    await click("Check current session");
    await visibility("hidden");

    assert.equal(requests[3].init?.signal?.aborted, true);

    await finish(
      3,
      Response.json({
        user: { id: "x", role: "Viewer" },
      }),
    );

    assert.doesNotMatch(text(), /Reported role: Viewer/);

    await click("Check current session");
    assert.equal(requests.length, 4);

    await visibility("visible");

    // Returning does not automatically check again.
    assert.equal(requests.length, 4);

    await click("Check current session");

    await finish(
      4,
      Response.json({
        user: { id: "x", role: "Operator" },
      }),
    );

    await act(async () => {
      dom.window.dispatchEvent(
        new dom.window.PageTransitionEvent("pageshow", {
          persisted: true,
        }),
      );
    });

    assert.doesNotMatch(text(), /Reported role: Operator/);

    // Clear cancels an unfinished response body.
    await click("Check current session");

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

    await click("Clear / cancel check");

    assert.equal(requests[5].init?.signal?.aborted, true);

    await act(async () => {
      finishBody({
        user: { id: "x", role: "Admin" },
      });
    });

    assert.doesNotMatch(text(), /Reported role: Admin/);
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