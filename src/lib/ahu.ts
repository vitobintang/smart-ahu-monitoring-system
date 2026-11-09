export const AHU_IDS = [
  "GTM-DAIKIN-001",
] as const;

export type AhuId = (typeof AHU_IDS)[number];

export const SENSOR_PARAMETERS = [
  { key: "roomTemp", label: "Room temperature", unit: "°C" },
  { key: "supplyTemp", label: "Supply temperature", unit: "°C" },
  { key: "returnTemp", label: "Return temperature", unit: "°C" },
  { key: "humidity", label: "Humidity", unit: "%" },
  { key: "filterDiffPressure", label: "Filter differential pressure", unit: "Pa" },
  { key: "fanSpeed", label: "Fan speed", unit: "%" },
  { key: "coilTemp", label: "Coil temperature", unit: "°C" },
  { key: "damperPosition", label: "Damper position", unit: "%" },
  { key: "current", label: "Current", unit: "A" },
  { key: "voltage", label: "Voltage", unit: "V" },
  { key: "runHours", label: "Operating hours", unit: "h" },
  { key: "heaterOutput", label: "Heater output", unit: "%" },
] as const;

export type SensorKey = (typeof SENSOR_PARAMETERS)[number]["key"];

export const AHU_STATUSES = ["RUN", "STOP", "FAULT", "OFFLINE"] as const;
export type AhuStatus = (typeof AHU_STATUSES)[number];

export const DATA_SOURCES = ["PHYSICAL", "SIMULATION"] as const;
export type DataSource = (typeof DATA_SOURCES)[number];

export const USER_ROLES = ["Admin", "Engineering", "Operator"] as const;
export type UserRole = (typeof USER_ROLES)[number];