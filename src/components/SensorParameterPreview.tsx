
import { SENSOR_PARAMETERS, type SensorKey } from "../lib/ahu";

const GROUPS = [
  { key: "temperature", title: "Temperature" },
  { key: "air", title: "Air and equipment" },
  { key: "operation", title: "Electrical and operation" },
] as const;

type GroupKey = (typeof GROUPS)[number]["key"];

// Presentation categories only; these do not establish sensor installation.
const GROUP_FOR_SENSOR: Record<SensorKey, GroupKey> = {
  roomTemp: "temperature",
  supplyTemp: "temperature",
  returnTemp: "temperature",
  coilTemp: "temperature",
  humidity: "air",
  filterDiffPressure: "air",
  fanSpeed: "air",
  damperPosition: "air",
  current: "operation",
  voltage: "operation",
  runHours: "operation",
  heaterOutput: "operation",
};

export default function SensorParameterPreview() {
  return (
    <section aria-labelledby="sensors-heading" className="mt-9">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2
            id="sensors-heading"
            className="text-xl font-bold text-[#12294d]"
          >
            Sensor parameters
          </h2>

          <p className="mt-1 text-sm leading-6 text-slate-600">
            Planned types only. Installation and readings are unknown. Units are
            preliminary and need equipment confirmation.
          </p>

          <p className="mt-1 text-xs leading-5 text-slate-500">
            This list does not display the historical observations above.
          </p>
        </div>

        <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-800">
          {SENSOR_PARAMETERS.length} planned types
        </span>
      </div>

      <div className="mt-5 space-y-6">
        {GROUPS.map((group) => {
          const sensors = SENSOR_PARAMETERS.filter(
            (sensor) => GROUP_FOR_SENSOR[sensor.key] === group.key,
          );

          return (
            <section
              key={group.key}
              aria-labelledby={`sensor-group-${group.key}`}
            >
              <div className="flex items-center justify-between gap-3">
                <h3
                  id={`sensor-group-${group.key}`}
                  className="text-base font-bold text-[#12294d]"
                >
                  {group.title}
                </h3>

                <span className="text-xs text-slate-500">
                  {sensors.length} planned types
                </span>
              </div>

              <dl className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {sensors.map((sensor) => (
                  <div
                    key={sensor.key}
                    className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                  >
                    <dt className="text-sm font-medium text-slate-600">
                      {sensor.label}{" "}
                      <span className="text-xs text-slate-500">
                        ({sensor.unit})
                      </span>
                    </dt>

                    <dd className="mt-3">
                      <span className="block text-lg font-bold text-slate-700">
                        Unavailable
                      </span>
                      <span className="mt-2 block text-xs text-slate-500">
                        Installation unknown
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          );
        })}
      </div>
    </section>
  );
}