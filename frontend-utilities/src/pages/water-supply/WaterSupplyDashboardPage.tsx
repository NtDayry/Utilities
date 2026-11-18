import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNow } from '@/hooks/useNow';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Container,
  Database,
  Droplets,
  FlaskConical,
  LayoutDashboard,
  Plus,
  Recycle,
  Siren,
  Waves,
  Zap,
} from 'lucide-react';
import PageMeta from '@/components/common/page/PageMeta';
import PageHero from '@/components/common/page/PageHero';
import { useMqttTank } from '@/hooks/useMqttTank';
import { usePwTankLevel } from '@/hooks/usePwTankLevel';
import type { PwSensorStatus } from '@/hooks/usePwSensors';
import { PW_LOOP } from '@/lib/purifiedWater';
import { NEEDS_ATTENTION, TankSiteCard, useSiteStatusLabel, type SiteSource, type SiteStatus } from '@/components/water-supply/overview/TankSiteWidgets';
import { InfoChip, KpiCard, toneBadgeCls, type Tone } from '@/components/common/widgets/StatusWidgets';
import { calculateTanks } from '@/lib/tankCalculations';
import { useTankConfig } from '@/hooks/useTankConfig';
import { TANK_GROUPS, TANK_SITES, type TankGroup, type TankSite } from '@/lib/waterTanks';
import { WATER_STALE_MS } from '@/constants/waterSupply';
import { useWaterSupplySource } from '@/lib/waterSupply/source';
import type { MeterKey } from '@/lib/factorySensors';
import { useNavigate } from 'react-router';
import WaterSystemConnectModal from '@/components/water-supply/water-system/WaterSystemConnectModal';
import { useFeeds } from '@/hooks/useWaterSystemTopics';
import { feedKey, resolveBroker } from '@/lib/waterSystems/mqttTopics';
import { useAuthStore } from '@/store/auth';
import { isAdminRole } from '@/store/factorySensorSettings';
import { useWaterSystems } from '@/store/waterSystems';
import { URL } from '@/api';
import { capacityM3, evaluateSystem } from '@/lib/waterSystems/model';
import type { WaterSystemKind } from '@/types/waterSystem.types';

/** ค่าที่อ่านได้ของแต่ละจุด (ใช้กับการ์ดและ KPI) */
interface SiteReading {
  status: SiteStatus;
  percent: number | null;
  levelText: string;
  volume_m3: number | null;
  capacity_m3: number;
  updatedAt: number | null;
  extra?: ReactNode;
}

/** สถานะเซ็นเซอร์ PW → สีชิป (เกินเกณฑ์ = แดง, นอกช่วงวัด = เหลือง, ไม่มีสัญญาณ = เทา) */
const PW_CHIP_TONE: Record<PwSensorStatus, Tone> = {
  normal: 'info',
  warning: 'error',
  under_range: 'warn',
  over_range: 'warn',
  no_signal: 'idle',
  inactive: 'idle',
};

/** จุดที่แสดงแบบตายตัว — จุดที่ managed (ถัง/บ่อประปาที่ตั้งค่าได้) แสดงจากรายการระบบแทน */
const FIXED_SITES = TANK_SITES.filter((s) => !s.managed);

const GROUP_ICON: Record<TankGroup, ReactNode> = {
  supply: <Waves className="h-4.5 w-4.5" />,
  pw: <FlaskConical className="h-4.5 w-4.5" />,
  effluent: <Recycle className="h-4.5 w-4.5" />,
};

const SITE_ICON: Partial<Record<MeterKey, ReactNode>> = {
  pump: <Waves className="h-4.5 w-4.5" />,
  tank14: <Database className="h-4.5 w-4.5" />,
  b5tank: <Container className="h-4.5 w-4.5" />,
  whtank: <Container className="h-4.5 w-4.5" />,
  pwtank: <FlaskConical className="h-4.5 w-4.5" />,
  pool: <Droplets className="h-4.5 w-4.5" />,
};

