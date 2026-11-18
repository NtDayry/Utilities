import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fmtNum as fmt } from '@/utils/format';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  AlertTriangle,
  Box,
  Container,
  Database,
  Droplet,
  Gauge,
  MapPin,
  PlugZap,
  Power,
  Radio,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Waves,
  Zap,
} from 'lucide-react';
import PageMeta from '@/components/common/page/PageMeta';
import BackNav from '@/components/common/navigation/BackNav';
import { Badge, Bar, CommDot, Row, Shell, type Tone } from '@/components/common/widgets/PumpStatusCards';
import { SITE_STATUS_TONE, useSiteStatusLabel } from '@/components/water-supply/overview/TankSiteWidgets';
import { toneBadgeCls } from '@/components/common/widgets/StatusWidgets';
import TankLevel3D from '@/components/common/3d/TankLevel3D';
import { CardHeader, Kpi, LevelRing, card } from '@/components/common/widgets/SystemPageParts';
import TrendCard from '@/components/common/charts/TrendCard';
import type { TrendPoint } from '@/components/common/charts/LiveTrendChart';
import WaterSystemSettings from '@/components/water-supply/water-system/WaterSystemSettings';
import useSwalAlert from '@/hooks/useSwalAlert';
import { useFeeds, useNow } from '@/hooks/useWaterSystemTopics';
import { useAuthStore } from '@/store/auth';
import { isAdminRole } from '@/store/factorySensorSettings';
import { useWaterSystems } from '@/store/waterSystems';
import { URL } from '@/api';
import { feedKey, resolveBroker } from '@/lib/waterSystems/mqttTopics';
import { capacityM3, evaluateSystem, scanPayload, tankArea, type PumpReading } from '@/lib/waterSystems/model';
import type { WaterSystemPump } from '@/types/waterSystem.types';

const HISTORY_POINTS = 120;
const brokerHost = (url: string) => url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/\/.*$/, '');

/**
 * หน้าของถังน้ำ/บ่อเก็บน้ำที่เพิ่มจากหน้าเว็บ — route: URL.WATER_SYSTEM_ROUTE (/water-supply/systems/:systemId)
 * แถบหัว (สถานะ + ตัวเลขสรุป) · ภาพ 3 มิติ + วงแหวนระดับ + รายใบ · อุปกรณ์ที่เปิดใช้ · แนวโน้มระดับ
 * admin กด "ตั้งค่า" เพื่อเพิ่มเซ็นเซอร์ ปั๊ม และปรับขนาดได้ในหน้านี้
 */
