import { test } from "node:test";
import { equal, match, ok } from "node:assert/strict";
import React, { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";

import AdministrationPreview from "../src/components/AdministrationPreview";
import {
  PreviewNavigationLinks,
} from "../src/components/PreviewNavigation";

test("admin and audit previews are fictional and explicitly unprotected", () => {
  for (const section of ["admin", "audit"] as const) {
    const html = renderToStaticMarkup(
      React.createElement(AdministrationPreview, { section }),
    );

    match(html, /Not operational/);
    match(html, /not protected by login/);
    match(html, /fictional/i);

    match(
      html,
      /No real users, devices or audit records are loaded or changed/,
    );
  }
});

test("both new links exist and correctly mark their current page", () => {
  for (const path of ["/admin", "/audit"]) {
    const html = renderToStaticMarkup(
      React.createElement(PreviewNavigationLinks, {
        pathname: path,
      }),
    );

    equal((html.match(/aria-current="page"/g) ?? []).length, 1);

    const active =
      html.match(/<a\b[^>]*aria-current="page"[^>]*>/)?.[0] ?? "";

    ok(active.includes(`href="${path}"`));
  }
});

test("administration tabs and audit filters are local only", async () => {
  const dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>",
    { url: "http://localhost/" },
  );

  const saved = {
    window: Object.getOwnPropertyDescriptor(globalThis, "window"),
    self: Object.getOwnPropertyDescriptor(globalThis, "self"),
    document: Object.getOwnPropertyDescriptor(globalThis, "document"),
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
    act: Object.getOwnPropertyDescriptor(
      globalThis,
      "IS_REACT_ACT_ENVIRONMENT",
    ),
    fetch: globalThis.fetch,
  };

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: dom.window,
  });

  Object.defineProperty(globalThis, "self", {
    configurable: true,
    value: dom.window,
  });

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: dom.window.document,
  });

  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: dom.window.navigator,
  });

  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
  });

  let requests = 0;

  globalThis.fetch = (async () => {
    requests++;
    throw new Error("Unexpected request");
  }) as typeof fetch;

  const { createRoot } = await import("react-dom/client");
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        React.createElement(AdministrationPreview, {
          section: "admin",
        }),
      );
    });

    match(container.textContent!, /Fictional users/);

    const findButton = (text: string) =>
      Array.from(container.querySelectorAll("button")).find(
        (item) => item.textContent === text,
      )!;

    ok(findButton("Create real user unavailable").disabled);

    await act(async () => {
      findButton("Browser access").click();
    });

    ok(findButton("Issue real invitation unavailable").disabled);
    ok(findButton("Revoke real access unavailable").disabled);

    await act(async () => {
      findButton("Telemetry devices").click();
    });

    ok(findButton("Provision real device unavailable").disabled);
    match(container.textContent!, /separate from user browser access/);

    await act(async () => {
      root.render(
        React.createElement(AdministrationPreview, {
          section: "audit",
        }),
      );
    });

    match(container.textContent!, /3 fictional rows/);

    const select =
      container.querySelector<HTMLSelectElement>("select")!;

    await act(async () => {
      select.value = "Configuration";

      select.dispatchEvent(
        new dom.window.Event("change", { bubbles: true }),
      );
    });

    match(container.textContent!, /1 fictional row/);
    equal(container.querySelectorAll("tbody tr").length, 1);

    const details = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Details for Configuration example"]',
    )!;

    await act(async () => {
      details.click();
    });

    equal(details.getAttribute("aria-expanded"), "true");

    match(
      container.textContent!,
      /Invented configuration event for layout practice/,
    );

    await act(async () => {
      select.value = "All actions";

      select.dispatchEvent(
        new dom.window.Event("change", { bubbles: true }),
      );
    });

    match(container.textContent!, /3 fictional rows/);
    equal(container.querySelectorAll("tbody tr").length, 3);
    equal(requests, 0);
  } finally {
    await act(async () => {
      root.unmount();
    });

    dom.window.close();

    for (const [key, descriptor] of [
      ["window", saved.window],
      ["self", saved.self],
      ["document", saved.document],
      ["navigator", saved.navigator],
      ["IS_REACT_ACT_ENVIRONMENT", saved.act],
    ] as const) {
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
      } else {
        Reflect.deleteProperty(globalThis, key);
      }
    }

    globalThis.fetch = saved.fetch;
  }
});