import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ArrowRight, MapPin } from 'lucide-react';
import { SIREN_CARD } from '@/lib/sirenStyle';

/**
 * Widget กลางที่ใช้ร่วมกันทุกระบบ (น้ำประปา / ไฟฟ้า / น้ำเสีย / Purified Water)
 * Tone · Panel · KpiCard · StatusCard · DetailsLink · InfoChip
 */

/* ------------------------------------------------------------------ */
/* Tone helpers — สีชุดเดียวกับหน้ารายละเอียด (emerald / cyan / warning / error) */
/* ------------------------------------------------------------------ */
export type Tone = 'ok' | 'run' | 'info' | 'warn' | 'error' | 'idle';

/** แปลงสถานะแบบ string ('error' | 'warn' | 'idle' | อื่น ๆ = ok) เป็น Tone */
export const asTone = (t: string): Tone => (t === 'error' ? 'error' : t === 'warn' ? 'warn' : t === 'idle' ? 'idle' : 'ok');

export const toneBadgeCls: Record<Tone, string> = {
  ok: 'bg-emerald-100 text-emerald-700 border border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800',
  run: 'bg-emerald-100 text-emerald-700 border border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800',
  info: 'bg-cyan-100 text-cyan-700 border border-cyan-300 dark:bg-cyan-950/60 dark:text-cyan-300 dark:border-cyan-800',
  warn: 'bg-warning-50 text-warning-700 border border-warning-200 dark:bg-warning-500/10 dark:text-warning-400 dark:border-warning-800',
  error: 'bg-error-600 text-white animate-pulse',
  idle: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

export function Panel({
  title,
  icon,
  action,
  children,
  className = '',
}: {
  title: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-white/[0.03] ${className}`}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-bold text-gray-900 dark:text-white">
          {icon && <span className="text-gray-400 dark:text-gray-500">{icon}</span>}
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* KPI card                                                            */
/* ------------------------------------------------------------------ */
export function KpiCard({
  icon,
  iconCls,
  label,
  value,
  unit,
  sub,
  progress,
  progressCls = 'from-sky-500 to-cyan-400',
  badge,
  alarm = false,
}: {
  icon: ReactNode;
  iconCls: string;
  label: string;
  value: string;
  unit?: string;
  sub?: ReactNode;
  progress?: number;
  progressCls?: string;
  badge?: ReactNode;
  /** แจ้งเตือน → พื้นแดงอ่อน + แสงฟุ้งแบบไซเรน */
  alarm?: boolean;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border p-4.5 shadow-xs transition hover:shadow-md ${
        alarm ? SIREN_CARD : 'border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${iconCls}`}>{icon}</div>
          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">{label}</span>
        </div>
        {badge}
      </div>
      <div className="mt-3.5 text-2xl font-black tracking-tight tabular-nums text-gray-900 dark:text-white">
        {value}
        {unit && <span className="ml-1 text-sm font-semibold text-gray-500 dark:text-gray-400">{unit}</span>}
      </div>
      {sub && <div className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">{sub}</div>}
      {progress !== undefined && (
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
          <div
            className={`h-full rounded-full bg-gradient-to-r ${progressCls} transition-all duration-700`}
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* กรอบการ์ดตามสถานะ                                                    */
/* ------------------------------------------------------------------ */
/** ขอบการ์ดตาม tone — `ring` = เพิ่มวงแสงจาง ๆ เมื่อ error */
export function toneFrameCls(tone: Tone, { ring = false }: { ring?: boolean } = {}) {
  if (tone === 'error') return ring ? 'border-error-400 ring-1 ring-error-500/20 dark:border-error-700' : 'border-error-400 dark:border-error-700';
  if (tone === 'warn') return 'border-warning-300 dark:border-warning-800';
  return 'border-gray-200 dark:border-gray-800';
}

/* ------------------------------------------------------------------ */
/* ปุ่ม "ดูรายละเอียด" (มุมขวาล่างของการ์ด)                                */
/* ------------------------------------------------------------------ */
export function DetailsLink({ to, label }: { to: string; label?: string }) {
  const { t } = useTranslation();
  return (
    <Link
      to={to}
      className="group inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-600"
    >
      {label ?? t('water_supply.overview.view_details_short')}
      <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* การ์ดสถานะ (หัวการ์ด: ไอคอน + ชื่อ + ตำแหน่ง + ป้ายสถานะ / เนื้อหา / ส่วนท้าย) */
/* ------------------------------------------------------------------ */
export function StatusCard({
  icon,
  iconCls,
  title,
  subtitle,
  status,
  frameCls,
  className = '',
  footer,
  footerCls = 'mt-auto flex items-center justify-between gap-2 border-t border-gray-100 pt-3.5 dark:border-gray-800',
  children,
}: {
  icon: ReactNode;
  /** สีพื้นไอคอน เช่น 'bg-amber-500 text-white' */
  iconCls: string;
  title: ReactNode;
  /** บรรทัดรองใต้ชื่อ (แสดงพร้อมไอคอนหมุด) */
  subtitle?: ReactNode;
  /** ป้ายสถานะมุมขวาบน */
  status?: { tone: Tone; label: ReactNode };
  /** ขอบ + พื้นหลังของการ์ด (เช่น `bg-white dark:bg-white/[0.03] ${toneFrameCls(tone)}` หรือ SIREN_CARD) */
  frameCls: string;
  className?: string;
  footer?: ReactNode;
  footerCls?: string;
  children?: ReactNode;
}) {
  return (
    <div className={`flex flex-col rounded-2xl border p-5 shadow-xs transition hover:shadow-md ${frameCls} ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${iconCls}`}>{icon}</div>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-bold text-gray-900 dark:text-white">{title}</h3>
            {subtitle !== undefined && (
              <p className="flex items-center gap-1 truncate text-[11px] text-gray-500 dark:text-gray-400">
                <MapPin className="h-3 w-3 shrink-0" />
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {status && (
          <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${toneBadgeCls[status.tone]}`}>
            {status.label}
          </span>
        )}
      </div>
      {children}
      {footer && <div className={footerCls}>{footer}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ตารางค่าย่อย 3 ช่อง (ค่าหลักของอุปกรณ์บนการ์ด)                         */
/* ------------------------------------------------------------------ */
export interface MetricItem {
  label: ReactNode;
  value: ReactNode;
  /** สีตัวเลข (ไม่ใส่ = สีปกติ) */
  valueCls?: string;
}
export function MetricGrid({
  items,
  size = 'sm',
  className = 'mt-4',
}: {
  items: MetricItem[];
  /** sm = ตัวเลขเล็ก (text-xs) · md = ตัวเลขใหญ่ขึ้น (text-sm) */
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <div className={`grid grid-cols-3 gap-2 text-center ${className}`}>
      {items.map((x, i) => (
        <div
          key={i}
          className={`rounded-lg border border-gray-100 bg-gray-50 px-2 dark:border-gray-800 dark:bg-white/[0.03] ${size === 'md' ? 'py-2' : 'py-1.5'}`}
        >
          <div className="truncate text-[10px] text-gray-500 dark:text-gray-400">{x.label}</div>
          <div
            className={`font-bold tabular-nums ${size === 'md' ? 'text-sm' : 'text-xs'} ${x.valueCls ?? 'text-gray-800 dark:text-gray-100'}`}
          >
            {x.value}
          </div>
        </div>
      ))}
    </div>
  );
}

/** ชิปข้อมูลเล็ก ๆ ใต้การ์ด (สถานะปั๊ม วาล์ว ฯลฯ) */
export function InfoChip({ label, value, tone = 'idle' }: { label: string; value: string; tone?: Tone }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-lg border border-gray-100 bg-gray-50 px-2 py-1 text-[11px] dark:border-gray-900 dark:bg-white/[0.03]">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className={`rounded px-1.5 py-px text-[10px] font-bold ${toneBadgeCls[tone]}`}>{value}</span>
    </span>
  );
}
