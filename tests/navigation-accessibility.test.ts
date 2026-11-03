import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  PreviewNavigationContent,
  PreviewNavigationLinks,
} from "../src/components/PreviewNavigation";

test("navigation remains available on desktop and warns that pages are unprotected", () => {
  const html = renderToStaticMarkup(
    createElement(PreviewNavigationContent, {
      pathname: "/reports",
    }),
  );

  assert.match(html, /aria-expanded="false"/);

  assert.match(
    html,
    /aria-controls="preview-navigation-links"/,
  );

  assert.match(
    html,
    /id="preview-navigation-links" class="hidden lg:block"/,
  );

  assert.match(
    html,
    /Pages are not protected by login/,
  );

  assert.equal(
    (html.match(/aria-current="page"/g) ?? []).length,
    1,
  );
});

test("exact current page is retained for command practice, not its parent", () => {
  const html = renderToStaticMarkup(
    createElement(PreviewNavigationLinks, {
      pathname: "/simulator/commands",
    }),
  );

  assert.equal(
    (html.match(/aria-current="page"/g) ?? []).length,
    1,
  );

  assert.match(
    html,
    /href="\/simulator\/commands"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/simulator\/commands"/,
  );
});

test("layout includes a focusable skip-link target before page content", () => {
  const source = readFileSync("src/app/layout.tsx", "utf8");

  assert.match(source, /href="#main-content"/);
  assert.match(source, /id="main-content"/);
  assert.match(source, /tabIndex=\{-1\}/);

  assert.ok(
    source.indexOf('href="#main-content"') <
      source.indexOf("<PreviewNavigation"),
  );
});

test("menu opens, closes on Escape and returns focus; pathname change resets it", async () => {
  const dom = new JSDOM(
    "<!doctype html><div id='root'></div>",
    { url: "http://localhost" },
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
  };

  Object.assign(g, {
    window: dom.window,
    document: dom.window.document,
    self: dom.window,
    IS_REACT_ACT_ENVIRONMENT: true,
  });

  Object.defineProperty(g, "navigator", {
    value: dom.window.navigator,
    configurable: true,
    writable: true,
  });

  const { createRoot } = await import("react-dom/client");

  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        createElement(PreviewNavigationContent, {
          key: "/",
          pathname: "/",
        }),
      );
    });

    const button =
      container.querySelector<HTMLButtonElement>(
        'button[aria-controls="preview-navigation-links"]',
      );

    assert.ok(button);
    assert.equal(button.getAttribute("aria-expanded"), "false");

    await act(async () => {
      button.click();
    });

    assert.equal(button.getAttribute("aria-expanded"), "true");

    assert.equal(
      container.querySelector("#preview-navigation-links")?.className,
      "block",
    );

    const link =
      container.querySelector<HTMLAnchorElement>(
        'a[href="/reports"]',
      );

    assert.ok(link);
    link.focus();

    await act(async () => {
      link.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
        }),
      );
    });

    assert.equal(button.getAttribute("aria-expanded"), "false");
    assert.equal(dom.window.document.activeElement, button);

    await act(async () => {
      button.click();
    });

    // Prevent actual navigation in this local DOM test.
    link.addEventListener("click", (event) => {
      event.preventDefault();
    });

    await act(async () => {
      link.click();
    });

    assert.equal(button.getAttribute("aria-expanded"), "false");

    await act(async () => {
      button.click();
    });

    await act(async () => {
      root.render(
        createElement(PreviewNavigationContent, {
          key: "/reports",
          pathname: "/reports",
        }),
      );
    });

    assert.equal(
      container.querySelector("button")?.getAttribute("aria-expanded"),
      "false",
    );

    assert.equal(
      container.querySelectorAll('[aria-current="page"]').length,
      1,
    );
  } finally {
    await act(async () => {
      root.unmount();
    });

    g.window = original.window;
    g.document = original.document;
    g.self = original.self;
    g.IS_REACT_ACT_ENVIRONMENT = original.act;

    Object.defineProperty(g, "navigator", {
      value: original.navigator,
      configurable: true,
      writable: true,
    });

    dom.window.close();
  }
});