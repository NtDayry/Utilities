import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import Chart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import {
  Activity,
  BarChart3,
  BatteryCharging,
  CalendarDays,
  Gauge,
  LayoutDashboard,
  Siren,
  Snowflake,
  TrendingUp,
  Wind,
  Zap,
} from 'lucide-react';
import PageMeta from '@/components/common/page/PageMeta';
import PageHero, { HeroLink } from '@/components/common/page/PageHero';
import { useNow } from '@/hooks/useNow';
import { DAY_MS, fmtFixed as fmt, startOfBkkDay } from '@/utils/format';
import MockBanner from '@/components/common/page/MockBanner';
import { DetailsLink, KpiCard, MetricGrid, Panel, StatusCard, toneFrameCls, type Tone } from '@/components/common/widgets/StatusWidgets';
import {
  ELECTRICAL_POINTS,
  electricalDetailPath,
  energyBetween,
  readingAt,
  type ElectricalPoint,
  type ElectricalReading,
  type ElectricalType,
} from '@/lib/electricalPoints';
import { EL_GROUPS } from '@/lib/electricalReportMock';

const TICK_MS = 5_000;

const TYPE_ICON: Record<ElectricalType, ReactNode> = {
  main: <Zap className="h-4.5 w-4.5" />,
  transformer: <BatteryCharging className="h-4.5 w-4.5" />,
  chiller: <Snowflake className="h-4.5 w-4.5" />,
  utility: <Wind className="h-4.5 w-4.5" />,
};
const TR_COLORS = ['#465fff', '#0ea5e9', '#10b981', '#f59e0b', '#8b5cf6'];

/** สถานะของจุดวัด (เกณฑ์ mockup เดียวกับหน้ารายละเอียด) */
function pointStatus(r: ElectricalReading): { tone: Tone; key: 'normal' | 'watch' | 'overload' } {
  if (r.loadPct !== undefined && r.loadPct >= 90) return { tone: 'error', key: 'overload' };
  if ((r.loadPct ?? 0) >= 80 || r.pf < 0.9 || r.unbalancePct > 5) return { tone: 'warn', key: 'watch' };
  return { tone: 'ok', key: 'normal' };
}

