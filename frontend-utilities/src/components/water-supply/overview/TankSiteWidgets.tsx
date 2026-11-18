import type { ReactNode } from 'react';
import { SIREN_CARD } from '@/lib/sirenStyle';
import { useTranslation } from 'react-i18next';
import { Clock, PlugZap } from 'lucide-react';
import type { TankGroup } from '@/lib/waterTanks';
import { DetailsLink, StatusCard, type Tone } from '@/components/common/widgets/StatusWidgets';

/** Widget เฉพาะระบบน้ำ (บ่อ/ถัง): สถานะจุดเก็บน้ำ · MiniTank · TankSiteCard · SourceChip */
/* ------------------------------------------------------------------ */
/* สถานะของแต่ละจุดเก็บน้ำ                                              */
/* ------------------------------------------------------------------ */
export type SiteStatus = 'normal' | 'low' | 'high' | 'alarm' | 'offline' | 'connecting' | 'no-sensor';

export const SITE_STATUS_TONE: Record<SiteStatus, Tone> = {
  normal: 'ok',
  low: 'error',
  high: 'warn',
  alarm: 'error',
  offline: 'idle',
  connecting: 'warn',
  'no-sensor': 'idle',
};

export const NEEDS_ATTENTION: SiteStatus[] = ['low', 'high', 'alarm', 'offline'];

export function useSiteStatusLabel() {
  const { t } = useTranslation();
  return (s: SiteStatus) =>
    ({
      normal: t('water_supply.overview.status_normal'),
      low: t('water_supply.overview.status_low'),
      high: t('water_supply.overview.status_high'),
      alarm: t('water_supply.overview.status_alarm'),
      offline: t('water_supply.overview.status_offline'),
      connecting: t('water_supply.overview.status_connecting'),
      'no-sensor': t('water_supply.overview.status_no_sensor'),
    })[s];
}

const GROUP_FILL: Record<TankGroup, string> = {
  supply: 'from-sky-500 to-cyan-300',
  pw: 'from-emerald-500 to-teal-300',
  effluent: 'from-teal-600 to-lime-300',
};
export const GROUP_ICON_CLS: Record<TankGroup, string> = {
  supply: 'bg-sky-500 text-white',
  pw: 'bg-emerald-500 text-white',
  effluent: 'bg-teal-600 text-white',
};

