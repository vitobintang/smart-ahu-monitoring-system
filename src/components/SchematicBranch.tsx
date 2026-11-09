import type { CSSProperties } from "react";
import { cx } from "@/components/ui";
import { TONE, type StageDef } from "./schematic-meta";
export default function SchematicBranch({
  stages,
  running,
  hasHeater,
  damper,
  heater,
  selected,
  onSelect,
}: {
  stages: StageDef[];
  running: boolean;
  hasHeater: boolean;
  damper: number | null;
  heater: number | null;
  selected: string | null;
  onSelect: (k: string | null) => void;
}) {
  const byKey = new Map(stages.map((s) => [s.key as string, s]));
  const open = Math.max(6, Math.min(94, damper ?? 0));
  const heaterOn = (heater ?? 0) > 3;

  const AREAS: Record<string, { x: number; y: number; w: number; h: number }> = {
    damperPosition: { x: 40, y: 52, w: 154, h: 208 },
    filterDiffPressure: { x: 206, y: 52, w: 144, h: 208 },
    coilTemp: { x: 366, y: 52, w: 204, h: 224 },
    heaterOutput: { x: 586, y: 52, w: 144, h: 208 },
    fanSpeed: { x: 746, y: 52, w: 264, h: 208 },
  };

  return (
    <div className="animate-fade">
      <div className="overflow-x-auto rounded-xl border border-[#e4eaf3] bg-gradient-to-b from-[#fbfdff] to-[#eef3fa] p-2">
        <svg viewBox="0 0 1040 336" className="min-w-[760px] w-full">
          <defs>
            <linearGradient id="sch-casing" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fdfeff" />
              <stop offset="55%" stopColor="#e8edf4" />
              <stop offset="100%" stopColor="#cfd8e3" />
            </linearGradient>
            <linearGradient id="sch-metal" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#f4f7fa" />
              <stop offset="50%" stopColor="#b9c4d2" />
              <stop offset="100%" stopColor="#8494a7" />
            </linearGradient>
            <linearGradient id="sch-copper" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#d98e5f" />
              <stop offset="50%" stopColor="#b4653a" />
              <stop offset="100%" stopColor="#8c4a26" />
            </linearGradient>
            <linearGradient id="sch-pan" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#dfe6ee" />
              <stop offset="100%" stopColor="#aeb9c8" />
            </linearGradient>
            <filter id="sch-glow" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="4" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <rect x={20} y={288} width={1000} height={14} rx={3} fill="url(#sch-metal)" stroke="#8494a7" strokeWidth={1} />
          {[60, 340, 620, 940].map((x) => (
            <rect key={x} x={x} y={302} width={26} height={10} rx={2} fill="#94a3b8" />
          ))}
          <rect x={24} y={36} width={992} height={252} rx={12} fill="url(#sch-casing)" stroke="#94a3b8" strokeWidth={1.6} />
          <line x1={44} y1={50} x2={996} y2={50} stroke="#22d3ee" strokeWidth={2.5} opacity={0.55} filter="url(#sch-glow)" />
          {[198, 358, 578, 738].map((x) => (
            <line key={x} x1={x} y1={40} x2={x} y2={284} stroke="#b6c2d1" strokeWidth={1.4} strokeDasharray="6 5" />
          ))}
          <g>
            <rect x={48} y={60} width={138} height={192} rx={6} fill="#f2f6fb" stroke="#8494a7" strokeWidth={1.4} />
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <rect
                key={i}
                x={56}
                y={72 + i * 25}
                width={122}
                height={7}
                rx={3.5}
                fill="url(#sch-metal)"
                stroke="#64748b"
                strokeWidth={0.7}
                transform={`rotate(${-(open / 100) * 62} 117 ${75 + i * 25})`}
              />
            ))}
            <line x1={180} y1={70} x2={180} y2={248} stroke="#64748b" strokeWidth={2} opacity={0.7} />
          </g>
          <g>
            <rect x={214} y={60} width={128} height={192} rx={6} fill="#f7f4ec" stroke="#8494a7" strokeWidth={1.4} />
            {Array.from({ length: 11 }, (_, i) => (
              <path
                key={i}
                d={`M${220 + i * 11} 66 L${226 + i * 11} 156 L${220 + i * 11} 246`}
                fill="none"
                stroke="#c9b896"
                strokeWidth={2.2}
              />
            ))}
            <rect x={214} y={60} width={128} height={192} rx={6} fill="#a16207" opacity={Math.min(0.3, ((byKey.get("filterDiffPressure")?.sub.match(/\d+/)?.[0] ?? 0) as number) / 900)} />
          </g>
          <g>
            <rect x={376} y={60} width={184} height={172} rx={4} fill="#e6edf5" stroke="#8494a7" strokeWidth={1.2} />
            {Array.from({ length: 30 }, (_, i) => (
              <line key={i} x1={380 + i * 6} y1={64} x2={380 + i * 6} y2={228} stroke="#9fb0c2" strokeWidth={1} opacity={0.75} />
            ))}
            <rect x={370} y={60} width={7} height={172} rx={3} fill="url(#sch-copper)" />
            <rect x={559} y={60} width={7} height={172} rx={3} fill="url(#sch-copper)" />
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <path key={i} d={`M370 ${74 + i * 30} q -12 9 0 18`} fill="none" stroke="url(#sch-copper)" strokeWidth={3.4} />
            ))}
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <path key={`r${i}`} d={`M566 ${89 + i * 30} q 12 9 0 18`} fill="none" stroke="url(#sch-copper)" strokeWidth={3.4} />
            ))}
            <rect x={386} y={240} width={164} height={26} rx={5} fill="url(#sch-pan)" stroke="#8494a7" strokeWidth={1.2} />
            <line x1={392} y1={250} x2={544} y2={250} stroke="#7dd3fc" strokeWidth={2.5} opacity={0.8} />
            <rect x={462} y={266} width={12} height={14} rx={2} fill="#94a3b8" />
          </g>
          {hasHeater ? (
            <g>
              {[0, 1, 2].map((r) => (
                <g key={r}>
                  <path
                    d={`M596 ${96 + r * 58} q 10 -9 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0`}
                    fill="none"
                    stroke="#94a3b8"
                    strokeWidth={6}
                    strokeLinecap="round"
                  />
                  <path
                    d={`M596 ${96 + r * 58} q 10 -9 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0`}
                    fill="none"
                    stroke="#f59e0b"
                    strokeWidth={6}
                    strokeLinecap="round"
                    opacity={heaterOn ? 0.9 : 0.08}
                    filter="url(#sch-glow)"
                  />
                </g>
              ))}
              <rect x={590} y={60} width={6} height={192} rx={3} fill="#8494a7" />
              <rect x={722} y={60} width={6} height={192} rx={3} fill="#8494a7" />
            </g>
          ) : (
            <g opacity={0.5}>
              <rect x={596} y={70} width={126} height={172} rx={6} fill="none" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="8 6" />
              <text x={659} y={160} textAnchor="middle" fontSize={11} fill="#94a3b8">
                not installed
              </text>
            </g>
          )}
          <g>
            <circle cx={866} cy={152} r={88} fill="#eef3f9" stroke="#8494a7" strokeWidth={2} />
            <circle cx={866} cy={152} r={80} fill="#dfe7f0" stroke="#b6c2d1" strokeWidth={1} />
            <g
              style={{
                transformOrigin: "866px 152px",
                animation: running ? "spin 1.15s linear infinite" : undefined,
              }}
            >
              {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                <path
                  key={i}
                  d="M 10 -14 Q 42 -44 72 -27 Q 52 -2 13 6 Z"
                  fill="url(#sch-metal)"
                  stroke="#64748b"
                  strokeWidth={1}
                  transform={`translate(866 152) rotate(${i * 40})`}
                />
              ))}
              <circle cx={866} cy={152} r={16} fill="url(#sch-metal)" stroke="#64748b" strokeWidth={1.4} />
              <circle cx={866} cy={152} r={5} fill="#475569" />
            </g>
            <rect x={952} y={112} width={56} height={80} rx={6} fill="url(#sch-casing)" stroke="#8494a7" strokeWidth={1.4} />
            <rect x={944} y={204} width={62} height={34} rx={7} fill="url(#sch-metal)" stroke="#64748b" strokeWidth={1.2} />
            {[0, 1, 2, 3].map((i) => (
              <line key={i} x1={952 + i * 14} y1={208} x2={952 + i * 14} y2={234} stroke="#64748b" strokeWidth={1.4} opacity={0.6} />
            ))}
          </g>
          <g className={cx(!running && "flow-line-paused")} style={{ pointerEvents: "none" }}>
            <path
              d="M 30 156 L 742 156"
              fill="none"
              stroke="#38bdf8"
              strokeWidth={3}
              className="flow-line"
              style={
                {
                  "--flow-offset": "-208",
                  strokeDasharray: "14 12",
                  animationDuration: "2.8s",
                  opacity: running ? 0.85 : undefined,
                } as CSSProperties
              }
            />
            {[198, 358, 578, 738].map((x) => (
              <path key={x} d={`M ${x - 7} 148 L ${x + 5} 156 L ${x - 7} 164 Z`} fill="#38bdf8" opacity={running ? 0.9 : 0.3} />
            ))}
            <path
              d="M 986 152 L 1024 152"
              fill="none"
              stroke="#38bdf8"
              strokeWidth={3.4}
              className="flow-line"
              style={
                {
                  "--flow-offset": "-176",
                  strokeDasharray: "12 10",
                  animationDuration: "2.0s",
                } as CSSProperties
              }
            />
            <path d="M 1016 144 L 1032 152 L 1016 160 Z" fill="#38bdf8" opacity={running ? 0.95 : 0.3} />
          </g>
          {stages.map((s) => {
            const a = AREAS[s.key as string];
            if (!a) return null;
            const c = TONE[s.state];
            const isSel = selected === s.key;
            return (
              <g key={s.key}>
                <rect x={a.x} y={a.y} width={a.w} height={a.h} rx={9} fill={c.stroke} opacity={s.state === "ok" ? 0.04 : 0.1} className={cx(s.state === "alarm" && "animate-blink")} style={{ pointerEvents: "none" }} />
                <rect
                  x={a.x}
                  y={a.y}
                  width={a.w}
                  height={a.h}
                  rx={9}
                  fill="none"
                  stroke={isSel ? "#2563eb" : c.stroke}
                  strokeWidth={isSel ? 3 : 2}
                  opacity={isSel ? 1 : s.state === "alarm" ? 0.85 : 0.35}
                  className={cx(s.state === "alarm" && "animate-blink")}
                  style={{ pointerEvents: "none", transition: "opacity 140ms ease" }}
                />
                <rect
                  x={a.x}
                  y={a.y}
                  width={a.w}
                  height={a.h}
                  rx={9}
                  fill="transparent"
                  style={{ cursor: "pointer" }}
                  onClick={() => onSelect(isSel ? null : (s.key as string))}
                >
                  <title>{`${s.label} — ${s.sub}`}</title>
                </rect>
                <text x={a.x + a.w / 2} y={306} textAnchor="middle" fontSize={11} fontWeight={700} fill="#475569">
                  {s.label}
                </text>
                <text x={a.x + a.w / 2} y={322} textAnchor="middle" fontSize={10.5} fill={c.stroke} fontWeight={600} fontFamily="ui-monospace, monospace">
                  {s.sub}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <p className="mt-2.5 text-[10px] leading-relaxed text-slate-500">
        Engineering cross-section: louver angle, impeller rotation, heater glow and condensate level follow live
        telemetry; click a section for its limits, delay, priority and data quality. Direct low-level actuator control
        of the coil / heater / damper is out of scope (constraint 3).
      </p>
    </div>
  );
}
