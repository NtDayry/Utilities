import { Navigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Gauge, Info, MapPin, PlugZap, Ruler, ShieldAlert, Waves } from 'lucide-react';
import PageMeta from '@/components/common/page/PageMeta';
import BackNav from '@/components/common/navigation/BackNav';
import { URL } from '@/api';
import { MiniTank, useSiteStatusLabel } from '@/components/water-supply/overview/TankSiteWidgets';
import { Panel, toneBadgeCls } from '@/components/common/widgets/StatusWidgets';
import { findTankSite, TANK_GROUPS, tankNote } from '@/lib/waterTanks';

/**
 * หน้ารายละเอียดของถัง/บ่อเก็บน้ำแต่ละจุด
 * - จุดที่มีหน้ารายละเอียดเฉพาะอยู่แล้ว (บ่อประปา, ถัง PW) จะถูกส่งต่อไปหน้านั้น
 * - จุดที่ยังไม่มีเซนเซอร์ แสดงข้อมูลจำเพาะของถังและสถานะ "รอเชื่อมต่อเซนเซอร์"
 */
export default function WaterTankDetail() {
  const { tankKey } = useParams();
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === 'en';
  const statusLabel = useSiteStatusLabel();
  const site = findTankSite(tankKey);

  if (!site) return <Navigate to={URL.WATER_SUPPLY_DASHBOARD} replace />;
  if (site.source !== 'none' || site.managed) return <Navigate to={site.detailPath} replace />;

  const group = TANK_GROUPS.find((g) => g.id === site.group);
  const note = tankNote(site, isEn);
  const name = isEn ? site.en : site.th;

  const specs = [
    { icon: <Waves className="h-4 w-4" />, label: t('water_supply.overview.capacity'), value: `${site.capacity_m3.toFixed(1)} m³`, sub: `≈ ${(site.capacity_m3 * 1000).toLocaleString()} ${t('water_supply.liters_unit')}` },
    { icon: <Ruler className="h-4 w-4" />, label: t('water_supply.overview.tank_height'), value: `${site.height_m.toFixed(1)} m` },
    { icon: <ShieldAlert className="h-4 w-4" />, label: t('water_supply.overview.alarm_limits'), value: `${site.lowPct}% – ${site.highPct}%`, sub: t('water_supply.overview.alarm_limits_sub') },
    { icon: <Gauge className="h-4 w-4" />, label: t('water_supply.overview.data_source'), value: t('water_supply.overview.no_data_source') },
  ];

  return (
    <div className="space-y-6 pb-12">
      <PageMeta title={name} description={`${name} — water tank detail`} />

      {/* Header */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-white/[0.03]">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white sm:text-2xl">{name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
            <MapPin className="h-3.5 w-3.5" />
            {isEn ? site.locationEn : site.locationTh}
            {(isEn ? site.unitCountEn : site.unitCountTh) && <span>· {isEn ? site.unitCountEn : site.unitCountTh}</span>}
            {group && <span>· {isEn ? group.en : group.th}</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-gray-100 pt-4 dark:border-gray-800">
          <BackNav
            to={URL.WATER_SUPPLY_DASHBOARD}
            label={t('water_supply.overview.back_to_overview')}
            crumbs={[{ label: t('navbar.water_supply_dashboard'), to: URL.WATER_SUPPLY_DASHBOARD }, { label: name }]}
            className=""
          />
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${toneBadgeCls.idle}`}>{statusLabel('no-sensor')}</span>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Tank graphic */}
        <Panel title={t('water_supply.current_level')} icon={<Waves className="h-4 w-4" />}>
          <div className="flex flex-col items-center gap-4 py-2">
            <MiniTank percent={null} status="no-sensor" group={site.group} lowPct={site.lowPct} highPct={site.highPct} size="lg" />
            <div className="text-center">
              <div className="text-3xl font-black text-gray-300 dark:text-gray-600">— %</div>
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t('water_supply.overview.no_reading')}
              </div>
            </div>
          </div>
        </Panel>

        <div className="space-y-6 lg:col-span-2">
          {/* Sensor pending notice */}
          <div className="flex items-start gap-3 rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-5 dark:border-gray-700 dark:bg-white/[0.03]">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gray-200 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
              <PlugZap className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-gray-800 dark:text-gray-100">
                {t('water_supply.overview.pending_title')}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                {t(
                  'water_supply.overview.pending_desc')}
              </p>
            </div>
          </div>

          {/* Specs */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {specs.map((s) => (
              <div
                key={s.label}
                className="rounded-2xl border border-gray-200 bg-white p-4.5 shadow-xs dark:border-gray-800 dark:bg-white/[0.03]"
              >
                <div className="flex items-center gap-2 text-xs font-semibold text-gray-500 dark:text-gray-400">
                  <span className="text-gray-400">{s.icon}</span>
                  {s.label}
                </div>
                <div className="mt-2 text-xl font-black tabular-nums text-gray-900 dark:text-white">{s.value}</div>
                {s.sub && <div className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">{s.sub}</div>}
              </div>
            ))}
          </div>

          {note && (
            <Panel title={t('water_supply.overview.about')} icon={<Info className="h-4 w-4" />}>
              <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">{note}</p>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
