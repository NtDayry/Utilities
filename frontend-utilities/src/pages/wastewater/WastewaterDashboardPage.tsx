import { Fragment, useMemo } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Chart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import {
  Activity,
  BarChart3,
  ChevronRight,
  Droplets,
  FlaskConical,
  LayoutDashboard,
  Recycle,
  ShieldCheck,
  Waves,
  Wind,
} from 'lucide-react';
import PageMeta from '@/components/common/page/PageMeta';
import PageHero, { HeroLink } from '@/components/common/page/PageHero';
import { useNow } from '@/hooks/useNow';
import { DAY_MS, fmtFixed as fmt, startOfBkkDay } from '@/utils/format';
import MockBanner from '@/components/common/page/MockBanner';
import WwUnitIcon from '@/components/wastewater/WwUnitIcon';
import { asTone as toTone, DetailsLink, KpiCard, MetricGrid, Panel, StatusCard, toneBadgeCls, toneFrameCls, type Tone } from '@/components/common/widgets/StatusWidgets';
import {
  dischargeBetween,
  EFFLUENT_LIMITS,
  inflowBetween,
  paramOf,
  paramTone,
  unitTone,
  WW_PROCESS,
  WW_UNITS,
  wwUnitPath,
  type WwUnit,
  type WwUnitKey,
} from '@/lib/wastewaterUnits';

const TICK_MS = 5_000;


// ค่าหลักที่แสดงบนการ์ด/ผังกระบวนการของแต่ละหน่วย
const KEY_PARAMS: Record<WwUnitKey, string[]> = {
  eq: ['level', 'inflow', 'ph'],
  eqpump: ['p1', 'p2', 'flow'],
  aer: ['do', 'mlss', 'temp'],
  anae: ['sludge', 'h2s', 'ph'],
  sand: ['turb', 'headloss', 'backwash'],
  pool: ['level', 'cod', 'bod'],
  panel: ['mode', 'kw', 'volt'],
};
const FLOW_PARAM: Record<WwUnitKey, string> = {
  eq: 'level', eqpump: 'flow', aer: 'do', anae: 'sludge', sand: 'turb', pool: 'level', panel: 'kw',
};


