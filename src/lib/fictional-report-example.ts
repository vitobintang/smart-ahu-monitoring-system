// Invented sample data only; not telemetry or a backend contract.
export const EXAMPLE_READINGS = [
  {
    ahuId: "AHU-01",
    source: "SIMULATION",
    parameter: "roomTemp",
    measuredAt: "2026-01-01T09:00:00.000Z",
    value: 20,
    quality: "VALID",
  },
  {
    ahuId: "AHU-01",
    source: "SIMULATION",
    parameter: "roomTemp",
    measuredAt: "2026-01-01T10:00:00.000Z",
    value: 22,
    quality: "VALID",
  },
  {
    ahuId: "AHU-01",
    source: "SIMULATION",
    parameter: "roomTemp",
    measuredAt: "2026-01-01T11:00:00.000Z",
    value: null,
    quality: "MISSING",
  },
  {
    ahuId: "AHU-01",
    source: "SIMULATION",
    parameter: "roomTemp",
    measuredAt: "2026-01-01T12:00:00.000Z",
    value: 24,
    quality: "VALID",
  },
  {
    ahuId: "AHU-01",
    source: "SIMULATION",
    parameter: "roomTemp",
    measuredAt: "2026-01-01T13:00:00.000Z",
    value: 26,
    quality: "ESTIMATED",
  },
  {
    ahuId: "AHU-02",
    source: "SIMULATION",
    parameter: "roomTemp",
    measuredAt: "2026-01-01T09:30:00.000Z",
    value: 19,
    quality: "VALID",
  },
  {
    ahuId: "AHU-02",
    source: "SIMULATION",
    parameter: "roomTemp",
    measuredAt: "2026-01-01T12:30:00.000Z",
    value: 23,
    quality: "VALID",
  },
];

export const WINDOWS = {
  ALL: {
    start: "2026-01-01T09:00:00.000Z",
    end: "2026-01-01T15:00:00.000Z",
  },
  EARLY: {
    start: "2026-01-01T09:00:00.000Z",
    end: "2026-01-01T12:00:00.000Z",
  },
  LATE: {
    start: "2026-01-01T12:00:00.000Z",
    end: "2026-01-01T15:00:00.000Z",
  },
} as const;

export type WindowName = keyof typeof WINDOWS;