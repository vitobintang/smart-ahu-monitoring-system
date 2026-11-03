// A self-contained teaching example. This is not an alarm engine.
export type ExampleCondition = "NORMAL" | "HIGH" | "UNKNOWN";

export type ExampleAlarm = {
  id: number;
  activatedAt: number;
  resolvedAt: number | null;
  acknowledgedAt: number | null;
};

export type ExampleAlarmState = {
  seconds: number;
  condition: ExampleCondition;
  pendingSince: number | null;
  nextId: number;
  alarms: ExampleAlarm[];
};

export type ExampleAlarmAction =
  | { type: "condition"; value: ExampleCondition }
  | { type: "advance" }
  | { type: "acknowledge"; id: number }
  | { type: "reset" };

export function initialExampleAlarmState(): ExampleAlarmState {
  return {
    seconds: 0,
    condition: "NORMAL",
    pendingSince: null,
    nextId: 1,
    alarms: [],
  };
}

export function exampleAlarmReducer(
  state: ExampleAlarmState,
  action: ExampleAlarmAction,
): ExampleAlarmState {
  switch (action.type) {
    case "reset":
      return initialExampleAlarmState();

    case "condition": {
      if (action.value === state.condition) return state;

      const active = state.alarms.some(
        (alarm) => alarm.resolvedAt === null,
      );

      return {
        ...state,
        condition: action.value,

        // Unknown breaks the example delay; it never resolves an active alarm.
        pendingSince:
          action.value === "HIGH" && !active ? state.seconds : null,

        alarms:
          action.value === "NORMAL"
            ? state.alarms.map((alarm) =>
                alarm.resolvedAt === null
                  ? { ...alarm, resolvedAt: state.seconds }
                  : alarm,
              )
            : state.alarms,
      };
    }

    case "advance": {
      const seconds = state.seconds + 10;

      if (
        state.condition !== "HIGH" ||
        state.pendingSince === null ||
        seconds - state.pendingSince < 20
      ) {
        return { ...state, seconds };
      }

      const alarm: ExampleAlarm = {
        id: state.nextId,
        activatedAt: seconds,
        resolvedAt: null,
        acknowledgedAt: null,
      };

      return {
        ...state,
        seconds,
        pendingSince: null,
        nextId: state.nextId + 1,
        alarms: [alarm, ...state.alarms].slice(0, 10),
      };
    }

    case "acknowledge":
      return {
        ...state,
        alarms: state.alarms.map((alarm) =>
          alarm.id === action.id && alarm.acknowledgedAt === null
            ? { ...alarm, acknowledgedAt: state.seconds }
            : alarm,
        ),
      };
  }
}