export default function WastewaterDashboard() {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === 'en';

  const now = useNow(TICK_MS);

  const todayStart = startOfBkkDay(now);
  const inToday = inflowBetween(todayStart, now);
  const outToday = dischargeBetween(todayStart, now);
  const inYesterday = inflowBetween(todayStart - DAY_MS, todayStart);

  const effluent = (['ph', 'cod', 'bod', 'tss', 'temp'] as const).map((id) => {
    const p = paramOf('pool', id);
    const v = p.fn(now);
    return { p, v, tone: toTone(paramTone(p, v)) };
  });
  const effFail = effluent.filter((e) => e.tone === 'error').length;
  const effWarn = effluent.filter((e) => e.tone === 'warn').length;
  const doP = paramOf('aer', 'do');
  const doV = doP.fn(now);

  const slot = Math.floor(now / 900_000);
  const flowSeries = useMemo(() => {
    const end = slot * 900_000;
    const pts = Array.from({ length: 96 }, (_, i) => end - (95 - i) * 900_000);
    const at = (unit: WwUnitKey, id: string) => pts.map((ms) => [ms, Number(paramOf(unit, id).fn(ms).toFixed(2))] as [number, number]);
    return [
      { name: t('wastewater.dashboard.inflow'), data: at('eq', 'inflow') },
      { name: t('wastewater.dashboard.discharge'), data: at('pool', 'discharge') },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot, isEn]);

  const chartOptions: ApexOptions = {
    chart: { type: 'area', toolbar: { show: false }, fontFamily: 'inherit', animations: { enabled: false } },
    colors: ['#f59e0b', '#14b8a6'],
    dataLabels: { enabled: false },
    stroke: { curve: 'smooth', width: 2 },
    fill: { type: 'gradient', gradient: { opacityFrom: 0.35, opacityTo: 0.03 } },
    xaxis: { type: 'datetime', labels: { datetimeUTC: false, format: 'HH:mm', style: { colors: '#9ca3af' } } },
    yaxis: { labels: { style: { colors: '#9ca3af' }, formatter: (v) => fmt(v, 1) } },
    legend: { position: 'top', horizontalAlign: 'left', labels: { colors: '#9ca3af' } },
    grid: { borderColor: 'rgba(148,163,184,0.2)' },
    tooltip: { x: { format: 'dd/MM HH:mm' }, y: { formatter: (v) => `${fmt(v, 2)} m³/h` } },
  };

  const unitName = (u: WwUnit) => (isEn ? u.en : u.th);
  const tones = WW_UNITS.map((u) => unitTone(u, now));
  const attention = WW_UNITS.filter((_, i) => tones[i] !== 'ok');

  const statusLabel = (tone: Tone) =>
    tone === 'error' ? t('wastewater.dashboard.fault') : tone === 'warn' ? t('wastewater.dashboard.watch') : t('wastewater.dashboard.normal');

  const valueText = (unit: WwUnitKey, id: string) => {
    const p = paramOf(unit, id);
    const v = p.fn(now);
    if (p.kind === 'onoff') return id === 'mode' ? (v ? 'AUTO' : 'MAN') : v ? 'ON' : 'OFF';
    return `${fmt(v, p.dp)}${p.unit ? ` ${p.unit}` : ''}`;
  };

  return (
    <div className="space-y-6 pb-12">
      <PageMeta title={t('wastewater.dashboard_title')} description="Wastewater treatment overview (mockup)" />

      {/* ============ Header ============ */}
      <PageHero
        icon={<LayoutDashboard className="h-5 w-5" />}
        gradientCls="from-teal-500 to-brand-500"
        title={t('wastewater.dashboard_title')}
        subtitle={
          <>
            {t('wastewater.dashboard.activated_sludge_plant_beside_the_wareho')} · {t('water_supply.last_updated')}:{' '}
            <span className="font-medium text-gray-700 dark:text-gray-200">{new Date(now).toLocaleTimeString()}</span>
          </>
        }
        actions={
          <HeroLink to="/wastewater/reports" icon={<BarChart3 className="h-3.5 w-3.5" />}>
            {t('navbar.wastewater_reports')}
          </HeroLink>
        }
      />

      <MockBanner text={t('wastewater.mock_desc')} />

      {/* ============ KPI ============ */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={<Recycle className="h-4.5 w-4.5" />}
          iconCls="bg-amber-500 text-white"
          label={t('wastewater.dashboard.inflow_today')}
          value={fmt(inToday, 1)}
          unit="m³"
          sub={`${t('wastewater.dashboard.yesterday')}: ${fmt(inYesterday, 1)} m³ · ${t('wastewater.dashboard.now')} ${valueText('eq', 'inflow')}`}
        />
        <KpiCard
          icon={<Droplets className="h-4.5 w-4.5" />}
          iconCls="bg-teal-500 text-white"
          label={t('wastewater.dashboard.discharged_today')}
          value={fmt(outToday, 1)}
          unit="m³"
          sub={`${t('wastewater.dashboard.now')} ${valueText('pool', 'discharge')}`}
        />
        <KpiCard
          icon={<ShieldCheck className="h-4.5 w-4.5" />}
          iconCls={effFail ? 'bg-error-500 text-white animate-pulse' : effWarn ? 'bg-warning-500 text-white' : 'bg-emerald-500 text-white'}
          label={t('wastewater.dashboard.effluent_compliance')}
          value={`${effluent.length - effFail}`}
          unit={`/ ${effluent.length}`}
          sub={effFail ? t('wastewater.dashboard.parameter_s_over_limit') : effWarn ? t('wastewater.dashboard.near_limit_80') : t('wastewater.dashboard.all_parameters_pass')}
        />
        <KpiCard
          icon={<Wind className="h-4.5 w-4.5" />}
          iconCls="bg-sky-500 text-white"
          label={t('wastewater.dashboard.aeration_do')}
          value={fmt(doV, 2)}
          unit="mg/L"
          sub={`${t('wastewater.dashboard.target')} 2–4 mg/L`}
          badge={
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${toneBadgeCls[toTone(paramTone(doP, doV))]}`}>
              {statusLabel(toTone(paramTone(doP, doV)))}
            </span>
          }
        />
      </div>

      {/* ============ Process flow ============ */}
      <Panel title={t('wastewater.dashboard.treatment_process')} icon={<Activity className="h-4 w-4" />}>
        <div className="flex items-stretch overflow-x-auto pb-1">
          {WW_PROCESS.map((u, i) => {
            const tone = toTone(unitTone(u, now));
            return (
              <Fragment key={u.key}>
                {i > 0 && (
                  <div className="flex items-center px-1">
                    <div className="h-1.5 w-6 animate-pulse rounded-full bg-gradient-to-r from-amber-400 to-teal-400 lg:w-10" />
                    <ChevronRight className="-ml-1 h-4 w-4 text-teal-400" />
                  </div>
                )}
                <Link
                  to={wwUnitPath(u.key)}
                  className={`group flex min-w-[130px] flex-1 flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition hover:border-brand-300 hover:bg-brand-50/40 dark:hover:border-brand-800 dark:hover:bg-brand-500/5 ${
                    tone === 'error' ? 'border-error-300 dark:border-error-800' : tone === 'warn' ? 'border-warning-300 dark:border-warning-800' : 'border-gray-200 dark:border-gray-800'
                  }`}
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500 text-white shadow-xs"><WwUnitIcon unit={u.key} /></div>
                  <div className="text-[11px] font-bold leading-tight text-gray-800 dark:text-gray-100">{isEn ? u.shortEn : u.shortTh}</div>
                  <div className="text-sm font-black tabular-nums text-gray-900 dark:text-white">{valueText(u.key, FLOW_PARAM[u.key])}</div>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${toneBadgeCls[tone]}`}>{statusLabel(tone)}</span>
                </Link>
              </Fragment>
            );
          })}
        </div>
      </Panel>

      {/* ============ Flow chart + effluent quality ============ */}
      <div className="grid gap-6 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title={t('wastewater.dashboard.inflow_vs_discharge_24_h')} icon={<Waves className="h-4 w-4" />}>
          <Chart options={chartOptions} series={flowSeries} type="area" height={290} />
        </Panel>
        <Panel
          title={t('wastewater.dashboard.effluent_quality')}
          icon={<ShieldCheck className="h-4 w-4" />}
          action={
            <Link to={wwUnitPath('pool')} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-400">
              {t('water_supply.overview.view_details_short')}
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          }
        >
          <div className="space-y-3.5">
            {effluent.map(({ p, v, tone }) => {
              const max = p.limit?.max ?? 1;
              const pct = p.id === 'ph' ? ((v - 0) / 14) * 100 : (v / max) * 100;
              return (
                <div key={p.id}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-gray-700 dark:text-gray-200">{isEn ? p.en : p.th}</span>
                    <span className="tabular-nums text-gray-500 dark:text-gray-400">
                      <b className="text-gray-900 dark:text-white">{fmt(v, p.dp)}</b> {p.unit} ·{' '}
                      {p.limit?.min !== undefined ? `${p.limit.min}–${p.limit.max}` : `≤ ${p.limit?.max}`}
                    </span>
                  </div>
                  <div className="relative mt-1.5 h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${tone === 'error' ? 'bg-error-500' : tone === 'warn' ? 'bg-warning-500' : 'bg-emerald-500'}`}
                      style={{ width: `${Math.min(100, Math.max(2, pct))}%` }}
                    />
                    {p.id === 'ph' && (
                      <>
                        <div className="absolute inset-y-0 border-l-2 border-error-500/70" style={{ left: `${(5.5 / 14) * 100}%` }} />
                        <div className="absolute inset-y-0 border-l-2 border-error-500/70" style={{ left: `${(9 / 14) * 100}%` }} />
                      </>
                    )}
                  </div>
                </div>
              );
            })}
            <p className="border-t border-gray-100 pt-2.5 text-[11px] leading-relaxed text-gray-400 dark:border-gray-800 dark:text-gray-500">
              {t('wastewater.dashboard.limits_ministry_of_industry_effluent_sta')}
              {' · '}BOD ≤ {EFFLUENT_LIMITS.bod.max}, COD ≤ {EFFLUENT_LIMITS.cod.max}, TSS ≤ {EFFLUENT_LIMITS.tss.max} mg/L
            </p>
          </div>
        </Panel>
      </div>

      {/* ============ Unit cards ============ */}
      <section className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-base font-bold text-gray-900 dark:text-white">{t('wastewater.dashboard.treatment_units_equipment')}</h2>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${attention.length ? toneBadgeCls.warn : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'}`}>
            {attention.length ? `${t('wastewater.dashboard.watch')} ${attention.length}` : t('wastewater.dashboard.all_normal')} · {WW_UNITS.length} {t('water_supply.overview.sites_unit')}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {[...WW_PROCESS, ...WW_UNITS.filter((u) => u.stage === 0)].map((u) => {
            const tone = toTone(unitTone(u, now));
            return (
              <StatusCard
                key={u.key}
                frameCls={`bg-white dark:bg-white/[0.03] ${toneFrameCls(tone)}`}
                icon={<WwUnitIcon unit={u.key} />}
                iconCls="bg-teal-500 text-white"
                title={unitName(u)}
                subtitle={
                  <>
                    {u.stage > 0 ? `${t('wastewater.dashboard.stage')} ${u.stage} · ` : ''}
                    {u.key === 'pool' ? t('wastewater.dashboard.canteen_pond') : t('wastewater.dashboard.beside_the_warehouse')}
                  </>
                }
                status={{ tone, label: statusLabel(tone) }}
                footerCls="mt-auto flex justify-end border-t border-gray-100 pt-3.5 dark:border-gray-800"
                footer={<DetailsLink to={wwUnitPath(u.key)} />}
              >
                <MetricGrid
                  size="md"
                  items={KEY_PARAMS[u.key].map((id) => {
                    const p = paramOf(u.key, id);
                    const pt = toTone(paramTone(p, p.fn(now)));
                    return {
                      label: isEn ? p.en : p.th,
                      value: valueText(u.key, id),
                      valueCls:
                        pt === 'error' ? 'text-error-600 dark:text-error-400' : pt === 'warn' ? 'text-warning-600 dark:text-warning-400' : undefined,
                    };
                  })}
                />
              </StatusCard>
            );
          })}
        </div>
      </section>

      <p className="flex items-center gap-1.5 px-1 text-[11px] text-gray-400 dark:text-gray-500">
        <FlaskConical className="h-3 w-3" />
        {t('wastewater.dashboard.all_values_are_simulated_mockup')}
      </p>
    </div>
  );
}
