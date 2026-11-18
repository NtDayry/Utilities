import type { ReactNode } from 'react';

/**
 * ชิ้นส่วนหน้ารายละเอียดระบบน้ำที่ใช้ร่วมกัน (หน้าถังน้ำ/บ่อเก็บน้ำ และหน้า Purified Water)
 */
export const card = 'rounded-2xl border border-gray-200/80 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800';

/** หัวข้อของการ์ด: ไอคอนในกรอบสี + ชื่อ + คำอธิบาย */
export function CardHeader({ icon, title, hint, action }: { icon: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-200">
          {icon}
        </span>
        <div>
          <h2 className="text-sm font-bold text-gray-900 dark:text-white">{title}</h2>
          {hint && <p className="text-[11px] text-gray-500 dark:text-gray-400">{hint}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

/** ตัวเลขสรุปในแถบหัวหน้า */
export function Kpi({ label, value, unit, sub, children }: { label: string; value: string; unit?: string; sub?: string; children?: ReactNode }) {
  return (
    <div className={`${card} px-4 py-3.5`}>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-2xl font-extrabold tabular-nums tracking-tight text-gray-900 dark:text-white">{value}</span>
        {unit && <span className="text-sm font-semibold text-gray-500 dark:text-gray-400">{unit}</span>}
      </div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-gray-500 dark:text-gray-400">{sub}</div>}
      {children}
    </div>
  );
}

/** วงแหวนระดับน้ำ: สีน้ำที่ตั้งไว้ + ขีดเกณฑ์ต่ำ/สูง */
export function LevelRing({
  percent,
  color,
  low,
  high,
  children,
  className = 'h-40 w-40',
}: {
  percent: number | null;
  color: string;
  low: number;
  high: number;
  children: ReactNode;
  /** ขนาดวงแหวน (SVG ขยายตามกล่อง) */
  className?: string;
}) {
  const R = 64;
  const C = 2 * Math.PI * R;
  const pct = percent === null ? 0 : Math.max(0, Math.min(100, percent));
  const mark = (p: number) => {
    const a = (p / 100) * 2 * Math.PI - Math.PI / 2;
    return { x1: 80 + Math.cos(a) * (R - 11), y1: 80 + Math.sin(a) * (R - 11), x2: 80 + Math.cos(a) * (R + 11), y2: 80 + Math.sin(a) * (R + 11) };
  };
  return (
    <div className={`relative shrink-0 ${className}`}>
      <svg viewBox="0 0 160 160" className="h-full w-full">
        <circle cx="80" cy="80" r={R} fill="none" strokeWidth="12" className="stroke-gray-100 dark:stroke-gray-700" />
        <circle
          cx="80"
          cy="80"
          r={R}
          fill="none"
          stroke={color}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={`${(pct / 100) * C} ${C}`}
          transform="rotate(-90 80 80)"
          style={{ transition: 'stroke-dasharray .8s ease', filter: `drop-shadow(0 0 6px ${color}55)` }}
        />
        <line {...mark(low)} stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" />
        <line {...mark(high)} stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}
