import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ColorPickerPopover } from '@/components/common/reports/ReportCharts';
import LiveTrendChart, { type TrendPoint } from '@/components/common/charts/LiveTrendChart';
import { SIREN_CARD } from '@/lib/sirenStyle';

interface Props {
  title: string;
  /** หน่วยที่แสดงใน Min/Max/Avg และกล่อง LIVE */
  unit: string;
  points: TrendPoint[];
  /** ค่าปัจจุบัน (null = ยังไม่มีข้อมูล) */
  current: number | null;
  /** ข้อความต่อท้ายค่าปัจจุบัน เช่น "(88.7%)" */
  currentSuffix?: string;
  defaultColor: string;
  decimals?: number;
  /** ทศนิยมของค่าในกล่อง LIVE (ค่าเริ่มต้น = decimals) */
  currentDecimals?: number;
  height?: number;
  limits?: { y: number; label: string; color: string }[];
  /** คลาสกรอบการ์ด (แทนค่าเริ่มต้นทั้งหมด) — ใช้ให้เข้ากับการ์ดของหน้านั้น ๆ */
  boxClassName?: string;
  /** คลาสเพิ่มเติม (เช่น flex-1 ให้ยืดเต็มคอลัมน์) */
  className?: string;
  /** แจ้งเตือน (เช่น flow_alarm จากมิเตอร์น้ำ) → กรอบแดง + ป้ายเตือน */
  alarm?: boolean;
  alarmLabel?: string;
}

const DEFAULT_BOX = 'rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-white/[0.03]';

/**
 * การ์ดกราฟแนวโน้มแบบสด (รูปแบบเดียวกับหน้ารายละเอียดระบบประปาและปั๊มน้ำ):
 * หัวการ์ด + เลือกสี + Min/Max/Avg + กล่อง LIVE แล้วตามด้วย LiveTrendChart (อัปเดตเฉพาะข้อมูล ไม่สร้างกราฟใหม่)
 */
export default function TrendCard({
  title,
  unit,
  points,
  current,
  currentSuffix,
  defaultColor,
  decimals = 1,
  currentDecimals,
  height = 280,
  limits,
  boxClassName = DEFAULT_BOX,
  className = '',
  alarm = false,
  alarmLabel,
}: Props) {
  const { t } = useTranslation();
  const [color, setColor] = useState(defaultColor);
  const ys = points.map((p) => p.y).filter((v) => Number.isFinite(v));
  const fallback = current ?? 0;
  const min = ys.length ? Math.min(...ys) : fallback;
  const max = ys.length ? Math.max(...ys) : fallback;
  const avg = ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : fallback;
  const u = unit ? ` ${unit}` : '';

  return (
    <div className={`${alarm ? `rounded-2xl border ${SIREN_CARD}` : boxClassName} px-3 ps-0 ${className}`}>
      <div className="max-w-full overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 p-4 pb-0 sm:flex-nowrap sm:p-5 sm:pb-0">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 [&>*]:shrink-0">
              <h3 className="text-sm font-bold text-gray-800 sm:text-base dark:text-white/[0.9]">{title}</h3>
              <ColorPickerPopover currentColor={color} onChange={setColor} onReset={() => setColor(defaultColor)} />
              {alarm && (
                <span className="inline-flex animate-pulse items-center whitespace-nowrap rounded-full bg-error-600 px-2.5 py-0.5 text-[11px] font-bold text-white">
                  {alarmLabel ?? 'ALARM'}
                </span>
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-3">
              <span className="text-xs font-semibold text-warning-500 sm:text-sm">
                {t('water_supply.min')}: {min.toFixed(decimals)}
                {u}
              </span>
              <span className="text-xs font-semibold text-error-500 sm:text-sm">
                {t('water_supply.max')}: {max.toFixed(decimals)}
                {u}
              </span>
              <span className="text-xs font-semibold text-blue-500 sm:text-sm">
                {t('water_supply.avg')}: {avg.toFixed(decimals)}
                {u}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 whitespace-nowrap dark:border-gray-700/60 dark:bg-white/[0.03]">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
            </span>
            <span className="text-xs font-semibold tracking-wider text-gray-500 uppercase dark:text-gray-400">{t('water_supply.live')}</span>
            <h3 className="text-sm font-bold tracking-tight sm:text-base" style={{ color }}>
              {current === null ? '—' : current.toFixed(currentDecimals ?? decimals)}{' '}
              <span className="text-xs font-normal text-gray-500 sm:text-sm dark:text-gray-400">
                {unit}
                {currentSuffix ? ` ${currentSuffix}` : ''}
              </span>
            </h3>
          </div>
        </div>
        <LiveTrendChart
          name={`${title}${unit ? ` (${unit})` : ''}`}
          points={points}
          color={color}
          height={height}
          decimals={decimals}
          limits={limits}
          avg={ys.length > 1 ? avg : null}
          noDataText={t('water_supply.overview.trend_waiting')}
        />
      </div>
    </div>
  );
}