export default function ElectricalDashboard() {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === 'en';

  const now = useNow(TICK_MS);

  const todayStart = startOfBkkDay(now);
  const readings = Object.fromEntries(ELECTRICAL_POINTS.map((p) => [p.key, readingAt(p, now)])) as Record<string, ElectricalReading>;
  const energyToday = Object.fromEntries(ELECTRICAL_POINTS.map((p) => [p.key, energyBetween(p, todayStart, now)])) as Record<string, number>;

  const transformers = ELECTRICAL_POINTS.filter((p) => p.type === 'transformer');
  const trKw = transformers.reduce((a, p) => a + readings[p.key].kw, 0);
  const trKva = transformers.reduce((a, p) => a + readings[p.key].kva, 0);
  const trPf = trKva > 0 ? trKw / trKva : 0;
  const trRated = transformers.reduce((a, p) => a + (p.kva ?? 0), 0);
  const trEnergyToday = transformers.reduce((a, p) => a + energyToday[p.key], 0);
  const trEnergyYesterday = useMemo(
    () => transformers.reduce((a, p) => a + energyBetween(p, todayStart - DAY_MS, todayStart), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [todayStart]
  );

  // โหลดรวมหม้อแปลง 24 ชม. ล่าสุด (ทุก 15 นาที, แยกตามหม้อแปลงแบบซ้อน)
  const slot = Math.floor(now / 900_000);
  const profile = useMemo(() => {
    const end = slot * 900_000;
    const pts = Array.from({ length: 96 }, (_, i) => end - (95 - i) * 900_000);
    const series = transformers.map((p) => ({
      name: isEn ? p.en : p.th,
      data: pts.map((ms) => [ms, Number(readingAt(p, ms + 450_000).kw.toFixed(1))] as [number, number]),
    }));
    const totals = pts.map((_, i) => series.reduce((a, s) => a + s.data[i][1], 0));
    const peakIdx = totals.indexOf(Math.max(...totals));
    return { series, peak: totals[peakIdx], peakAt: pts[peakIdx] + 450_000 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot, isEn]);

  const watch = ELECTRICAL_POINTS.filter((p) => pointStatus(readings[p.key]).tone !== 'ok');
  const statusText = (k: 'normal' | 'watch' | 'overload') =>
    ({
      normal: t('electrical.status_normal'),
      watch: t('electrical.status_watch'),
      overload: t('electrical.status_overload'),
    })[k];

  const areaOptions: ApexOptions = {
    chart: { type: 'area', stacked: true, toolbar: { show: false }, fontFamily: 'inherit', animations: { enabled: false } },
    colors: TR_COLORS,
    dataLabels: { enabled: false },
    stroke: { curve: 'smooth', width: 1.5 },
    fill: { type: 'gradient', gradient: { opacityFrom: 0.45, opacityTo: 0.05 } },
    xaxis: { type: 'datetime', labels: { datetimeUTC: false, format: 'HH:mm', style: { colors: '#9ca3af' } } },
    yaxis: { labels: { style: { colors: '#9ca3af' }, formatter: (v) => Math.round(v).toLocaleString() } },
    legend: { position: 'top', horizontalAlign: 'left', labels: { colors: '#9ca3af' } },
    grid: { borderColor: 'rgba(148,163,184,0.2)' },
    tooltip: { x: { format: 'dd/MM HH:mm' }, y: { formatter: (v) => `${fmt(v, 1)} kW` } },
  };

  const energyRank = [...ELECTRICAL_POINTS].sort((a, b) => energyToday[b.key] - energyToday[a.key]);
  const barOptions: ApexOptions = {
    chart: { type: 'bar', toolbar: { show: false }, fontFamily: 'inherit' },
    colors: ['#f59e0b'],
    plotOptions: { bar: { horizontal: true, barHeight: '60%', borderRadius: 4, borderRadiusApplication: 'end' } },
    dataLabels: { enabled: false },
    xaxis: {
      categories: energyRank.map((p) => (isEn ? p.en : p.th)),
      labels: { style: { colors: '#9ca3af' }, formatter: (v) => Math.round(Number(v)).toLocaleString() },
    },
    yaxis: { labels: { style: { colors: '#9ca3af' }, maxWidth: 180 } },
    grid: { borderColor: 'rgba(148,163,184,0.2)' },
    tooltip: { y: { formatter: (v) => `${Math.round(v).toLocaleString()} kWh` } },
  };

  return (
    <div className="space-y-6 pb-12">
      <PageMeta title={t('electrical.dashboard_title')} description="Electrical system overview (mockup)" />

      {/* ============ Header ============ */}
      <PageHero
        icon={<LayoutDashboard className="h-5 w-5" />}
        gradientCls="from-amber-400 to-brand-500"
        title={t('electrical.dashboard_title')}
        subtitle={
          <>
            {t('electrical.dashboard_subtitle', { count: ELECTRICAL_POINTS.length })} · {t('water_supply.last_updated')}:{' '}
            <span className="font-medium text-gray-700 dark:text-gray-200">{new Date(now).toLocaleTimeString()}</span>
          </>
        }
        actions={
          <HeroLink to="/electricity/reports" icon={<BarChart3 className="h-3.5 w-3.5" />}>
            {t('navbar.electrical_reports')}
          </HeroLink>
        }
      />

      <MockBanner text={t('electrical.mock_desc')} />

      {/* ============ KPI ============ */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={<Zap className="h-4.5 w-4.5" />}
          iconCls="bg-amber-500 text-white"
          label={t('electrical.kpi_total_load')}
          value={fmt(trKw, 0)}
          unit="kW"
          sub={t('electrical.kpi_total_load_sub', {
            pct: fmt((trKva / trRated) * 100, 1),
            rated: trRated.toLocaleString(),
          })}
          progress={(trKva / trRated) * 100}
          progressCls="from-amber-500 to-orange-400"
        />
        <KpiCard
          icon={<CalendarDays className="h-4.5 w-4.5" />}
          iconCls="bg-sky-500 text-white"
          label={t('electrical.kpi_today_total')}
          value={Math.round(trEnergyToday).toLocaleString()}
          unit="kWh"
          sub={`${t('electrical.yesterday')}: ${Math.round(trEnergyYesterday).toLocaleString()} kWh`}
        />
        <KpiCard
          icon={<TrendingUp className="h-4.5 w-4.5" />}
          iconCls="bg-brand-500 text-white"
          label={t('electrical.kpi_peak')}
          value={fmt(profile.peak, 0)}
          unit="kW"
          sub={`${t('electrical.at_time')} ${new Date(profile.peakAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · PF ${fmt(trPf, 2)}`}
        />
        <KpiCard
          icon={<Siren className="h-4.5 w-4.5" />}
          iconCls={watch.length ? 'bg-warning-500 text-white' : 'bg-emerald-500 text-white'}
          label={t('electrical.kpi_watch')}
          value={`${watch.length}`}
          unit={`/ ${ELECTRICAL_POINTS.length}`}
          sub={watch.length ? watch.map((p) => (isEn ? p.en : p.th)).join(', ') : t('electrical.all_normal')}
        />
      </div>

      {/* ============ Charts ============ */}
      <div className="grid gap-6 xl:grid-cols-3">
        <Panel
          className="xl:col-span-2"
          title={t('electrical.tr_profile')}
          icon={<Activity className="h-4 w-4" />}
        >
          <Chart options={areaOptions} series={profile.series} type="area" height={300} />
        </Panel>
        <Panel title={t('electrical.energy_by_point')} icon={<BarChart3 className="h-4 w-4" />}>
          <Chart
            options={barOptions}
            series={[{ name: 'kWh', data: energyRank.map((p) => Math.round(energyToday[p.key])) }]}
            type="bar"
            height={300}
          />
        </Panel>
      </div>

      {/* ============ Point cards by group ============ */}
      {EL_GROUPS.map((g) => {
        const pts = ELECTRICAL_POINTS.filter((p) => g.types.includes(p.type));
        return (
          <section key={g.id} className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-base font-bold text-gray-900 dark:text-white">{isEn ? g.en : g.th}</h2>
              <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                {pts.length} {t('water_supply.overview.sites_unit')}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {pts.map((p) => {
                const st = pointStatus(readings[p.key]);
                return (
                  <PointCard
                    key={p.key}
                    p={p}
                    r={readings[p.key]}
                    kwhToday={energyToday[p.key]}
                    tone={st.tone}
                    statusText={statusText(st.key)}
                    isEn={isEn}
                  />
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function PointCard({
  p,
  r,
  kwhToday,
  tone,
  statusText,
  isEn,
}: {
  p: ElectricalPoint;
  r: ElectricalReading;
  kwhToday: number;
  tone: Tone;
  statusText: string;
  isEn: boolean;
}) {
  const { t } = useTranslation();
  return (
    <StatusCard
      frameCls={`bg-white dark:bg-white/[0.03] ${toneFrameCls(tone, { ring: true })}`}
      icon={TYPE_ICON[p.type]}
      iconCls="bg-amber-500 text-white"
      title={isEn ? p.en : p.th}
      subtitle={isEn ? p.locationEn : p.locationTh}
      status={{ tone, label: statusText }}
      footer={
        <>
          <span className="flex items-center gap-1 text-[11px] text-gray-400 dark:text-gray-500">
            <Gauge className="h-3 w-3" />
            {p.kva ? `${p.kva.toLocaleString()} kVA` : `${t('electrical.avg_load')} ${p.baseKw} kW`}
          </span>
          <DetailsLink to={electricalDetailPath(p.key)} />
        </>
      }
    >
      <div className="mt-4 flex items-end justify-between gap-3">
        <div>
          <div className="text-[11px] text-gray-500 dark:text-gray-400">{t('electrical.kpi_power')}</div>
          <div className="text-3xl font-black tabular-nums tracking-tight text-gray-900 dark:text-white">
            {fmt(r.kw, 1)}
            <span className="ml-1 text-base font-semibold text-gray-400">kW</span>
          </div>
        </div>
        {r.loadPct !== undefined && p.kva && (
          <div className="text-right">
            <div className="text-[11px] text-gray-500 dark:text-gray-400">{t('electrical.kpi_loading')}</div>
            <div className="text-lg font-black tabular-nums text-gray-800 dark:text-gray-100">{fmt(r.loadPct, 1)}%</div>
          </div>
        )}
      </div>

      {r.loadPct !== undefined && p.kva && (
        <div className="relative mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
          <div
            className={`h-full rounded-full bg-gradient-to-r transition-all duration-700 ${
              r.loadPct >= 90 ? 'from-error-500 to-error-400' : r.loadPct >= 80 ? 'from-warning-500 to-warning-400' : 'from-emerald-500 to-teal-400'
            }`}
            style={{ width: `${Math.min(100, r.loadPct)}%` }}
          />
          <div className="absolute inset-y-0 border-l-2 border-dashed border-warning-500/70" style={{ left: '80%' }} />
        </div>
      )}

      <MetricGrid
        className="mt-4"
        items={[
          { label: t('electrical.current_short'), value: `${fmt(r.aAvg, 0)} A` },
          { label: 'PF', value: fmt(r.pf, 2) },
          { label: t('electrical.today_short'), value: `${Math.round(kwhToday).toLocaleString()} kWh` },
        ]}
      />
    </StatusCard>
  );
}
