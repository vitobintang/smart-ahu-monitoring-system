import { test } from "node:test";
import { strict as assert } from "node:assert";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";

test("simulator generates and clears fictional samples without requests", async () => {
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

  const cryptoDescriptor = Object.getOwnPropertyDescriptor(g, "crypto");
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

  Object.defineProperty(g, "crypto", {
    value: {
      randomUUID: () => "12345678-1234-4123-8123-123456789012",
    },
    configurable: true,
  });

  const { createRoot } = await import("react-dom/client");
  const { default: SimulatorPage } =
    await import("../src/app/simulator/page");

  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);

  async function edit(id: string, value: string) {
    const input = container.querySelector<HTMLInputElement>(id);
    assert.ok(input);

    const setter = Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      "value",
    )?.set;

    assert.ok(setter);

    await act(async () => {
      setter.call(input, value);
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
  }

  async function generate() {
    const button = Array.from(container.querySelectorAll("button")).find(
      (item) => item.textContent?.trim() === "Generate sample",
    );

    assert.ok(button);

    await act(async () => {
      button.click();
    });
  }

  function sampleText() {
    return (
      container.querySelector('[aria-labelledby="sample-heading"]')
        ?.textContent ?? ""
    );
  }

  try {
    await act(async () => {
      root.render(createElement(SimulatorPage));
    });

    assert.match(sampleText(), /No sample generated yet/);

    await generate();
    assert.match(sampleText(), /22 °C/);
    assert.match(sampleText(), /50 %/);

    await edit("#simulation-temperature", "19.5");
    assert.match(sampleText(), /No sample generated yet/);

    await edit("#simulation-humidity", "");
    await generate();

    assert.match(sampleText(), /19.5 °C/);
    assert.match(sampleText(), /Unavailable/);

    const comparisons =
      container.querySelector(
        '[aria-labelledby="sample-threshold-heading"]',
      )?.textContent ?? "";

    assert.match(comparisons, /LOW/);
    assert.match(comparisons, /UNKNOWN/);

    await edit("#simulation-temperature", "1,5");
    await generate();

    assert.match(sampleText(), /Enter decimal example values/);
    assert.doesNotMatch(sampleText(), /19.5 °C/);

    await edit("#simulation-temperature", "24");
    await generate();
    assert.match(sampleText(), /24 °C/);

    const unit = container.querySelector<HTMLSelectElement>("#ahu-id");
    assert.ok(unit);

    await act(async () => {
      unit.value = "AHU-02";
      unit.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });

    assert.match(sampleText(), /No sample generated yet/);

    await generate();
    assert.match(sampleText(), /AHU-02/);
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

    if (cryptoDescriptor) {
      Object.defineProperty(g, "crypto", cryptoDescriptor);
    } else {
      Reflect.deleteProperty(g, "crypto");
    }

    dom.window.close();
  }
});