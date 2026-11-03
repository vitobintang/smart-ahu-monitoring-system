import { test } from "node:test";
import { equal, match, doesNotMatch } from "node:assert/strict";
import React, { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";

import PrintPage from "../src/app/reports/print/page";
import FictionalPrintButton from "../src/components/FictionalPrintButton";
import ReportFilterExample from "../src/components/ReportFilterExample";

async function htmlFor(
  ahu: string | string[],
  window: string | string[],
) {
  return renderToStaticMarkup(
    await PrintPage({
      searchParams: Promise.resolve({ ahu, window }),
    }),
  );
}

test("print view follows fictional filters, including half-open windows", async () => {
  for (const [ahu, window, count, average] of [
    ["AHU-01", "ALL", 3, "22.0"],
    ["AHU-01", "EARLY", 2, "21.0"],
    ["AHU-01", "LATE", 1, "24.0"],
    ["AHU-02", "ALL", 2, "21.0"],
  ] as const) {
    const html = await htmlFor(ahu, window);
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    const selection = doc.querySelector(
      '[aria-label="Fictional report selection"]',
    )!.textContent!;

    const summary = doc.querySelector(
      '[aria-label="Fictional report summary"]',
    )!.textContent!;

    match(html, /Fictional example/);
    match(html, /not stored AHU history/);
    match(selection, new RegExp(ahu));
    match(selection, /SIMULATION/);
    match(summary, new RegExp(`Included${count}`));
    match(
      summary,
      new RegExp(`Average${average.replace(".", "\\.")}`),
    );

    dom.window.close();
  }
});

test("invalid or duplicated filters fail closed without print action", async () => {
  for (const [ahu, window] of [
    ["AHU-99", "ALL"],
    ["AHU-01", "BAD"],
    [["AHU-01", "AHU-02"], "ALL"],
  ] as const) {
    const html = await htmlFor(
      typeof ahu === "string" ? ahu : [...ahu],
      window,
    );

    match(html, /Fictional report unavailable/);
    doesNotMatch(html, /Print \/ save fictional PDF/);
  }
});

test("print button calls only the browser print function", async () => {
  const dom = new JSDOM(
    "<!doctype html><div id='root'></div>",
    { url: "http://localhost/" },
  );

  const saved = {
    window: Object.getOwnPropertyDescriptor(globalThis, "window"),
    document: Object.getOwnPropertyDescriptor(globalThis, "document"),
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
    self: Object.getOwnPropertyDescriptor(globalThis, "self"),
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
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: dom.window.document,
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: dom.window.navigator,
  });
  Object.defineProperty(globalThis, "self", {
    configurable: true,
    value: dom.window,
  });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
  });

  let printed = 0;
  let requests = 0;

  dom.window.print = () => {
    printed++;
  };

  globalThis.fetch = (async () => {
    requests++;
    throw new Error("Unexpected request");
  }) as typeof fetch;

  const { createRoot } = await import("react-dom/client");
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(React.createElement(FictionalPrintButton));
    });

    await act(async () => {
      container.querySelector("button")!.click();
    });

    equal(printed, 1);
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

test("print link tracks the selected fictional filters", async () => {
  const dom = new JSDOM(
    "<!doctype html><div id='root'></div>",
    { url: "http://localhost/" },
  );

  const saved = {
    window: Object.getOwnPropertyDescriptor(globalThis, "window"),
    document: Object.getOwnPropertyDescriptor(globalThis, "document"),
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
    self: Object.getOwnPropertyDescriptor(globalThis, "self"),
    act: Object.getOwnPropertyDescriptor(
      globalThis,
      "IS_REACT_ACT_ENVIRONMENT",
    ),
  };

  Object.defineProperty(globalThis, "window", {
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
  Object.defineProperty(globalThis, "self", {
    configurable: true,
    value: dom.window,
  });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
  });

  const { createRoot } = await import("react-dom/client");
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(React.createElement(ReportFilterExample));
    });

    const unit = container.querySelector<HTMLSelectElement>(
      "#report-example-ahu",
    )!;

    const window = container.querySelector<HTMLSelectElement>(
      "#report-example-window",
    )!;

    await act(async () => {
      unit.value = "AHU-02";
      unit.dispatchEvent(
        new dom.window.Event("change", { bubbles: true }),
      );

      window.value = "LATE";
      window.dispatchEvent(
        new dom.window.Event("change", { bubbles: true }),
      );
    });

    const link = Array.from(container.querySelectorAll("a")).find(
      (item) => item.textContent?.trim() === "Open fictional print view",
    )!;

    equal(
      link.getAttribute("href"),
      "/reports/print?ahu=AHU-02&window=LATE",
    );
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
  }
});