import { useMemo } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ChevronLeft, ChevronRight, Info, MapPin, TrendingUp } from 'lucide-react';
import PageMeta from '@/components/common/page/PageMeta';
import PageHero from '@/components/common/page/PageHero';
import { useNow } from '@/hooks/useNow';
import { fmtFixed as fmt } from '@/utils/format';
import BackNav from '@/components/common/navigation/BackNav';
import MockBanner from '@/components/common/page/MockBanner';
import AreaChart from '@/components/common/charts/AreaChart';
import WwUnitIcon from '@/components/wastewater/WwUnitIcon';
import { asTone as toTone, Panel, toneBadgeCls, type Tone } from '@/components/common/widgets/StatusWidgets';
import { URL } from '@/api';
import { OBJECTS } from '@/lib/factoryBuildings';
import { findWwUnit, paramTone, unitTone, WW_PROCESS, wwUnitPath, type WwParam, type WwUnit } from '@/lib/wastewaterUnits';

const TICK_MS = 5_000;

export default function WastewaterUnitDetail() {
  const { unitKey } = useParams();
  const unit = findWwUnit(unitKey);
  if (!unit) return <Navigate to={URL.WASTEWATER_DASHBOARD} replace />;
  return <UnitView key={unit.key} u={unit} />;
}

function rangeText(p: WwParam, t: TFunction) {
  const r = p.limit ?? p.normal;
  if (!r) return '';
  const label = p.limit ? t('wastewater.unit.range_limit') : t('wastewater.unit.range_target');
  if (r.min !== undefined && r.max !== undefined) return `${label} ${r.min}–${r.max}`;
  if (r.max !== undefined) return `${label} ≤ ${r.max}`;
  return `${label} ≥ ${r.min}`;
}

