import { useMemo, type ReactNode } from 'react';
import { Navigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import Chart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import {
  Activity,
  BatteryCharging,
  CalendarDays,
  Cpu,
  Factory,
  Gauge,
  Info,
  MapPin,
  Snowflake,
  TrendingUp,
  Waves,
  Wind,
  Zap,
} from 'lucide-react';
import PageMeta from '@/components/common/page/PageMeta';
import PageHero from '@/components/common/page/PageHero';
import MockBanner from '@/components/common/page/MockBanner';
import { useNow } from '@/hooks/useNow';
import { BKK_OFFSET_MS, DAY_MS, fmtFixed as fmt, startOfBkkDay } from '@/utils/format';
import BackNav from '@/components/common/navigation/BackNav';
import AreaChart from '@/components/common/charts/AreaChart';
import { URL } from '@/api';
import { KpiCard, Panel, toneBadgeCls, type Tone } from '@/components/common/widgets/StatusWidgets';
import { OBJECTS, ROOMS } from '@/lib/factoryBuildings';
import { TR_PF } from '@/lib/factorySensors';
import {
  energyBetween,
  findElectricalPoint,
  meterAt,
  readingAt,
  type ElectricalPoint,
  type ElectricalType,
} from '@/lib/electricalPoints';

const TICK_MS = 5_000; // อัปเดตค่าทุก 5 วินาที (เท่ากับแผนผังโรงงาน)

const TYPE_ICON: Record<ElectricalType, ReactNode> = {
  main: <Zap className="h-5 w-5" />,
  transformer: <BatteryCharging className="h-5 w-5" />,
  chiller: <Snowflake className="h-5 w-5" />,
  utility: <Wind className="h-5 w-5" />,
};

// เกณฑ์ (mockup) สำหรับสีสถานะ
const pfTone = (pf: number): Tone => (pf < 0.85 ? 'error' : pf < 0.9 ? 'warn' : 'ok');
const vTone = (vLL: number): Tone => (Math.abs(vLL - 400) / 400 > 0.05 ? 'warn' : 'ok');
const hzTone = (hz: number): Tone => (hz < 49.5 || hz > 50.5 ? 'warn' : 'ok');
const unbalTone = (pct: number): Tone => (pct > 10 ? 'error' : pct > 5 ? 'warn' : 'ok');

export default function ElectricalPointDetail() {
  const { pointKey } = useParams();
  const point = findElectricalPoint(pointKey);
  if (!point) return <Navigate to={URL.HOME} replace />;
  return <PointView key={point.key} p={point} />;
}

function PointView({ p }: { p: ElectricalPoint }) {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === 'en';

  const now = useNow(TICK_MS);

  const r = readingAt(p, now);
  const meter = meterAt(p, now);
  const todayStart = startOfBkkDay(now);
  const energyToday = energyBetween(p, todayStart, now);
  const energyYesterday = energyBetween(p, todayStart - DAY_MS, todayStart);
  const monthStart = useMemo(() => {
    const d = new Date(now + BKK_OFFSET_MS);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - BKK_OFFSET_MS;
  }, [now]);
  const energyMonth = energyBetween(p, monthStart, now);

  // กราฟโหลด 24 ชม. ล่าสุด (เฉลี่ยทุก 15 นาที) — คำนวณใหม่ทุก 15 นาที
  const slot = Math.floor(now / 900_000);
  const loadSeries = useMemo(() => {
    const end = slot * 900_000;
    const pts = Array.from({ length: 96 }, (_, i) => end - (95 - i) * 900_000);
    return {
      cats: pts.map((ms) => new Date(ms).toISOString()),
      kw: pts.map((ms) => Number(readingAt(p, ms + 450_000).kw.toFixed(1))),
    };
  }, [p, slot]);
  const peak = Math.max(...loadSeries.kw);
  const avg = loadSeries.kw.reduce((a, b) => a + b, 0) / loadSeries.kw.length;

  // พลังงานรายวัน 14 วันล่าสุด (รวมวันนี้ถึงปัจจุบัน)
  const dayKey = Math.floor((now + BKK_OFFSET_MS) / DAY_MS);
  const daily = useMemo(() => {
    const start = startOfBkkDay(now);
    return Array.from({ length: 14 }, (_, i) => {
      const d0 = start - (13 - i) * DAY_MS;
      const d1 = i === 13 ? now : d0 + DAY_MS;
      const label = new Date(d0 + BKK_OFFSET_MS);
      return {
        label: `${String(label.getUTCDate()).padStart(2, '0')}/${String(label.getUTCMonth() + 1).padStart(2, '0')}`,
        kwh: Math.round(energyBetween(p, d0, d1)),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, dayKey]);

  const name = isEn ? p.en : p.th;
  const obj = OBJECTS.find((o) => o.id === p.objectId);
  const room = ROOMS.find((o) => o.id === p.objectId);
  const note = isEn ? obj?.noteEn : obj?.note;
  const typeLabel = {
    main: t('electrical.type_main'),
    transformer: t('electrical.type_transformer'),
    chiller: t('electrical.type_chiller'),
    utility: t('electrical.type_utility'),
  }[p.type];

  const status: { tone: Tone; text: string } =
    r.loadPct !== undefined && r.loadPct >= 90
      ? { tone: 'error', text: t('electrical.status_overload') }
      : (r.loadPct ?? 0) >= 80 || r.pf < 0.9 || r.unbalancePct > 5
      ? { tone: 'warn', text: t('electrical.status_watch') }
      : { tone: 'ok', text: t('electrical.status_normal') };

  const barOptions: ApexOptions = {
    chart: { type: 'bar', toolbar: { show: false }, fontFamily: 'inherit' },
    colors: ['#465fff'],
    plotOptions: { bar: { columnWidth: '45%', borderRadius: 5, borderRadiusApplication: 'end' } },
    dataLabels: { enabled: false },
    xaxis: { categories: daily.map((d) => d.label), axisBorder: { show: false }, axisTicks: { show: false }, labels: { style: { colors: '#9ca3af' } } },
    yaxis: { labels: { style: { colors: '#9ca3af' }, formatter: (v) => Math.round(v).toLocaleString() } },
    grid: { borderColor: 'rgba(148,163,184,0.2)' },
    tooltip: { y: { formatter: (v) => `${Math.round(v).toLocaleString()} kWh` } },
  };

  return (
    <div className="space-y-6 pb-12">
      <PageMeta title={name} description={`${name} — electrical point detail`} />

      {/* ============ Header ============ */}
      <PageHero
        icon={TYPE_ICON[p.type]}
        gradientCls="from-amber-400 to-brand-500"
        title={name}
        subtitle={
          <span className="flex flex-wrap items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5" />
            {isEn ? p.locationEn : p.locationTh}
            <span>· {typeLabel}</span>
            {room && <span>· {isEn ? room.en : room.name}</span>}
          </span>
        }
        footer={
          <>
            <BackNav
              to={URL.HOME}
              label={t('electrical.back_to_layout')}
              crumbs={[{ label: t('navbar.factory_layout'), to: URL.HOME }, { label: name }]}
              className=""
            />
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${toneBadgeCls[status.tone]}`}>{status.text}</span>
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {t('water_supply.last_updated')}: {new Date(now).toLocaleTimeString()}
              </span>
            </div>
          </>
        }
      />

      {/* ป้ายแจ้งว่าเป็นข้อมูลตัวอย่าง — ลบออกเมื่อเชื่อมข้อมูลมิเตอร์จริง */}
      <MockBanner text={t('electrical.mock_desc')} />

      {/* ============ KPI ============ */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {p.kva !== undefined && r.loadPct !== undefined ? (
          <KpiCard
            icon={<Gauge className="h-4.5 w-4.5" />}
            iconCls={r.loadPct >= 90 ? 'bg-error-500 text-white animate-pulse' : r.loadPct >= 80 ? 'bg-warning-500 text-white' : 'bg-emerald-500 text-white'}
            label={t('electrical.kpi_loading')}
            value={fmt(r.loadPct, 1)}
            unit="%"
            sub={`${fmt(r.kva, 0)} / ${p.kva.toLocaleString()} kVA`}
            progress={r.loadPct}
            progressCls={r.loadPct >= 90 ? 'from-error-500 to-error-400' : r.loadPct >= 80 ? 'from-warning-500 to-warning-400' : 'from-emerald-500 to-teal-400'}
          />
        ) : (
          <KpiCard
            icon={<Zap className="h-4.5 w-4.5" />}
            iconCls="bg-amber-500 text-white"
            label={t('electrical.kpi_power')}
            value={fmt(r.kw, 1)}
            unit="kW"
            sub={`${t('electrical.peak_24h')}: ${fmt(peak, 1)} kW`}
            progress={(r.kw / peak) * 100}
            progressCls="from-amber-500 to-orange-400"
          />
        )}
        {p.kva !== undefined ? (
          <KpiCard
            icon={<Zap className="h-4.5 w-4.5" />}
            iconCls="bg-amber-500 text-white"
            label={t('electrical.kpi_power')}
            value={fmt(r.kw, 1)}
            unit="kW"
            sub={`${t('electrical.peak_24h')}: ${fmt(peak, 1)} kW`}
          />
        ) : (
          <KpiCard
            icon={<Activity className="h-4.5 w-4.5" />}
            iconCls="bg-brand-500 text-white"
            label={t('electrical.kpi_current')}
            value={fmt(r.aAvg, 1)}
            unit="A"
            sub={`${t('electrical.unbalance')}: ${fmt(r.unbalancePct, 1)}%`}
          />
        )}
        <KpiCard
          icon={<CalendarDays className="h-4.5 w-4.5" />}
          iconCls="bg-sky-500 text-white"
          label={t('electrical.kpi_today')}
          value={Math.round(energyToday).toLocaleString()}
          unit="kWh"
          sub={`${t('electrical.yesterday')}: ${Math.round(energyYesterday).toLocaleString()} kWh · ${t('electrical.this_month')}: ${Math.round(energyMonth).toLocaleString()} kWh`}
        />
        <KpiCard
          icon={<Cpu className="h-4.5 w-4.5" />}
          iconCls="bg-indigo-500 text-white"
          label={t('electrical.kpi_meter')}
          value={Math.round(meter).toLocaleString()}
          unit="kWh"
          sub={`PF ${fmt(r.pf, 2)} · ${fmt(r.hz, 2)} Hz`}
        />
      </div>

      {/* ============ Main grid ============ */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="rounded-2xl border border-gray-200 bg-white px-3 ps-0 shadow-sm dark:border-gray-800 dark:bg-white/[0.03]">
            <AreaChart
              id={`elec-load-${p.key}`}
              categories={loadSeries.cats}
              series={[{ name: t('electrical.kpi_power') + ' (kW)', data: loadSeries.kw }]}
              height={280}
              avg={avg.toFixed(1)}
              warningMax={p.kva ? Number((p.kva * TR_PF * 0.8).toFixed(0)) : undefined}
              showLimitLabel={!!p.kva}
              options={{
                colors: ['#f59e0b'],
                xaxis: { type: 'datetime', labels: { datetimeUTC: false, format: 'HH:mm' } },
                tooltip: { x: { format: 'dd/MM HH:mm' } },
              }}
              label={
                <div className="flex flex-col gap-1 p-4 pb-0 sm:p-5 sm:pb-0">
                  <h3 className="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-white/90 sm:text-base">
                    <TrendingUp className="h-4 w-4 text-gray-400" />
                    {t('electrical.load_profile')}
                  </h3>
                  <div className="flex flex-wrap gap-3 text-xs font-semibold sm:text-sm">
                    <span className="text-error-500">{t('page.reports.charts.max')}: {fmt(peak, 1)} kW</span>
                    <span className="text-blue-500">{t('page.reports.charts.avg')}: {fmt(avg, 1)} kW</span>
                    {p.kva && (
                      <span className="text-warning-500">
                        {t('electrical.limit_80')}: {fmt(p.kva * TR_PF * 0.8, 0)} kW
                      </span>
                    )}
                  </div>
                </div>
              }
            />
          </div>

          <Panel title={t('electrical.daily_energy')} icon={<CalendarDays className="h-4 w-4" />}>
            <Chart options={barOptions} series={[{ name: 'kWh', data: daily.map((d) => d.kwh) }]} type="bar" height={240} />
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title={t('electrical.phases')} icon={<Waves className="h-4 w-4" />}>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-gray-400">
                  <th className="pb-2 text-left font-semibold" />
                  <th className="pb-2 text-right font-semibold">V (L-N)</th>
                  <th className="pb-2 text-right font-semibold">A</th>
                  <th className="pb-2 text-right font-semibold">kW</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 tabular-nums dark:divide-gray-800">
                {r.phases.map((ph, i) => (
                  <tr key={ph.name}>
                    <td className="py-2">
                      <span
                        className={`inline-flex h-6 w-8 items-center justify-center rounded-md text-xs font-bold text-white ${
                          ['bg-amber-700', 'bg-gray-900 dark:bg-gray-600', 'bg-gray-400'][i]
                        }`}
                      >
                        {ph.name}
                      </span>
                    </td>
                    <td className="py-2 text-right font-semibold text-gray-800 dark:text-gray-100">{fmt(ph.vLN, 1)}</td>
                    <td className="py-2 text-right font-semibold text-gray-800 dark:text-gray-100">{fmt(ph.a, 1)}</td>
                    <td className="py-2 text-right font-semibold text-gray-800 dark:text-gray-100">{fmt(ph.kw, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-3 text-sm dark:border-gray-800">
              <span className="text-gray-500 dark:text-gray-400">{t('electrical.current_unbalance')}</span>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${toneBadgeCls[unbalTone(r.unbalancePct)]}`}>
                {fmt(r.unbalancePct, 1)}%
              </span>
            </div>
          </Panel>

          <Panel title={t('electrical.power_quality')} icon={<Activity className="h-4 w-4" />}>
            <dl className="divide-y divide-gray-100 text-sm dark:divide-gray-800">
              {[
                { l: t('electrical.voltage_ll'), v: `${fmt(r.vLL, 1)} V`, tone: vTone(r.vLL) },
                { l: t('electrical.frequency'), v: `${fmt(r.hz, 2)} Hz`, tone: hzTone(r.hz) },
                { l: t('electrical.pf'), v: fmt(r.pf, 2), tone: pfTone(r.pf) },
                { l: t('electrical.apparent'), v: `${fmt(r.kva, 1)} kVA`, tone: 'idle' as Tone },
                { l: t('electrical.reactive'), v: `${fmt(r.kvar, 1)} kVAR`, tone: 'idle' as Tone },
              ].map((row) => (
                <div key={row.l} className="flex items-center justify-between py-2.5">
                  <dt className="text-gray-500 dark:text-gray-400">{row.l}</dt>
                  <dd>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums ${toneBadgeCls[row.tone]}`}>{row.v}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </Panel>

          <Panel title={t('electrical.info')} icon={<Info className="h-4 w-4" />}>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500 dark:text-gray-400">{t('electrical.type')}</dt>
                <dd className="text-right font-semibold text-gray-800 dark:text-gray-100">{typeLabel}</dd>
              </div>
              {p.kva && (
                <div className="flex justify-between gap-3">
                  <dt className="text-gray-500 dark:text-gray-400">{t('electrical.rating')}</dt>
                  <dd className="text-right font-semibold text-gray-800 dark:text-gray-100">
                    {p.kva.toLocaleString()} kVA (≈ {(p.kva * TR_PF).toLocaleString()} kW)
                  </dd>
                </div>
              )}
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500 dark:text-gray-400">{t('electrical.avg_load')}</dt>
                <dd className="text-right font-semibold text-gray-800 dark:text-gray-100">{p.baseKw.toLocaleString()} kW</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500 dark:text-gray-400">{t('electrical.location')}</dt>
                <dd className="flex items-center gap-1 text-right font-semibold text-gray-800 dark:text-gray-100">
                  <Factory className="h-3.5 w-3.5 text-gray-400" />
                  {isEn ? p.locationEn : p.locationTh}
                </dd>
              </div>
            </dl>
            {note && <p className="mt-3 border-t border-gray-100 pt-3 text-xs leading-relaxed text-gray-500 dark:border-gray-800 dark:text-gray-400">{note}</p>}
          </Panel>
        </div>
      </div>
    </div>
  );
}
