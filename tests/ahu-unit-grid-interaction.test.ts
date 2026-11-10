import { test } from "node:test";
import { strict as assert } from "node:assert";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";

test("search and clear filter the planned unit cards", async () => {
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
  const { default: AhuUnitGrid } =
    await import("../src/components/AhuUnitGrid");

  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(createElement(AhuUnitGrid));
    });

    const input =
      container.querySelector<HTMLInputElement>("#unit-search");

    assert.ok(input);

    const setter = Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      "value",
    )?.set;

    assert.ok(setter);

    await act(async () => {
      setter.call(input, "gtm-daikin-001");
      input.dispatchEvent(
        new dom.window.Event("input", { bubbles: true }),
      );
    });

    assert.match(container.textContent ?? "", /1 of 1 planned units/);
    assert.ok(container.querySelector('a[href="/devices/GTM-DAIKIN-001"]'));

    await act(async () => {
      setter.call(input, "AHU-99");
      input.dispatchEvent(
        new dom.window.Event("input", { bubbles: true }),
      );
    });

    assert.match(
      container.textContent ?? "",
      /No planned identifiers match/,
    );

    const clear = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Clear search",
    );

    assert.ok(clear);

    await act(async () => {
      clear.click();
    });

    assert.match(container.textContent ?? "", /1 of 1 planned units/);
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