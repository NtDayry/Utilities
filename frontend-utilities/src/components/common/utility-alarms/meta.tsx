import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Waves, Zap, Recycle, Droplets, Cog, Container, Gauge, Bolt, Cable, Snowflake, Wind, FlaskConical, ServerCog, TestTubeDiagonal } from 'lucide-react';
import { URL } from '@/api';
import type { AlarmGroupDef, AlarmSeverity, UtilitySystem } from '@/lib/utilityAlarms';
import { fmtNum as baseFmtNum } from '@/utils/format';

export interface SystemMeta {
  icon: ReactNode;
  accent: string; // tailwind text color
  accentBg: string;
  alarmsPath: string;
  settingsPath: string;
  dashboardPath: string;
}

export const SYSTEM_META: Record<UtilitySystem, SystemMeta> = {
  water: {
    icon: <Waves className="size-6" />,
    accent: 'text-sky-600 dark:text-sky-400',
    accentBg: 'bg-sky-50 dark:bg-sky-500/10',
    alarmsPath: URL.WATER_SUPPLY_ALARMS,
    settingsPath: URL.WATER_SUPPLY_ALARM_SETTINGS,
    dashboardPath: URL.WATER_SUPPLY_DASHBOARD,
  },
  electrical: {
    icon: <Zap className="size-6" />,
    accent: 'text-amber-600 dark:text-amber-400',
    accentBg: 'bg-amber-50 dark:bg-amber-500/10',
    alarmsPath: URL.ELECTRICAL_ALARMS,
    settingsPath: URL.ELECTRICAL_SETTINGS,
    dashboardPath: URL.ELECTRICAL_DASHBOARD,
  },
  wastewater: {
    icon: <Recycle className="size-6" />,
    accent: 'text-teal-600 dark:text-teal-400',
    accentBg: 'bg-teal-50 dark:bg-teal-500/10',
    alarmsPath: URL.WASTEWATER_ALARMS,
    settingsPath: URL.WASTEWATER_SETTINGS,
    dashboardPath: URL.WASTEWATER_DASHBOARD,
  },
};

const GROUP_ICONS: Record<AlarmGroupDef['icon'], ReactNode> = {
  pond: <Droplets className="size-5" />,
  pump: <Cog className="size-5" />,
  tank: <Container className="size-5" />,
  meter: <Gauge className="size-5" />,
  bolt: <Bolt className="size-5" />,
  transformer: <Cable className="size-5" />,
  chiller: <Snowflake className="size-5" />,
  air: <Wind className="size-5" />,
  process: <FlaskConical className="size-5" />,
  panel: <ServerCog className="size-5" />,
  quality: <TestTubeDiagonal className="size-5" />,
};
export const groupIcon = (g: AlarmGroupDef) => GROUP_ICONS[g.icon];

export const SEVERITY_STYLE: Record<AlarmSeverity, { pill: string; dot: string; chart: string }> = {
  critical: { pill: 'bg-error-50 text-error-700 ring-error-200 dark:bg-error-500/15 dark:text-error-400 dark:ring-error-500/30', dot: 'bg-error-500', chart: '#ef4444' },
  warning: { pill: 'bg-warning-50 text-warning-700 ring-warning-200 dark:bg-warning-500/15 dark:text-warning-400 dark:ring-warning-500/30', dot: 'bg-warning-500', chart: '#f59e0b' },
  info: { pill: 'bg-blue-light-50 text-blue-light-700 ring-blue-light-200 dark:bg-blue-light-500/15 dark:text-blue-light-400 dark:ring-blue-light-500/30', dot: 'bg-blue-light-500', chart: '#0ba5ec' },
};

/** ตัวเลขของหน้าแจ้งเตือน (ค่าว่างแสดง "–") */
export const fmtNum = (v: number | null | undefined, dp: number) => baseFmtNum(v, dp, '–');

export function useFmtDuration() {
  const { t } = useTranslation();
  return (sec: number | null) => {
    if (sec === null) return '–';
    if (sec < 60) return t('utility_alarms.dur.s', { s: sec });
    const m = Math.floor(sec / 60);
    if (m < 60) return t('utility_alarms.dur.m', { m });
    const h = Math.floor(m / 60);
    if (h < 24) return t('utility_alarms.dur.hm', { h, m: m % 60 });
    return t('utility_alarms.dur.dh', { d: Math.floor(h / 24), h: h % 24 });
  };
}

export const card = 'rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]';
export const inputCls =
  'h-9 w-full rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30 disabled:opacity-60';