/* ------------------------------------------------------------------ */
/* Mini tank graphic                                                   */
/* ------------------------------------------------------------------ */
export function MiniTank({
  percent,
  status,
  group,
  lowPct,
  highPct,
  size = 'md',
}: {
  percent: number | null;
  status: SiteStatus;
  group: TankGroup;
  lowPct: number;
  highPct: number;
  size?: 'md' | 'lg';
}) {
  const dims = size === 'lg' ? 'h-64 w-36' : 'h-32 w-20';
  if (status === 'no-sensor' || percent === null) {
    return (
      <div
        className={`relative ${dims} flex shrink-0 items-center justify-center rounded-b-2xl rounded-t-md border-2 border-dashed border-gray-300 bg-[repeating-linear-gradient(135deg,transparent,transparent_6px,rgba(148,163,184,0.12)_6px,rgba(148,163,184,0.12)_12px)] dark:border-gray-700`}
      >
        <PlugZap className={`${size === 'lg' ? 'h-9 w-9' : 'h-6 w-6'} text-gray-300 dark:text-gray-600`} />
      </div>
    );
  }
  const pct = Math.min(100, Math.max(0, percent));
  // สีน้ำตามระดับเท่านั้น (ต่ำกว่าเกณฑ์ = แดง, เกินเกณฑ์สูง = เหลือง) — alarm อื่น ๆ (ปั๊ม/มิเตอร์) แสดงที่กรอบการ์ดแทน
  const fill = pct < lowPct ? 'from-error-500 to-error-300' : pct > highPct ? 'from-warning-500 to-warning-300' : GROUP_FILL[group];
  const dim = status === 'offline' ? 'opacity-40 grayscale' : '';

  return (
    <div
      className={`relative ${dims} shrink-0 overflow-hidden rounded-b-2xl rounded-t-md border-2 border-gray-300 bg-gray-50 shadow-inner dark:border-gray-700 dark:bg-gray-950`}
    >
      <div
        className={`absolute bottom-0 w-full bg-gradient-to-t ${fill} transition-all duration-700 ${dim}`}
        style={{ height: `${pct}%` }}
      >
        <div className="absolute inset-x-0 top-0 h-1 animate-pulse bg-white/50" />
      </div>
      <div className="absolute w-full border-t border-dashed border-warning-500/70" style={{ bottom: `${highPct}%` }} />
      <div className="absolute w-full border-t border-dashed border-error-500/70" style={{ bottom: `${lowPct}%` }} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tank site card — 1 การ์ดต่อ 1 จุดเก็บน้ำ                            */
/* ------------------------------------------------------------------ */
export function TankSiteCard({
  name,
  location,
  unitCount,
  icon,
  group,
  status,
  percent,
  levelText,
  volume_m3,
  capacity_m3,
  lowPct,
  highPct,
  updatedAt,
  detailPath,
  source,
  children,
}: {
  name: string;
  location: string;
  unitCount?: string;
  icon: ReactNode;
  group: TankGroup;
  status: SiteStatus;
  percent: number | null;
  levelText: string;
  volume_m3: number | null;
  capacity_m3: number;
  lowPct: number;
  highPct: number;
  updatedAt: number | null;
  detailPath: string;
  /** แหล่งข้อมูลของจุดนี้ (เช่น MQTT + topic) แสดงที่ท้ายการ์ด — แต่ละระบบกำหนดเอง */
  source?: SiteSource;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const statusLabel = useSiteStatusLabel();
  const tone = SITE_STATUS_TONE[status];
  const noSensor = status === 'no-sensor';

  // แจ้งเตือน (ระดับต่ำ / alarm): พื้นแดงอ่อนโปร่งใส + แสงแดงฟุ้งรอบขอบกะพริบแบบไซเรน
  const frame =
    status === 'low' || status === 'alarm'
      ? SIREN_CARD
      : status === 'high'
      ? 'border-warning-300 bg-white dark:border-warning-800 dark:bg-gray-800'
      : 'border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-800';

  return (
    <StatusCard
      className="mt-5"
      frameCls={frame}
      icon={icon}
      iconCls={noSensor ? 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500' : GROUP_ICON_CLS[group]}
      title={name}
      subtitle={
        <>
          {location}
          {unitCount && <span className="text-gray-400 dark:text-gray-500">· {unitCount}</span>}
        </>
      }
      status={{ tone, label: statusLabel(status) }}
      // footer — mt-auto: ชิดล่างเสมอ ให้ส่วนท้ายของทุกการ์ดในแถวเดียวกันอยู่ระดับเท่ากัน
      footerCls="mt-auto flex items-end justify-between gap-2 border-t border-gray-100 pt-4 dark:border-gray-700"
      footer={
        <>
          <div className="flex min-w-0 flex-col items-start gap-1.5">
            {/* ชนิดการเชื่อมต่อ + สถานะ (จุดสี) */}
            <SourceChip source={source ?? { label: t('water_supply.overview.no_data_source'), state: 'none' }} />
            {/* เวลาของข้อมูลล่าสุดที่ได้รับ */}
            <span className="flex items-center gap-1 text-[11px] text-gray-400 dark:text-gray-500">
              <Clock className="h-3 w-3" />
              {t('water_supply.last_updated')}: {updatedAt ? new Date(updatedAt).toLocaleTimeString() : '—'}
            </span>
          </div>
          <DetailsLink to={detailPath} />
        </>
      }
    >
      {/* body */}
      <div className="mt-4 flex items-center gap-4">
        <MiniTank percent={percent} status={status} group={group} lowPct={lowPct} highPct={highPct} />
        <div className="min-w-0 flex-1 space-y-2">
          <div
            className={`text-3xl font-black tabular-nums tracking-tight ${
              noSensor ? 'text-gray-300 dark:text-gray-600' : 'text-gray-900 dark:text-white'
            }`}
          >
            {percent === null ? '—' : percent.toFixed(1)}
            <span className="ml-0.5 text-base font-semibold text-gray-400">%</span>
          </div>
          <div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400">{t('water_supply.current_level')}</div>
            <div className="text-sm font-bold tabular-nums text-gray-800 dark:text-gray-100">{levelText}</div>
          </div>
          <div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400">{t('water_supply.overview.volume_capacity')}</div>
            <div className="text-sm font-bold tabular-nums text-gray-800 dark:text-gray-100">
              {volume_m3 === null ? '—' : volume_m3.toFixed(1)}
              <span className="ml-1 text-xs font-medium text-gray-400">/ {capacity_m3.toFixed(1)} m³</span>
            </div>
          </div>
        </div>
      </div>

      {children && <div className="mt-4 flex flex-wrap gap-1.5">{children}</div>}
      <div className="min-h-4 flex-1" />
    </StatusCard>
  );
}

/** แหล่งข้อมูลของจุด: ชนิดการเชื่อมต่อ + สถานะ (รายละเอียด เช่น topic อยู่ใน title — แสดงเมื่อชี้เมาส์) */
export interface SiteSource {
  label: string;
  /** รายละเอียด (เช่น topic) — ไม่แสดงบนชิป ใช้ใน tooltip */
  detail?: string;
  /** live = ได้ข้อมูลล่าสุด · wait = กำลังเชื่อมต่อ/ข้อมูลค้าง · off = ขาดการเชื่อมต่อ · none = ยังไม่ได้ตั้งค่า */
  state: 'live' | 'wait' | 'off' | 'none';
  title?: string;
}

const SOURCE_DOT: Record<SiteSource['state'], string> = {
  live: 'bg-emerald-500',
  wait: 'bg-warning-500',
  off: 'bg-error-500',
  none: 'bg-gray-300 dark:bg-gray-600',
};

export function SourceChip({ source }: { source: SiteSource }) {
  return (
    <span
      title={source.title ?? [source.label, source.detail].filter(Boolean).join(' · ')}
      className="inline-flex max-w-[15rem] min-w-0 items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-600 dark:border-gray-700 dark:bg-white/[0.04] dark:text-gray-300"
    >
      <span className="relative flex h-2 w-2 shrink-0">
        {source.state === 'live' && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${SOURCE_DOT[source.state]}`} />
      </span>
      <span className="font-bold">{source.label}</span>
    </span>
  );
}
