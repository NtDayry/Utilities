import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import Chart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import dayjs from 'dayjs';
import { BarChart3, ListOrdered } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import type { AlertEvent } from '@/api';

type Sev = 'critical' | 'warning' | 'info';
const SEV_COLOR: Record<Sev, string> = { critical: '#ef4444', warning: '#f59e0b', info: '#0ba5ec' };
const normSev = (s: string | null | undefined): Sev => {
  const v = (s || '').toLowerCase();
  return v === 'critical' || v === 'warning' ? v : 'info';
};

interface Props {
  events: AlertEvent[];
  startTime: string; // ISO — ช่วงเวลาตามตัวกรอง
  stopTime: string;
  loading?: boolean;
  /** จำนวนทั้งหมดจาก API (ถ้ามากกว่า events.length แปลว่ากราฟใช้ข้อมูลไม่ครบ) */
  total?: number;
}

/**
 * กราฟสรุปการแจ้งเตือน Purified Water — คำนวณจากเหตุการณ์ทั้งหมดในช่วงตัวกรอง (ไม่ใช่เฉพาะหน้าที่แสดงในตาราง)
 *  - จำนวนการแจ้งเตือนตามช่วงเวลา แยกระดับความรุนแรง (รายชั่วโมงถ้าช่วง ≤ 2 วัน, ไม่เช่นนั้นรายวัน)
 *  - เซนเซอร์ที่แจ้งเตือนบ่อยที่สุด 6 อันดับ
 */
export default function AlarmSummaryCharts({ events, startTime, stopTime, loading, total }: Props) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const dark = theme === 'dark';

  const chart = useMemo(() => {
    const from = dayjs(startTime);
    const to = dayjs(stopTime).isAfter(dayjs()) ? dayjs() : dayjs(stopTime);
    const hourly = to.diff(from, 'hour', true) <= 48;
    const unit = hourly ? 'hour' : 'day';
    const keyFmt = hourly ? 'YYYY-MM-DD HH' : 'YYYY-MM-DD';
    const start = from.startOf(unit);
    const n = Math.min(400, Math.max(1, to.startOf(unit).diff(start, unit) + 1));
    const cats: string[] = [];
    const idx = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const d = start.add(i, unit);
      idx.set(d.format(keyFmt), i);
      cats.push(d.format(hourly ? 'DD/MM HH:00' : 'DD/MM'));
    }
    const data: Record<Sev, number[]> = { critical: Array(n).fill(0), warning: Array(n).fill(0), info: Array(n).fill(0) };
    for (const e of events) {
      const i = idx.get(dayjs(e.started_at).format(keyFmt));
      if (i !== undefined) data[normSev(e.severity)][i]++;
    }
    const series = (['critical', 'warning', 'info'] as Sev[]).map((s) => ({
      name: t(`page.alarm_reports.filter.${s}`),
      data: data[s],
      color: SEV_COLOR[s],
    }));
    const options: ApexOptions = {
      chart: { type: 'bar', stacked: true, toolbar: { show: false }, fontFamily: 'inherit', background: 'transparent', animations: { enabled: false } },
      theme: { mode: dark ? 'dark' : 'light' },
      plotOptions: { bar: { columnWidth: n > 40 ? '80%' : '55%', borderRadius: 3, borderRadiusApplication: 'end', borderRadiusWhenStacked: 'last' } },
      dataLabels: { enabled: false },
      grid: { borderColor: dark ? '#1f2937' : '#f1f5f9', strokeDashArray: 4 },
      xaxis: { categories: cats, labels: { rotate: -45, hideOverlappingLabels: true, style: { fontSize: '11px' } }, tickAmount: Math.min(n, 15), axisTicks: { show: false } },
      yaxis: { min: 0, forceNiceScale: true, labels: { formatter: (v) => String(Math.round(v)) } },
      legend: { position: 'top', horizontalAlign: 'right', fontSize: '12px' },
      tooltip: { shared: true, intersect: false },
    };
    return { series, options };
  }, [events, startTime, stopTime, dark, t]);

  const top = useMemo(() => {
    const m = new Map<string, { device: string; metric: string; n: number; crit: number; warn: number }>();
    for (const e of events) {
      const k = `${e.device_name}|${e.metric_name}`;
      const cur = m.get(k) ?? { device: e.device_name, metric: e.metric_name, n: 0, crit: 0, warn: 0 };
      cur.n++;
      const s = normSev(e.severity);
      if (s === 'critical') cur.crit++;
      else if (s === 'warning') cur.warn++;
      m.set(k, cur);
    }
    return [...m.values()].sort((a, b) => b.n - a.n).slice(0, 6);
  }, [events]);

  const box = 'rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-800/30';
  const truncated = total !== undefined && total > events.length;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <div className={`${box} xl:col-span-2`}>
        <h3 className="flex items-center gap-2 text-base font-bold text-gray-800 dark:text-white">
          <BarChart3 className="h-5 w-5 text-indigo-500" /> {t('page.alarm_reports.chart.trend_title')}
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t('page.alarm_reports.chart.trend_sub')}
          {truncated && <span className="ml-1 text-warning-600 dark:text-warning-400">{t('page.alarm_reports.chart.truncated', { n: events.length.toLocaleString(), total: total!.toLocaleString() })}</span>}
        </p>
        <div className={`-ml-2 mt-2 transition-opacity ${loading ? 'opacity-50' : ''}`}>
          <Chart key={theme} type="bar" height={260} series={chart.series} options={chart.options} />
        </div>
      </div>

      <div className={box}>
        <h3 className="flex items-center gap-2 text-base font-bold text-gray-800 dark:text-white">
          <ListOrdered className="h-5 w-5 text-indigo-500" /> {t('page.alarm_reports.chart.top_title')}
        </h3>
        <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">{t('page.alarm_reports.chart.top_sub')}</p>
        {top.length === 0 ? (
          <p className="py-12 text-center text-sm text-gray-400">{loading ? '…' : t('page.alarm_reports.table.empty.title')}</p>
        ) : (
          <ul className={`space-y-3.5 transition-opacity ${loading ? 'opacity-50' : ''}`}>
            {top.map((r) => (
              <li key={`${r.device}|${r.metric}`}>
                <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate">
                    <span className="font-semibold text-gray-800 dark:text-white">{r.metric}</span>
                    <span className="ml-1.5 text-xs text-gray-500 dark:text-gray-400">{r.device}</span>
                  </span>
                  <span className="shrink-0 font-bold text-gray-700 dark:text-gray-300">{r.n}</span>
                </div>
                <div className="flex h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-white/5">
                  <div style={{ width: `${(r.crit / top[0].n) * 100}%`, background: SEV_COLOR.critical }} />
                  <div style={{ width: `${(r.warn / top[0].n) * 100}%`, background: SEV_COLOR.warning }} />
                  <div style={{ width: `${((r.n - r.crit - r.warn) / top[0].n) * 100}%`, background: SEV_COLOR.info }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
