import { test } from "node:test";
import {
  equal,
  match,
  doesNotMatch,
  ok,
} from "node:assert/strict";
import React, { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";

import ReferencePreview from "../src/components/ReferencePreview";
import {
  PreviewNavigationLinks,
} from "../src/components/PreviewNavigation";

test("new pages disclose that examples are fictional and unprotected", () => {
  for (const section of [
    "config",
    "trends",
    "energy",
    "maintenance",
  ] as const) {
    const html = renderToStaticMarkup(
      React.createElement(ReferencePreview, { section }),
    );

    match(html, /Not operational/);
    match(html, /not protected by login/);
    match(html, /fictional/i);
    match(html, /Example unit/);
  }
});

test("configuration offers a disabled real save and all planned sensors", () => {
  const html = renderToStaticMarkup(
    React.createElement(ReferencePreview, {
      section: "config",
    }),
  );

  match(
    html,
    /disabled=""[^>]*>Save real settings unavailable/,
  );

  equal((html.match(/type="checkbox"/g) ?? []).length, 13);
  match(html, /not an equipment limit/);
});

test("navigation includes every preview and marks only the current page", () => {
  const paths = [
    "/",
    "/alarms",
    "/reports",
    "/simulator",
    "/config",
    "/trends",
    "/energy",
    "/maintenance",
    "/login",
  ];

  for (const path of paths) {
    const html = renderToStaticMarkup(
      React.createElement(PreviewNavigationLinks, {
        pathname: path,
      }),
    );

    for (const href of paths) {
      ok(html.includes(`href="${href}"`));
    }

    equal((html.match(/aria-current="page"/g) ?? []).length, 1);

    const currentLink =
      html.match(/<a\b[^>]*aria-current="page"[^>]*>/)?.[0] ?? "";

    ok(currentLink.includes(`href="${path}"`));
  }

  for (const path of [null, "/ahu/AHU-01"]) {
    const html = renderToStaticMarkup(
      React.createElement(PreviewNavigationLinks, {
        pathname: path,
      }),
    );

    doesNotMatch(html, /aria-current="page"/);
  }
});

test("configuration edits, reset and unit changes stay local", async () => {
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

  let requests = 0;

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
        React.createElement(ReferencePreview, {
          section: "config",
        }),
      );
    });

    const inputs = container.querySelectorAll<HTMLInputElement>(
      'input[type="text"], input:not([type])',
    );

    equal(inputs.length, 3);

    const setter = Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      "value",
    )!.set!;

    async function input(element: HTMLInputElement, value: string) {
      await act(async () => {
        setter.call(element, value);

        element.dispatchEvent(
          new dom.window.Event("input", { bubbles: true }),
        );
      });
    }

    await input(inputs[0], "Example name");
    await input(inputs[2], "0");

    match(container.textContent!, /Invalid practice value/);

    await input(inputs[2], "30");

    match(container.textContent!, /30 seconds \(example\)/);

    const checkbox =
      container.querySelector<HTMLInputElement>(
        'input[type="checkbox"]',
      )!;

    await act(async () => {
      checkbox.click();
    });

    match(container.textContent!, /1 selected \(example\)/);

    const select =
      container.querySelector<HTMLSelectElement>("select")!;

    await act(async () => {
      select.value = "AHU-02";

      select.dispatchEvent(
        new dom.window.Event("change", { bubbles: true }),
      );
    });

    equal(inputs[0].value, "");
    equal(inputs[2].value, "");
    equal(checkbox.checked, false);
    match(container.textContent!, /AHU-02/);

    await input(inputs[0], "Another draft");

    const reset = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent === "Reset draft")!;

    await act(async () => {
      reset.click();
    });

    equal(inputs[0].value, "");
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