import { hasPermission } from "./permissions";

export type ExampleRole =
  | "Admin"
  | "Engineering"
  | "Operator"
  | "Viewer";

export type ExampleStatus = "RUN" | "STOP" | "FAULT" | "OFFLINE";

export type ExampleCommandType =
  | "START"
  | "STOP"
  | "AUTO"
  | "MANUAL"
  | "SETPOINT";

export type ExampleCommand = {
  type: ExampleCommandType;
  setpoint: number | null;
  state: "REQUESTED" | "ACCEPTED";
  requestedAt: number;
  expiresAt: number;
};

export type ExampleRecord = {
  type: ExampleCommandType;
  state: "SUCCEEDED" | "FAILED" | "EXPIRED";
};

export type ExampleState = {
  role: ExampleRole;
  status: ExampleStatus;
  clock: number;
  active: ExampleCommand | null;
  history: ExampleRecord[];
  notice: string;
};

export function initialExampleState(): ExampleState {
  return {
    role: "Operator",
    status: "STOP",
    clock: 0,
    active: null,
    history: [],
    notice: "No example command yet.",
  };
}

// Practice only: role, status, clock and feedback are not authenticated.
// This is not a real command, authorization or safety implementation.
export function requestExample(
  state: ExampleState,
  type: ExampleCommandType,
  setpointText: string,
): ExampleState {
  if (state.active) {
    return {
      ...state,
      notice: "Example rejected: another example is active.",
    };
  }

  if (!hasPermission(state.role, "commands:request")) {
    return {
      ...state,
      notice: "Example rejected: fictional role cannot issue commands.",
    };
  }

  if (state.status === "OFFLINE") {
    return {
      ...state,
      notice: "Example rejected: fictional unit is OFFLINE.",
    };
  }

  if (state.status === "FAULT" && type !== "STOP") {
    return {
      ...state,
      notice: "Example rejected: fictional FAULT permits only STOP.",
    };
  }

  if (state.clock >= 3600) {
    return {
      ...state,
      notice: "Example clock limit reached. Reset the practice.",
    };
  }

  let setpoint: number | null = null;

  if (type === "SETPOINT") {
    const text = setpointText.trim();

    if (
      text.length > 8 ||
      !/^\d+(?:\.\d+)?$/.test(text) ||
      !Number.isFinite(Number(text)) ||
      Number(text) < 16 ||
      Number(text) > 30
    ) {
      return {
        ...state,
        notice:
          "Example setpoint must be 16 to 30 °C using a decimal dot.",
      };
    }

    setpoint = Number(text);
  }

  return {
    ...state,
    active: {
      type,
      setpoint,
      state: "REQUESTED",
      requestedAt: state.clock,
      expiresAt: state.clock + 60,
    },
    notice: "Example requested; nothing was sent.",
  };
}

export function acceptExample(state: ExampleState): ExampleState {
  if (!state.active || state.active.state !== "REQUESTED") {
    return {
      ...state,
      notice: "No requested example to accept.",
    };
  }

  return {
    ...state,
    active: {
      ...state.active,
      state: "ACCEPTED",
    },
    notice: "Example accepted; no real controller has responded.",
  };
}

function finish(
  state: ExampleState,
  outcome: ExampleRecord["state"],
  notice: string,
): ExampleState {
  if (!state.active) return state;

  return {
    ...state,
    active: null,
    history: [
      { type: state.active.type, state: outcome },
      ...state.history,
    ].slice(0, 20),
    notice,
  };
}

export function confirmExample(state: ExampleState): ExampleState {
  if (!state.active || state.active.state !== "ACCEPTED") {
    return {
      ...state,
      notice: "Accept an example before fictional confirmation.",
    };
  }

  return finish(
    state,
    "SUCCEEDED",
    "Fictional feedback matched. No real controller was contacted.",
  );
}

export function failExample(state: ExampleState): ExampleState {
  if (!state.active) {
    return {
      ...state,
      notice: "No active example to fail.",
    };
  }

  return finish(
    state,
    "FAILED",
    "Example marked failed. Nothing was sent.",
  );
}

export function advanceExampleClock(
  state: ExampleState,
): ExampleState {
  const clock = Math.min(state.clock + 30, 3660);

  const updated = {
    ...state,
    clock,
    notice: "Fictional clock advanced.",
  };

  if (updated.active && clock >= updated.active.expiresAt) {
    return finish(
      updated,
      "EXPIRED",
      "Example expired at its fictional deadline. Nothing was sent.",
    );
  }

  return updated;
}