export default function WaterSystemPage() {
  const { systemId } = useParams();
  const [params, setParams] = useSearchParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const swal = useSwalAlert();
  const statusLabel = useSiteStatusLabel();
  const isAdmin = isAdminRole(useAuthStore((s) => s.role));
  const { loaded, error: loadError, systems, load, remove } = useWaterSystems();
  useEffect(() => {
    load().catch((e) => console.error('[water-systems] load failed:', e));
  }, [load]);

  const cfg = systems.find((s) => s.id === systemId);
  const feed = useMemo(() => ({ broker: cfg?.broker ?? null, topic: cfg?.topic ?? '', systemId: cfg?.id }), [cfg?.broker, cfg?.topic, cfg?.id]);
  const snap = useFeeds(feed.topic ? [feed] : [])[feedKey(feed)];
  const now = useNow();
  const points = useMemo(() => scanPayload(snap?.raw), [snap?.raw]);
  // ?setup=1 = เพิ่งสร้างจากหน้าต่างเชื่อมต่อ → เปิดแผงตั้งค่าให้เลย
  const [settingsOpen, setSettingsOpen] = useState(params.get('setup') === '1');

  // ประวัติระดับน้ำ (%) ในหน่วยความจำตั้งแต่เปิดหน้า — เพิ่มจุดเมื่อมีข้อความใหม่เท่านั้น
  const history = useRef<{ key: string; at: number | null; level: TrendPoint[]; flow: TrendPoint[] }>({ key: '', at: null, level: [], flow: [] });
  if (history.current.key !== feedKey(feed)) history.current = { key: feedKey(feed), at: null, level: [], flow: [] };

  if (!cfg) {
    return (
      <div className="space-y-6 pb-12">
        <BackNav to={URL.WATER_SUPPLY_DASHBOARD} label={t('water_supply.overview.back_to_overview')} />
        {!loaded && loadError && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-10 text-center dark:border-red-500/30 dark:bg-red-500/10">
            <div className="text-base font-bold text-red-700 dark:text-red-300">{t('water_systems.error.load_failed')}</div>
            <button type="button" className="mt-3 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700" onClick={() => load(true).catch(() => undefined)}>
              {t('water_systems.retry')}
            </button>
          </div>
        )}
        {loaded && (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-10 text-center dark:border-gray-700 dark:bg-white/[0.03]">
            <div className="text-base font-bold text-gray-700 dark:text-gray-200">{t('water_systems.not_exist')}</div>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('water_systems.not_exist_desc')}</p>
          </div>
        )}
      </div>
    );
  }

  const state = evaluateSystem(cfg, snap, now);
  const { reading: r, calc } = state;
  const hasData = r !== null;
  if (calc && snap?.at != null && history.current.at !== snap.at) {
    history.current.at = snap.at;
    const at = snap.at;
    history.current.level = [...history.current.level, { x: at, y: Number(calc.total.percent.toFixed(1)) }].slice(-HISTORY_POINTS);
    if (r?.flowRate != null) history.current.flow = [...history.current.flow, { x: at, y: Number(r.flowRate.toFixed(3)) }].slice(-HISTORY_POINTS);
  }

  const s = cfg.sensors;
  const trendLimits = [
    { y: cfg.lowPct, label: `LOW ${cfg.lowPct}%`, color: '#F59E0B' },
    { y: cfg.highPct, label: `HIGH ${cfg.highPct}%`, color: '#EF4444' },
  ];
  const color = cfg.waterColor;
  const unitWord = t(`water_systems.kind.${cfg.kind}.unit`);
  const capacity = capacityM3(cfg);
  const live = hasData && state.live;
  const updatedText = snap?.at ? new Date(snap.at).toLocaleTimeString() : t('water_systems.detail.never');
  const tone = SITE_STATUS_TONE[state.status];

  const closeSettings = () => {
    setSettingsOpen(false);
    if (params.has('setup')) setParams({}, { replace: true });
  };

  const onDelete = async () => {
    const res = await swal.confirm({
      title: t('water_systems.confirm.delete_title'),
      message: t('water_systems.confirm.delete', { name: cfg.name }),
    });
    if (!res.isConfirmed) return;
    try {
      await remove(cfg.id);
      navigate(URL.WATER_SUPPLY_DASHBOARD, { replace: true });
    } catch (e) {
      console.error('[water-systems] delete failed:', e);
      swal.error({ message: t('water_systems.error.delete_failed') });
    }
  };

  const pumpCard = (pump: WaterSystemPump, i: number, p: PumpReading | undefined) => {
    const inverter = pump.drive === 'inverter';
    const found = p?.found ?? false;
    const tonePump: Tone = !found ? 'stop' : p!.fault ? 'fault' : p!.running ? 'run' : 'stop';
    return (
      <Shell
        darkSurface
        key={`p${i}`}
        tone={tonePump}
        icon={inverter ? <Zap className="h-4.5 w-4.5" /> : <Power className="h-4.5 w-4.5" />}
        title={pump.name}
        sub={t(`water_systems.drive.${pump.drive}`)}
        badge={
          !found ? (
            <Badge tone="stop">{hasData ? t('water_systems.not_found') : '—'}</Badge>
          ) : tonePump === 'fault' ? (
            <Badge tone="fault">
              <AlertTriangle className="h-3 w-3" />
              FAULT
            </Badge>
          ) : tonePump === 'run' ? (
            <Badge tone="run">
              <span className="h-2 w-2 animate-ping rounded-full bg-emerald-500" />
              {t('water_supply.pump_run')}
            </Badge>
          ) : (
            <Badge tone="stop">{t('water_supply.pump_stop')}</Badge>
          )
        }
      >
        {inverter && (
          <>
            <Row label={t('water_supply.scene3d.frequency')}>{fmt(p?.freq ?? null, 1)} Hz</Row>
            <Bar value={p?.freq ?? 0} max={50} cls={p?.fault ? 'bg-error-500' : 'bg-emerald-500'} />
            <Row label={t('water_supply.scene3d.current')}>{fmt(p?.current ?? null, 1)} A</Row>
          </>
        )}
        <Row label={t('water_supply.overload_status')}>
          {!found ? (
            '—'
          ) : p!.fault ? (
            <span className="inline-flex items-center gap-1 text-error-600 dark:text-error-400">
              <ShieldAlert className="h-3.5 w-3.5" />
              {t('water_supply.tripped')}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <ShieldCheck className="h-3.5 w-3.5" />
              {t('water_supply.normal')}
            </span>
          )}
        </Row>
        {inverter && p?.commOk != null && (
          <Row label="Modbus">
            <CommDot ok={p.commOk} />
          </Row>
        )}
        <Row label={t('water_systems.path.label')}>
          <span className="font-mono text-[11px] font-normal">{pump.path}</span>
        </Row>
      </Shell>
    );
  };

  const missing = (v: unknown) => (v === null && hasData ? t('water_systems.not_found') : '—');
  const equipment: ReactNode[] = [];
  if (s.meterTotal.enabled)
    equipment.push(
      <Shell
        darkSurface
        key="mt"
        tone={r?.meterTotal != null ? 'info' : 'stop'}
        icon={<Gauge className="h-4.5 w-4.5" />}
        title={t('water_systems.sensor.meterTotal')}
        sub={t('water_systems.sensor_desc.meterTotal')}
        badge={<Badge tone={r?.meterTotal != null ? 'info' : 'stop'}>{r?.meterTotal != null ? 'OK' : missing(r?.meterTotal ?? null)}</Badge>}
      >
        <div className="py-1 text-2xl font-black tabular-nums text-gray-900 dark:text-white">
          {fmt(r?.meterTotal ?? null, 3)} <span className="text-sm font-semibold text-gray-500">{s.meterTotal.unit}</span>
        </div>
        <Row label={t('water_systems.path.label')}>
          <span className="font-mono text-[11px] font-normal">{s.meterTotal.path}</span>
        </Row>
      </Shell>
    );
  if (s.flowRate.enabled)
    equipment.push(
      <Shell
        darkSurface
        key="fr"
        tone={(r?.flowRate ?? 0) > 0 ? 'info' : 'stop'}
        icon={<Waves className="h-4.5 w-4.5" />}
        title={t('water_systems.sensor.flowRate')}
        sub={t('water_systems.sensor_desc.flowRate')}
        badge={
          <Badge tone={(r?.flowRate ?? 0) > 0 ? 'info' : 'stop'}>
            {r?.flowRate == null ? missing(r?.flowRate ?? null) : r.flowRate > 0 ? 'FLOW' : 'NO FLOW'}
          </Badge>
        }
      >
        <div className="py-1 text-2xl font-black tabular-nums text-gray-900 dark:text-white">
          {fmt(r?.flowRate ?? null, 3)} <span className="text-sm font-semibold text-gray-500">{s.flowRate.unit}</span>
        </div>
        <Row label={t('water_systems.path.label')}>
          <span className="font-mono text-[11px] font-normal">{s.flowRate.path}</span>
        </Row>
      </Shell>
    );
  if (s.inletValve.enabled)
    equipment.push(
      <Shell
        darkSurface
        key="iv"
        tone={r?.valveOn ? 'info' : 'stop'}
        icon={<Droplet className="h-4.5 w-4.5" />}
        title={t('water_systems.sensor.inletValve')}
        sub={t('water_systems.sensor_desc.inletValve')}
        badge={
          <Badge tone={r?.valveOn ? 'info' : 'stop'}>
            {r?.valveOn == null ? missing(r?.valveOn ?? null) : r.valveOn ? t('water_supply.valve_open') : t('water_supply.valve_closed')}
          </Badge>
        }
      >
        <div className="py-1 text-2xl font-black text-gray-900 dark:text-white">{r?.valveOn == null ? '—' : r.valveOn ? 'OPEN' : 'CLOSED'}</div>
        <Row label={t('water_systems.path.label')}>
          <span className="font-mono text-[11px] font-normal">{s.inletValve.path}</span>
        </Row>
      </Shell>
    );
  cfg.pumps.forEach((pump, i) => equipment.push(pumpCard(pump, i, r?.pumps[i])));

  const actionBtn = 'inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition';

  return (
    <div className="space-y-6 pb-12">
      <PageMeta title={cfg.name} description={`${cfg.name} — water level`} />

      {/* ============ หัวหน้า: ปุ่มกลับ + ชื่อ + สถานะ ============ */}
      <section className={`${card} p-5 sm:p-6`}>
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-white shadow-lg" style={{ background: color }}>
              {cfg.kind === 'pond' ? <Database className="h-6 w-6" /> : <Container className="h-6 w-6" />}
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">
                {t(`water_systems.kind.${cfg.kind}.name`)}
              </div>
              <h1 className="truncate text-2xl font-extrabold tracking-tight text-gray-900 dark:text-white">{cfg.name}</h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
                {cfg.location && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 dark:bg-gray-700">
                    <MapPin className="h-3 w-3" />
                    {cfg.location}
                  </span>
                )}
                {cfg.topic ? (
                  <span
                    className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 font-mono dark:bg-gray-700"
                    title={resolveBroker(cfg.broker).url}
                  >
                    <Radio className="h-3 w-3" />
                    {cfg.topic}
                    <span className="text-gray-400">@ {brokerHost(resolveBroker(cfg.broker).url)}</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                    <Radio className="h-3 w-3" />
                    {t('water_systems.no_topic')}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col items-end gap-2">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${toneBadgeCls[tone]}`}>
                {statusLabel(state.status)}
              </span>
              {cfg.topic && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white/80 px-3 py-1 text-xs font-semibold text-gray-600 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-300">
                  <span className="relative flex h-2 w-2">
                    {live && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />}
                    <span
                      className={`relative inline-flex h-2 w-2 rounded-full ${live ? 'bg-emerald-500' : hasData ? 'bg-gray-400' : snap?.status === 'offline' ? 'bg-red-500' : 'bg-amber-400'}`}
                    />
                  </span>
                  {live
                    ? t('water_supply.live')
                    : hasData
                      ? t('water_supply.stale_data')
                      : snap?.status === 'offline'
                        ? t('water_supply.offline')
                        : t('water_supply.connecting')}
                  <span className="text-gray-400">· {updatedText}</span>
                </span>
              )}
            </div>
            {state.live && state.faultPumps > 0 && (
              <span className="inline-flex animate-pulse items-center gap-1.5 rounded-full bg-error-600 px-3 py-1 text-xs font-bold text-white">
                <AlertTriangle className="h-3.5 w-3.5" />
                {t('water_systems.pump_fault_count', { n: state.faultPumps })}
              </span>
            )}
            {isAdmin && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => (settingsOpen ? closeSettings() : setSettingsOpen(true))}
                  aria-expanded={settingsOpen}
                  className={`${actionBtn} bg-gray-900 text-white hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200`}
                >
                  <Settings className="h-3.5 w-3.5" />
                  {t('water_systems.settings.open_btn')}
                </button>
                <button
                  type="button"
                  onClick={() => void onDelete()}
                  className={`${actionBtn} border border-gray-200 text-gray-600 hover:border-red-300 hover:bg-red-50 hover:text-red-600 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-red-500/10`}
                  title={t('water_systems.delete_btn')}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="mt-4">
          <BackNav
            to={URL.WATER_SUPPLY_DASHBOARD}
            label={t('water_supply.overview.back_to_overview')}
            crumbs={[{ label: t('navbar.water_supply_dashboard'), to: URL.WATER_SUPPLY_DASHBOARD }, { label: cfg.name }]}
            className=""
          />
        </div>
      </section>

      {/* ============ ตัวเลขสรุป ============ */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label={t('water_systems.detail.total_level')} value={calc ? calc.total.percent.toFixed(1) : '—'} unit="%">
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${calc?.total.percent ?? 0}%`, background: color }} />
          </div>
        </Kpi>
        <Kpi
          label={t('water_systems.detail.volume')}
          value={calc ? Math.round(calc.total.volume_l).toLocaleString() : '—'}
          unit={t('water_supply.liters_unit')}
          sub={calc ? `${(calc.total.volume_l / 1000).toFixed(2)} m³` : undefined}
        />
        <Kpi
          label={t('water_systems.detail.capacity')}
          value={capacity.toFixed(1)}
          unit="m³"
          sub={t('water_systems.detail.unit_count', { n: cfg.tanks.length, unit: unitWord })}
        />
        <Kpi
          label={t('water_systems.detail.depth')}
          value={state.levelCm === null ? '—' : state.levelCm.toFixed(1)}
          unit="cm"
          sub={`${t('water_systems.limits')} ${cfg.lowPct}–${cfg.highPct}%`}
        />
      </div>

      {/* แผงตั้งค่า (admin): เพิ่มเซ็นเซอร์ / ปั๊ม / ปรับขนาด — key = เวลาที่บันทึกล่าสุด เพื่อเริ่มจากค่าที่บันทึกแล้วเสมอ */}
      {isAdmin && settingsOpen && (
        <WaterSystemSettings key={cfg.updatedAt} system={cfg} points={points} levelRaw={r?.levelRaw ?? null} onClose={closeSettings} />
      )}

      {/* ยังไม่มีข้อมูลเข้า */}
      {!hasData && (
        <div className="flex items-start gap-3 rounded-2xl border border-dashed border-amber-300 bg-amber-50/60 p-4 dark:border-amber-800/60 dark:bg-amber-500/5">
          <PlugZap className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div>
            <div className="text-sm font-bold text-gray-800 dark:text-gray-100">
              {cfg.topic ? t('water_systems.no_data_title') : t('water_systems.no_topic_title')}
            </div>
            <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">
              {cfg.topic ? t('water_systems.no_data_desc', { topic: cfg.topic }) : t('water_systems.no_topic_desc')}
            </p>
            {snap?.error && <p className="mt-1 font-mono text-xs text-red-600 dark:text-red-400">{snap.error}</p>}
          </div>
        </div>
      )}

      {/* ============ ภาพ 3 มิติ + ระดับน้ำ ============ */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className={`${card} p-4`}>
          <CardHeader icon={<Box className="h-4 w-4" />} title={t('water_systems.scene.title')} hint={t('water_systems.detail.scene_hint')} />
          <div className="mt-3">
            <TankLevel3D
              kind={cfg.kind}
              tanks={cfg.tanks}
              calc={calc}
              waterColor={color}
              offline={hasData && !state.live}
              valve={s.inletValve.enabled ? (r?.valveOn ?? null) : undefined}
              className="h-[440px]"
            />
          </div>
          {s.level.enabled && hasData && r.levelRaw === null && (
            <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
              {t('water_systems.level_not_found', { path: s.level.path })}
            </div>
          )}
          {!s.level.enabled && (
            <div className="mt-3 rounded-xl bg-gray-50 p-3 text-sm text-gray-600 dark:bg-gray-700/60 dark:text-gray-400">
              {t('water_systems.no_level_sensor')}
            </div>
          )}
        </section>

        <div className="flex flex-col gap-6">
          <section className={`${card} p-5`}>
            <CardHeader icon={<Activity className="h-4 w-4" />} title={t('water_systems.detail.gauge_title')} />
            <div className="mt-4 flex flex-wrap items-center gap-6">
              <LevelRing percent={calc ? calc.total.percent : null} color={color} low={cfg.lowPct} high={cfg.highPct}>
                <span className="text-3xl font-extrabold tabular-nums tracking-tight text-gray-900 dark:text-white">
                  {calc ? calc.total.percent.toFixed(1) : '—'}
                </span>
                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">% {t('water_supply.percent_full')}</span>
              </LevelRing>
              <dl className="grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <div>
                  <dt className="text-[11px] text-gray-500 dark:text-gray-400">{t('water_systems.detail.volume')}</dt>
                  <dd className="font-bold tabular-nums text-gray-900 dark:text-white">
                    {calc ? `${(calc.total.volume_l / 1000).toFixed(2)} m³` : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-gray-500 dark:text-gray-400">{t('water_systems.detail.free')}</dt>
                  <dd className="font-bold tabular-nums text-gray-900 dark:text-white">
                    {calc ? `${((calc.total.capacity_l - calc.total.volume_l) / 1000).toFixed(2)} m³` : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
                    <span className="h-2 w-2 rounded-full bg-red-500" />
                    {t('water_systems.detail.low_limit')}
                  </dt>
                  <dd className="font-bold tabular-nums text-gray-900 dark:text-white">{cfg.lowPct}%</dd>
                </div>
                <div>
                  <dt className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
                    <span className="h-2 w-2 rounded-full bg-amber-500" />
                    {t('water_systems.detail.high_limit')}
                  </dt>
                  <dd className="font-bold tabular-nums text-gray-900 dark:text-white">{cfg.highPct}%</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-[11px] text-gray-500 dark:text-gray-400">{t('water_systems.level_path')}</dt>
                  <dd className="truncate font-mono text-xs text-gray-700 dark:text-gray-300">
                    {s.level.enabled ? `${s.level.path} (${cfg.levelUnit === 'percent' ? '%' : cfg.levelUnit})` : '—'}
                  </dd>
                </div>
              </dl>
            </div>
          </section>

          <section className={`${card} flex-1 p-5`}>
            <CardHeader
              icon={cfg.kind === 'pond' ? <Database className="h-4 w-4" /> : <Container className="h-4 w-4" />}
              title={t('water_systems.detail.tanks_title', { unit: unitWord })}
              hint={cfg.tanks.length > 1 ? t('water_systems.tanks_connected_note') : undefined}
            />
            <ul className="mt-4 grid gap-x-6 gap-y-5 sm:grid-cols-2">
              {cfg.tanks.map((tank, i) => {
                const c = calc?.tanks[i];
                const cap = tankArea(tank) * tank.height_m;
                return (
                  <li key={i}>
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-sm font-semibold text-gray-900 dark:text-white">{tank.name}</span>
                          {cfg.tanks.length > 1 && s.level.enabled && i === cfg.sensorTank && (
                            <span className="whitespace-nowrap rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">
                              {t('water_systems.sensor_here')}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                          {tank.shape === 'cylinder'
                            ? `⌀ ${tank.diameter_m} × ${tank.height_m} m`
                            : `${tank.width_m} × ${tank.length_m} × ${tank.height_m} m`}
                          {tank.offset_cm !== 0 && ` · ${t('water_systems.offset_value', { cm: tank.offset_cm })}`} · {cap.toFixed(1)} m³
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-lg font-extrabold tabular-nums text-gray-900 dark:text-white">
                          {c ? `${c.percent.toFixed(1)}%` : '—'}
                        </div>
                        <div className="text-[11px] tabular-nums text-gray-500 dark:text-gray-400">
                          {c ? `${c.level_cm.toFixed(0)} cm · ${(c.volume_l / 1000).toFixed(2)} m³` : ''}
                        </div>
                      </div>
                    </div>
                    <div className="relative mt-2 h-2.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${c?.percent ?? 0}%`, background: `linear-gradient(90deg, ${color}aa, ${color})` }}
                      />
                      <span className="absolute inset-y-0 w-0.5 bg-red-500/80" style={{ left: `${cfg.lowPct}%` }} />
                      <span className="absolute inset-y-0 w-0.5 bg-amber-500/80" style={{ left: `${cfg.highPct}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </div>

      {/* ============ กราฟ (ซ้าย) | อุปกรณ์และเซ็นเซอร์ (ขวา) — อย่างละครึ่ง ; จอเล็กกราฟอยู่ล่าง ============ */}
      {(() => {
        const hasTrend = s.level.enabled || s.flowRate.enabled;
        const hasEquip = equipment.length > 0;
        const half = hasTrend && hasEquip;
        return (
          <div className={`grid items-start gap-6 ${half ? 'lg:grid-cols-2' : ''}`}>
            {/* อุปกรณ์และเซ็นเซอร์ — เฉพาะที่เปิดใช้ (อยู่ก่อนใน DOM เพื่อให้จอเล็กแสดงก่อนกราฟ) */}
            {hasEquip ? (
              <section className="space-y-3">
                <h2 className="px-1 text-sm font-bold text-gray-900 dark:text-white">{t('water_systems.detail.equipment')}</h2>
                <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${half ? '' : 'xl:grid-cols-4'}`}>{equipment}</div>
              </section>
            ) : (
              isAdmin &&
              !settingsOpen && (
                <button
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  className="w-full rounded-2xl border border-dashed border-gray-300 bg-gray-50/60 p-5 text-center text-sm text-gray-600 transition hover:border-sky-400 hover:bg-sky-50/50 hover:text-sky-700 lg:col-span-2 dark:border-gray-700 dark:bg-white/[0.02] dark:text-gray-400"
                >
                  {t('water_systems.add_more_hint')}
                </button>
              )
            )}

            {/* แนวโน้มระดับน้ำ / อัตราการไหล (ตั้งแต่เปิดหน้า) — จอใหญ่ย้ายไปซ้าย */}
            {hasTrend && (
              <section className={`space-y-3 ${half ? 'lg:order-first' : ''}`}>
                <h2 className="px-1 text-sm font-bold text-gray-900 dark:text-white">{t('water_systems.detail.trends')}</h2>
                <div className="grid gap-6">
                  {s.level.enabled && (
                    <TrendCard
                      title={t('water_systems.trend_title')}
                      unit="%"
                      points={history.current.level}
                      current={calc ? calc.total.percent : null}
                      currentSuffix={state.levelCm === null ? undefined : `(${state.levelCm.toFixed(1)} cm)`}
                      defaultColor={color}
                      decimals={1}
                      height={half ? 260 : 300}
                      limits={trendLimits}
                      boxClassName={card}
                    />
                  )}
                  {s.flowRate.enabled && (
                    <TrendCard
                      title={t('water_supply.flow_rate_trend')}
                      unit={s.flowRate.unit || 'm³/h'}
                      points={history.current.flow}
                      current={r?.flowRate ?? null}
                      defaultColor="#06b6d4"
                      decimals={2}
                      currentDecimals={3}
                      height={half ? 260 : 300}
                      boxClassName={card}
                    />
                  )}
                </div>
              </section>
            )}
          </div>
        );
      })()}
    </div>
  );
}
