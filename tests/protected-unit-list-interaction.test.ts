import { test } from "node:test";
import { strict as assert } from "node:assert";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

import ProtectedUnitList from "../src/components/ProtectedUnitList";

// A local fake browser and fake fetch: no network or Supabase connection.
test("unit list interaction with mocked responses", async (t) => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "http://localhost",
  });

  const g = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };

  const original = {
    window: g.window,
    document: g.document,
    fetch: g.fetch,
    act: g.IS_REACT_ACT_ENVIRONMENT,
  };

  Object.assign(g, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });

  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);

  let calls = 0;
  let resolveRequest: ((response: Response) => void) | undefined;
  let signal: AbortSignal | undefined;

  g.fetch = ((_url: RequestInfo | URL, options?: RequestInit) => {
    calls++;
    signal = options?.signal ?? undefined;

    return new Promise<Response>((resolve) => {
      resolveRequest = resolve;
    });
  }) as typeof fetch;

  const click = async (label: string) => {
    const button = [...container.querySelectorAll("button")].find((item) =>
      item.textContent?.includes(label),
    );

    assert.ok(button, `button ${label} exists`);

    await act(async () => {
      button.click();
    });
  };

  const resolve = async (response: Response) => {
    assert.ok(resolveRequest);

    await act(async () => {
      resolveRequest!(response);
    });
  };

  try {
    await act(async () => {
      root.render(createElement(ProtectedUnitList));
    });

    await t.test("render makes no request", () => {
      assert.equal(calls, 0);
      assert.match(container.textContent ?? "", /No request has been made/);
    });

    await t.test("clear cancels a pending request and ignores its late response", async () => {
      await click("Load configured units");
      assert.equal(calls, 1);

      const firstSignal = signal;

      await click("Clear / cancel");
      assert.equal(firstSignal?.aborted, true);

      await resolve(
        Response.json({
          units: [
            {
              id: "AHU-01",
              name: "Old name",
              location: "Old location",
            },
          ],
        }),
      );

      assert.doesNotMatch(container.textContent ?? "", /Old name/);
      assert.match(container.textContent ?? "", /List cleared/);
    });

    await t.test("an old response cannot replace a newer result", async () => {
      await click("Load configured units");
      const oldResolve = resolveRequest!;

      await click("Clear / cancel");
      await click("Load configured units");

      await resolve(
        Response.json({
          units: [
            {
              id: "AHU-01",
              name: "New name",
              location: "New location",
            },
          ],
        }),
      );

      await act(async () => {
        oldResolve(
          Response.json({
            units: [
              {
                id: "AHU-01",
                name: "Stale name",
                location: "Stale location",
              },
            ],
          }),
        );
      });

      assert.match(container.textContent ?? "", /New name/);
      assert.doesNotMatch(container.textContent ?? "", /Stale name/);

      await click("Clear / cancel");
    });

    await t.test("success shows metadata; clear removes it from the panel", async () => {
      await click("Load configured units");

      await resolve(
        Response.json({
          units: [
            {
              id: "AHU-01",
              name: "Example name",
              location: "Example location",
            },
          ],
        }),
      );

      assert.match(container.textContent ?? "", /Example name/);

      await click("Clear / cancel");

      assert.doesNotMatch(container.textContent ?? "", /Example name/);
    });

    await t.test("unauthorized response is reported without data", async () => {
      await click("Load configured units");

      await resolve(
        Response.json(
          { error: "Not authenticated" },
          { status: 401 },
        ),
      );

      assert.match(container.textContent ?? "", /Access is unavailable/);
    });

    await t.test("unmount aborts an in-flight request", async () => {
      await click("Load configured units");
      const finalSignal = signal;

      await act(async () => {
        root.unmount();
      });

      assert.equal(finalSignal?.aborted, true);

      await resolve(Response.json({ units: [] }));
    });
  } finally {
    await act(async () => {
      root.unmount();
    });

    g.window = original.window;
    g.document = original.document;
    g.fetch = original.fetch;
    g.IS_REACT_ACT_ENVIRONMENT = original.act;
    dom.window.close();
  }
});