// ถังน้ำ/บ่อเก็บน้ำที่เพิ่มจากหน้าเว็บ (ปุ่ม "เพิ่มระบบ") — แสดงในกลุ่มน้ำประปาต่อจากจุดที่มีอยู่เดิม
const KIND_ICON: Record<WaterSystemKind, ReactNode> = {
  pond: <Database className="h-4.5 w-4.5" />,
  tank: <Container className="h-4.5 w-4.5" />,
};
const systemPath = (id: string) => URL.WATER_SYSTEM_ROUTE.replace(':systemId', id);

const levelStatus = (pct: number, site: TankSite): SiteStatus =>
  pct < site.lowPct ? 'low' : pct > site.highPct ? 'high' : 'normal';

export default function WaterSupplyDashboard() {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === 'en';
  const statusLabel = useSiteStatusLabel();

  // แหล่งข้อมูลจริง
  const supplySrc = useWaterSupplySource();
  const supply = useMqttTank(supplySrc.topic, supplySrc.systemId);
  const pw = usePwTankLevel();

  // ระบบที่เพิ่มจากหน้าเว็บ: แต่ละระบบอ่านจาก MQTT topic ของตัวเอง
  const isAdmin = isAdminRole(useAuthStore((s) => s.role));
  const customSystems = useWaterSystems((s) => s.systems);
  const loadSystems = useWaterSystems((s) => s.load);
  useEffect(() => {
    loadSystems().catch((e) => console.error('[water-systems] load failed:', e));
  }, [loadSystems]);
  const customFeeds = useMemo(() => customSystems.map((s) => ({ broker: s.broker, topic: s.topic, systemId: s.id })), [customSystems]);
  const customSnaps = useFeeds(customFeeds);
  const [adding, setAdding] = useState(false);
  const navigate = useNavigate();

  const now = useNow(1000);

  // ขนาดบ่อประปาตั้งค่าในหน้ารายละเอียด (localStorage) — อ่านค่าล่าสุดเมื่อเปิดหน้า
  const tankConfig = useTankConfig();
  const supplyLevel = supply.data?.water_level.level_cm ?? 0;
  const supplyCalc = useMemo(() => calculateTanks(supplyLevel, tankConfig), [supplyLevel, tankConfig]);

  /* ---------------- อ่านค่าแต่ละจุด ---------------- */
  const readings: Record<string, SiteReading> = {};
  for (const site of FIXED_SITES) {
    if (site.source === 'water-supply-mqtt') {
      const d = supply.data;
      const stale = supply.lastUpdate === null || now - supply.lastUpdate > WATER_STALE_MS;
      const capacity = supplyCalc.total.capacity_l / 1000;
      if (!d) {
        readings[site.key] = {
          status: supply.status === 'offline' ? 'offline' : 'connecting',
          percent: null,
          levelText: '—',
          volume_m3: null,
          capacity_m3: capacity,
          updatedAt: null,
        };
        continue;
      }
      const c = d.controls;
      const pct = supplyCalc.total.percent;
      const status: SiteStatus = stale
        ? 'offline'
        : c.alarm_on || c.pump1_overload || c.pump2_overload
        ? 'alarm'
        : levelStatus(pct, site);
      const pumpTone = (on: boolean, ol?: boolean): Tone => (ol ? 'error' : on ? 'run' : 'idle');
      const pumpText = (on: boolean, ol?: boolean) => (ol ? 'OL' : on ? 'RUN' : 'STOP');
      readings[site.key] = {
        status,
        percent: pct,
        levelText: `${d.water_level.level_cm.toFixed(1)} cm`,
        volume_m3: supplyCalc.total.volume_l / 1000,
        capacity_m3: capacity,
        updatedAt: supply.lastUpdate,
        extra: (
          <>
            <InfoChip label={t('water_supply.tank1_info_title')} value={`${supplyCalc.tank1.percent.toFixed(0)}%`} tone="info" />
            <InfoChip label={t('water_supply.tank2_info_title')} value={`${supplyCalc.tank2.percent.toFixed(0)}%`} tone="info" />
            {/* อัตราการไหลจากมิเตอร์น้ำ — flow_alarm = แดง */}
            <InfoChip
              label={t('water_supply.flow_rate')}
              value={`${d.water_level.flow_rate.toFixed(2)} m³/h`}
              tone={d.flow_meter?.flow_alarm ? 'error' : 'info'}
            />
            <InfoChip label="P1" value={pumpText(c.pump1_on, c.pump1_overload)} tone={pumpTone(c.pump1_on, c.pump1_overload)} />
            <InfoChip label="P2" value={pumpText(c.pump2_on, c.pump2_overload)} tone={pumpTone(c.pump2_on, c.pump2_overload)} />
            <InfoChip
              label={t('water_supply.overview.valve')}
              value={c.valve_on ? 'OPEN' : 'CLOSED'}
              tone={c.valve_on ? 'info' : 'idle'}
            />
          </>
        ),
      };
    } else if (site.source === 'pw-sensor-mqtt') {
      const stale = pw.lastUpdate === null || now - pw.lastUpdate > WATER_STALE_MS;
      // ค่าของกลุ่ม Distribution Loop (ยกเว้นอุณหภูมิ): UV, TOC, Conductivity, Instant flow rate, Fluid velocity
      const ps = pw.sensors;
      const loopChips = PW_LOOP.items.some((it) => ps.has(it.metric)) ? (
        <>
          {PW_LOOP.items.map((it) => {
            const ok = ps.has(it.metric);
            const unit = ps.unit(it.device, it.metric);
            const v = ps.value(it.metric);
            return (
              <InfoChip
                key={it.id}
                label={it.label}
                value={ok && v !== null ? `${v.toLocaleString(undefined, { maximumFractionDigits: ps.decimals(it.device, it.metric, 2) })}${unit ? ` ${unit}` : ''}` : '—'}
                tone={ok ? PW_CHIP_TONE[ps.sensorStatus(it.device, it.metric)] : 'idle'}
              />
            );
          })}
        </>
      ) : undefined;
      if (pw.percent === null || pw.level === null) {
        readings[site.key] = {
          status: pw.status === 'offline' ? 'offline' : 'connecting',
          percent: null,
          levelText: '—',
          volume_m3: null,
          capacity_m3: pw.capacityM3 ?? site.capacity_m3,
          updatedAt: pw.lastUpdate,
          extra: loopChips,
        };
        continue;
      }
      // เซนเซอร์อ่านเป็นหน่วยปริมาตร (เช่น Liter, ช่วง 0–2000) → ปริมาตร = ค่าที่อ่านได้, ความจุ = max_range
      // ถ้าเป็นหน่วยความสูง (mm/cm) → ประมาณปริมาตรจาก % × ความจุที่ตั้งไว้ (TANK.pwtank)
      readings[site.key] = {
        status: stale ? 'offline' : levelStatus(pw.percent, site),
        percent: pw.percent,
        levelText: `${pw.level.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${pw.unit}`,
        volume_m3: pw.volumeM3 ?? (pw.percent / 100) * site.capacity_m3,
        capacity_m3: pw.capacityM3 ?? site.capacity_m3,
        updatedAt: pw.lastUpdate,
        extra: loopChips,
      };
    } else {
      readings[site.key] = {
        status: 'no-sensor',
        percent: null,
        levelText: '—',
        volume_m3: null,
        capacity_m3: site.capacity_m3,
        updatedAt: null,
      };
    }
  }

  /* ---------------- ระบบที่เพิ่มจากหน้าเว็บ ---------------- */
  const custom = customSystems.map((sys) => {
    const snap = customSnaps[feedKey(sys)];
    const st = evaluateSystem(sys, snap, now);
    const r: SiteReading = {
      status: st.status,
      percent: st.calc ? st.calc.total.percent : null,
      levelText: st.levelCm === null ? '—' : `${st.levelCm.toFixed(1)} cm`,
      volume_m3: st.calc ? st.calc.total.volume_l / 1000 : null,
      capacity_m3: capacityM3(sys),
      updatedAt: snap?.at ?? null,
      extra: st.reading ? (
        <>
          {sys.tanks.length > 1 && st.calc?.tanks.map((tc, i) => <InfoChip key={`t${i}`} label={sys.tanks[i].name} value={`${tc.percent.toFixed(0)}%`} tone="info" />)}
          {st.reading.flowRate !== null && (
            <InfoChip label={t('water_supply.flow_rate')} value={`${st.reading.flowRate.toFixed(2)} ${sys.sensors.flowRate.unit || 'm³/h'}`} tone="info" />
          )}
          {sys.pumps.map((p, i) => {
            const pr = st.reading!.pumps[i];
            return <InfoChip key={`p${i}`} label={p.name} value={!pr.found ? '—' : pr.fault ? 'OL' : pr.running ? 'RUN' : 'STOP'} tone={!pr.found ? 'idle' : pr.fault ? 'error' : pr.running ? 'run' : 'idle'} />;
          })}
          {st.reading.valveOn !== null && (
            <InfoChip label={t('water_supply.overview.valve')} value={st.reading.valveOn ? 'OPEN' : 'CLOSED'} tone={st.reading.valveOn ? 'info' : 'idle'} />
          )}
        </>
      ) : undefined,
    };
    return { sys, r };
  });

  /* ---------------- แหล่งข้อมูลของแต่ละการ์ด (แต่ละระบบกำหนดเอง) ---------------- */
  const connState = (status: 'connecting' | 'connected' | 'offline' | undefined, last: number | null | undefined): SiteSource['state'] =>
    status === 'connected' && last != null && now - last <= WATER_STALE_MS ? 'live' : status === 'offline' ? 'off' : 'wait';
  const siteSource = (s: TankSite): SiteSource | undefined =>
    s.source === 'water-supply-mqtt'
      ? { label: 'MQTT', detail: supplySrc.topic, state: connState(supply.status, supply.lastUpdate), title: `${supplySrc.brokerUrl} · ${supplySrc.topic}` }
      : s.source === 'pw-sensor-mqtt'
      ? { label: 'MQTT', detail: 'distribution_loop', state: connState(pw.status, pw.lastUpdate) }
      : undefined;
  const systemSource = (sys: (typeof customSystems)[number]): SiteSource | undefined => {
    if (!sys.topic) return undefined;
    const snap = customSnaps[feedKey(sys)];
    const url = resolveBroker(sys.broker).url;
    return { label: 'MQTT', detail: sys.topic, state: connState(snap?.status, snap?.at), title: `${url} · ${sys.topic}` };
  };

  /* ---------------- สรุปภาพรวม ---------------- */
  // รวมจุดเดิม + ระบบที่เพิ่มเอง ให้ KPI / แถบแจ้งเตือนนับครบ
  const all = [
    ...FIXED_SITES.map((s) => ({ key: s.key as string, name: isEn ? s.en : s.th, r: readings[s.key] })),
    ...custom.map(({ sys, r }) => ({ key: `sys:${sys.id}`, name: sys.name, r })),
  ];
  const liveSites = all.filter((x) => x.r.volume_m3 !== null);
  const noSensorCount = all.filter((x) => x.r.status === 'no-sensor').length;
  const attention = all.filter((x) => NEEDS_ATTENTION.includes(x.r.status));
  const hasCritical = attention.some((x) => x.r.status === 'low' || x.r.status === 'alarm');
  const liveVolume = liveSites.reduce((a, x) => a + (x.r.volume_m3 ?? 0), 0);
  const liveCapacity = liveSites.reduce((a, x) => a + x.r.capacity_m3, 0);
  const livePct = liveCapacity > 0 ? (liveVolume / liveCapacity) * 100 : 0;
  const totalCapacity = all.reduce((a, x) => a + x.r.capacity_m3, 0);

  const c = supply.data?.controls;
  const pumpsOn = c ? Number(c.pump1_on) + Number(c.pump2_on) : 0;
  const overload = c ? Number(!!c.pump1_overload) + Number(!!c.pump2_overload) : 0;

  const siteName = (s: TankSite) => (isEn ? s.en : s.th);
  const lastAny = Math.max(supply.lastUpdate ?? 0, pw.lastUpdate ?? 0, ...custom.map((x) => x.r.updatedAt ?? 0));

  return (
    <div className="space-y-6 pb-12">
      <PageMeta
        title={t('water_supply.overview.title')}
        description="Overview of all water tanks and ponds"
      />

      {/* ============ Header ============ */}
      <PageHero
        icon={<LayoutDashboard className="h-5 w-5" />}
        gradientCls="from-sky-500 to-brand-500"
        darkBgCls="dark:bg-gray-800/80"
        title={t('water_supply.overview.title')}
        subtitle={
          <>
            {t('water_supply.overview.subtitle', { count: all.length })}
            {' · '}
            {t('water_supply.last_updated')}:{' '}
            <span className="font-medium text-gray-700 dark:text-gray-200">
              {lastAny ? new Date(lastAny).toLocaleTimeString() : '-'}
            </span>
          </>
        }
      />

      {/* ============ KPI row ============ */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={<Database className="h-4.5 w-4.5" />}
          iconCls="bg-brand-500 text-white"
          label={t('water_supply.overview.kpi_sites')}
          value={`${all.length}`}
          unit={t('water_supply.overview.sites_unit')}
          sub={t('water_supply.overview.kpi_sites_sub', {
            live: liveSites.length,
            pending: noSensorCount,
          })}
        />
        <KpiCard
          icon={<Droplets className="h-4.5 w-4.5" />}
          iconCls="bg-sky-500 text-white"
          label={t('water_supply.overview.kpi_volume')}
          value={liveVolume.toFixed(1)}
          unit="m³"
          sub={t('water_supply.overview.kpi_volume_sub', {
            cap: liveCapacity.toFixed(1),
            total: totalCapacity.toFixed(0),
          })}
          progress={livePct}
          progressCls="from-sky-500 to-cyan-400"
          badge={
            <span className="rounded-lg border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-bold text-sky-700 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-300">
              {livePct.toFixed(1)}%
            </span>
          }
        />
        <KpiCard
          icon={<Siren className="h-4.5 w-4.5" />}
          iconCls={
            hasCritical
              ? 'bg-error-500 text-white animate-pulse'
              : attention.length
              ? 'bg-warning-500 text-white'
              : 'bg-emerald-500 text-white'
          }
          label={t('water_supply.overview.kpi_attention')}
          value={`${attention.length}`}
          unit={t('water_supply.overview.sites_unit')}
          sub={
            attention.length
              ? attention.map((x) => x.name).join(', ')
              : t('water_supply.overview.all_normal')
          }
        />
        <KpiCard
          icon={<Zap className="h-4.5 w-4.5" />}
          iconCls={
            overload
              ? 'bg-error-500 text-white animate-pulse'
              : pumpsOn
              ? 'bg-emerald-500 text-white'
              : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
          }
          label={t('water_supply.overview.kpi_pumps')}
          value={c ? `${pumpsOn}` : '—'}
          unit="/ 2"
          sub={
            c
              ? `${t('water_supply.mode')}: ${c.auto_mode ? t('water_supply.auto') : t('water_supply.manual')}`
              : t('water_supply.connecting')
          }
          badge={
            overload ? (
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${toneBadgeCls.error}`}>OVERLOAD ×{overload}</span>
            ) : undefined
          }
        />
      </div>

      {/* ============ Attention banner ============ */}
      {attention.length === 0 ? (
        liveSites.length > 0 && (
          <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/60 px-5 py-3.5 dark:border-emerald-900 dark:bg-emerald-950/20">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span className="text-sm font-bold text-emerald-700 dark:text-emerald-300">
              {t('water_supply.overview.all_normal_desc')}
            </span>
          </div>
        )
      ) : (
        <div
          className={`flex flex-wrap items-center gap-3 rounded-2xl border px-5 py-3.5 ${
            hasCritical
              ? 'border-error-300 bg-error-50/60 dark:border-error-800 dark:bg-error-950/20'
              : 'border-warning-200 bg-warning-50/60 dark:border-warning-800 dark:bg-warning-500/5'
          }`}
        >
          <AlertTriangle
            className={`h-5 w-5 shrink-0 ${hasCritical ? 'animate-pulse text-error-600 dark:text-error-400' : 'text-warning-600 dark:text-warning-400'}`}
          />
          <div className="flex flex-wrap gap-2">
            {attention.map((x) => (
              <span
                key={x.key}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${
                  x.r.status === 'low' || x.r.status === 'alarm' ? 'bg-error-600 text-white' : toneBadgeCls.warn
                }`}
              >
                {x.name}: {statusLabel(x.r.status)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ============ Tanks by group ============ */}
      {TANK_GROUPS.map((g) => {
        const sites = FIXED_SITES.filter((s) => s.group === g.id);
        // ระบบที่เพิ่มเองอยู่ในกลุ่มน้ำประปา
        const added = g.id === 'supply' ? custom : [];
        if (!sites.length && !added.length) return null;
        return (
          <section key={g.id} className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-2 px-1">
              <div className="flex items-center gap-2.5">
                <span className="text-gray-400 dark:text-gray-500">{GROUP_ICON[g.id]}</span>
                <div>
                  <h2 className="text-base font-bold text-gray-900 dark:text-white">{isEn ? g.en : g.th}</h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{isEn ? g.descEn : g.descTh}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                  {sites.length + added.length} {t('water_supply.overview.sites_unit')}
                </span>
                {/* เพิ่มถังน้ำ / บ่อเก็บน้ำ (เฉพาะกลุ่มน้ำประปา) */}
                {g.id === 'supply' && isAdmin && (
                  <button
                    type="button"
                    onClick={() => setAdding(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-600"
                  >
                    <Plus className="h-4 w-4" />
                    {t('water_systems.add_btn')}
                  </button>
                )}
              </div>
            </div>
            <div className="border-t dark:border-gray-800 grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {sites.map((s) => {
                const r = readings[s.key];
                return (
                  <TankSiteCard
                    key={s.key}
                    name={siteName(s)}
                    location={isEn ? s.locationEn : s.locationTh}
                    unitCount={isEn ? s.unitCountEn : s.unitCountTh}
                    icon={SITE_ICON[s.key] ?? GROUP_ICON[s.group]}
                    group={s.group}
                    status={r.status}
                    percent={r.percent}
                    levelText={r.levelText}
                    volume_m3={r.volume_m3}
                    capacity_m3={r.capacity_m3}
                    lowPct={s.lowPct}
                    highPct={s.highPct}
                    updatedAt={r.updatedAt}
                    detailPath={s.detailPath}
                    source={siteSource(s)}
                  >
                    {r.extra}
                  </TankSiteCard>
                );
              })}
              {added.map(({ sys, r }) => (
                <TankSiteCard
                  key={sys.id}
                  name={sys.name}
                  location={sys.location || t(`water_systems.kind.${sys.kind}.name`)}
                  unitCount={sys.tanks.length > 1 ? `${sys.tanks.length} ${t(`water_systems.kind.${sys.kind}.unit`)}` : undefined}
                  icon={KIND_ICON[sys.kind]}
                  group="supply"
                  status={r.status}
                  percent={r.percent}
                  levelText={r.levelText}
                  volume_m3={r.volume_m3}
                  capacity_m3={r.capacity_m3}
                  lowPct={sys.lowPct}
                  highPct={sys.highPct}
                  updatedAt={r.updatedAt}
                  detailPath={systemPath(sys.id)}
                  source={systemSource(sys)}
                >
                  {r.extra}
                </TankSiteCard>
              ))}
            </div>
          </section>
        );
      })}

      <p className="flex items-center gap-1.5 px-1 text-[11px] text-gray-400 dark:text-gray-500">
        <Clock className="h-3 w-3" />
        {t(
          'water_supply.overview.footnote')}
      </p>

      {/* หน้าต่างเชื่อมต่อ → สร้างแล้วไปหน้าของระบบพร้อมเปิดแผงตั้งค่า (เพิ่มเซ็นเซอร์/ปั๊ม/ขนาดต่อได้เลย) */}
      {adding && <WaterSystemConnectModal onClose={() => setAdding(false)} onCreated={(sys) => navigate(`${systemPath(sys.id)}?setup=1`)} />}
    </div>
  );
}