function UnitView({ u }: { u: WwUnit }) {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === 'en';

  const now = useNow(TICK_MS);

  const tone = toTone(unitTone(u, now));
  const statusLabel = (tn: Tone) => (tn === 'error' ? t('wastewater.unit.fault') : tn === 'warn' ? t('wastewater.unit.watch') : t('wastewater.unit.normal'));
  const obj = OBJECTS.find((o) => o.id === u.objectId);
  const note = isEn ? obj?.noteEn : obj?.note;

  // ลำดับก่อน/หลังในกระบวนการ
  const idx = WW_PROCESS.findIndex((x) => x.key === u.key);
  const prev = idx > 0 ? WW_PROCESS[idx - 1] : undefined;
  const next = idx >= 0 && idx < WW_PROCESS.length - 1 ? WW_PROCESS[idx + 1] : undefined;

  // กราฟ 24 ชม. (ทุก 15 นาที) — คำนวณใหม่ทุก 15 นาที
  const slot = Math.floor(now / 900_000);
  const charts = useMemo(() => {
    const end = slot * 900_000;
    const pts = Array.from({ length: 96 }, (_, i) => end - (95 - i) * 900_000);
    return u.params
      .filter((p) => p.chart)
      .map((p) => {
        const vals = pts.map((ms) => Number(p.fn(ms + 450_000).toFixed(p.dp)));
        return {
          p,
          cats: pts.map((ms) => new Date(ms).toISOString()),
          vals,
          min: Math.min(...vals),
          max: Math.max(...vals),
          avg: vals.reduce((a, b) => a + b, 0) / vals.length,
        };
      });
  }, [u, slot]);

  return (
    <div className="space-y-6 pb-12">
      <PageMeta title={isEn ? u.en : u.th} description="Wastewater unit detail (mockup)" />

      {/* ============ Header ============ */}
      <PageHero
        icon={<WwUnitIcon unit={u.key} className="h-5 w-5" />}
        gradientCls="from-teal-500 to-brand-500"
        title={isEn ? u.en : u.th}
        subtitle={
          <span className="flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5" />
            {u.key === 'pool' ? t('wastewater.unit.canteen_pond') : t('wastewater.unit.beside_the_warehouse')}
            {u.stage > 0 && <span>· {t('wastewater.unit.stage')} {u.stage}/{WW_PROCESS.length}</span>}
          </span>
        }
        footer={
          <>
            <BackNav
              to={URL.WASTEWATER_DASHBOARD}
              label={t('wastewater.unit.back_to_wastewater_overview')}
              crumbs={[{ label: t('navbar.wastewater_dashboard'), to: URL.WASTEWATER_DASHBOARD }, { label: isEn ? u.en : u.th }]}
              className=""
            />
            <div className="flex flex-wrap items-center gap-2">
              {prev && <StepLink to={wwUnitPath(prev.key)} dir="prev" label={isEn ? prev.shortEn : prev.shortTh} />}
              {next && <StepLink to={wwUnitPath(next.key)} dir="next" label={isEn ? next.shortEn : next.shortTh} />}
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${toneBadgeCls[tone]}`}>{statusLabel(tone)}</span>
            </div>
          </>
        }
      />

      <MockBanner text={t('wastewater.mock_desc')} />

      {/* ============ Current values ============ */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        {u.params.map((p) => {
          const v = p.fn(now);
          const pt = toTone(paramTone(p, v));
          return (
            <div
              key={p.id}
              className={`rounded-2xl border bg-white p-4.5 shadow-xs dark:bg-white/[0.03] ${
                pt === 'error' ? 'border-error-400 dark:border-error-700' : pt === 'warn' ? 'border-warning-300 dark:border-warning-800' : 'border-gray-200 dark:border-gray-800'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">{isEn ? p.en : p.th}</span>
                {p.kind !== 'onoff' && (p.limit || p.normal) && (
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${toneBadgeCls[pt]}`}>{statusLabel(pt)}</span>
                )}
              </div>
              {p.kind === 'onoff' ? (
                <div className="mt-2.5">
                  <span className={`rounded-full px-3 py-1 text-sm font-bold ${toneBadgeCls[v ? 'run' : 'idle']}`}>
                    {p.id === 'mode' ? (v ? 'AUTO' : 'MANUAL') : v ? 'ON' : 'OFF'}
                  </span>
                </div>
              ) : (
                <div className="mt-2 text-2xl font-black tabular-nums tracking-tight text-gray-900 dark:text-white">
                  {fmt(v, p.dp)}
                  {p.unit && <span className="ml-1 text-sm font-semibold text-gray-400">{p.unit}</span>}
                </div>
              )}
              <div className="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500">{rangeText(p, t)}</div>
            </div>
          );
        })}
      </div>

      {/* ============ 24h charts ============ */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {charts.map(({ p, cats, vals, min, max, avg }) => {
          const r = p.limit ?? p.normal;
          return (
            <div key={p.id} className="rounded-2xl border border-gray-200 bg-white px-3 ps-0 shadow-sm dark:border-gray-800 dark:bg-white/[0.03]">
              <AreaChart
                id={`ww-${u.key}-${p.id}`}
                categories={cats}
                series={[{ name: `${isEn ? p.en : p.th}${p.unit ? ` (${p.unit})` : ''}`, data: vals }]}
                height={230}
                avg={avg.toFixed(p.dp)}
                warningMin={r?.min}
                warningMax={r?.max}
                options={{
                  colors: ['#14b8a6'],
                  xaxis: { type: 'datetime', labels: { datetimeUTC: false, format: 'HH:mm' } },
                  tooltip: { x: { format: 'dd/MM HH:mm' } },
                }}
                label={
                  <div className="flex flex-col gap-1 p-4 pb-0 sm:p-5 sm:pb-0">
                    <h3 className="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-white/90">
                      <TrendingUp className="h-4 w-4 text-gray-400" />
                      {isEn ? p.en : p.th} · {t('wastewater.unit.24_h')}
                    </h3>
                    <div className="flex flex-wrap gap-3 text-xs font-semibold">
                      <span className="text-warning-500">{t('page.reports.charts.min')}: {fmt(min, p.dp)}</span>
                      <span className="text-error-500">{t('page.reports.charts.max')}: {fmt(max, p.dp)}</span>
                      <span className="text-blue-500">{t('page.reports.charts.avg')}: {fmt(avg, p.dp)}</span>
                    </div>
                  </div>
                }
              />
            </div>
          );
        })}
      </div>

      {note && (
        <Panel title={t('wastewater.unit.about_this_unit')} icon={<Info className="h-4 w-4" />}>
          <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">{note}</p>
        </Panel>
      )}
    </div>
  );
}

/** ปุ่มไปหน่วยก่อนหน้า / ถัดไปในกระบวนการ */
function StepLink({ to, dir, label }: { to: string; dir: 'prev' | 'next'; label: string }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
    >
      {dir === 'prev' && <ChevronLeft className="h-3.5 w-3.5" />}
      {label}
      {dir === 'next' && <ChevronRight className="h-3.5 w-3.5" />}
    </Link>
  );
}
