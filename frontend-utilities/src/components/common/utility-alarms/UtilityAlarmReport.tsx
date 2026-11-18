import { useEffect, useMemo, useState } from 'react';
import { csvField, downloadCsv } from '@/utils/export/csv';
import { useNow } from '@/hooks/useNow';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import Chart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import dayjs from 'dayjs';
import { Bell, BellRing, ShieldAlert, TriangleAlert, Timer, CheckCheck, Search, Download, Settings2, CircleCheck, RotateCcw } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import { useAuthStore } from '@/store/auth';
import useSwalAlert from '@/hooks/useSwalAlert';
import { getCatalog, loadAcks, mockEvents, saveAcks, type AlarmSeverity, type UtilityAlarmEvent, type UtilitySystem } from '@/lib/utilityAlarms';
import { ackUtilityAlarmEvents, getUtilityAlarmEvents } from '@/api/utilities/utilitiesApi';
import { backendBridge } from '@/lib/mqtt/backendBridge';
import { LevelBadge, SeverityPill } from '@/components/common/utility-alarms/shared';
import { SEVERITY_STYLE, SYSTEM_META, card, fmtNum, inputCls, useFmtDuration } from '@/components/common/utility-alarms/meta';

type RangePreset = '24h' | '7d' | '30d' | 'custom';
type StatusFilter = 'all' | 'active' | 'ended' | 'unack' | 'ack';

const PAGE_SIZES = [20, 50, 100];

export default function UtilityAlarmReport({ system }: { system: UtilitySystem }) {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === 'en';
  const { theme } = useTheme();
  const username = useAuthStore((s) => s.username) || 'user';
  const swal = useSwalAlert();
  const fmtDur = useFmtDuration();
  const catalog = useMemo(() => getCatalog(system), [system]);
  const meta = SYSTEM_META[system];

  const now = useNow(30_000);
  const [acks, setAcks] = useState(() => loadAcks());
  const [preset, setPreset] = useState<RangePreset>('7d');
  const [fromDate, setFromDate] = useState(dayjs().subtract(6, 'day').format('YYYY-MM-DD'));
  const [toDate, setToDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [group, setGroup] = useState('all');
  const [severity, setSeverity] = useState<'all' | AlarmSeverity>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState<Set<string>>(new Set());


  const [fromMs, toMs] = useMemo(() => {
    if (preset === '24h') return [now - 86_400_000, now];
    if (preset === '7d') return [dayjs(now).subtract(6, 'day').startOf('day').valueOf(), now];
    if (preset === '30d') return [dayjs(now).subtract(29, 'day').startOf('day').valueOf(), now];
    return [dayjs(fromDate).startOf('day').valueOf(), dayjs(toDate).endOf('day').valueOf()];
  }, [preset, fromDate, toDate, now]);

  /* ---------- เหตุการณ์จริงจาก backend (ถัง/บ่อที่เพิ่มจากหน้าเว็บ) ---------- */
  const [serverEvents, setServerEvents] = useState<UtilityAlarmEvent[]>([]);
  const [serverError, setServerError] = useState(false);
  const [serverTick, setServerTick] = useState(0);
  useEffect(() => {
    let alive = true;
    const range = getUtilityAlarmEvents({ system, start: new Date(fromMs).toISOString(), end: new Date(toMs).toISOString(), limit: 2000 });
    // alarm ที่ยังไม่จบแต่เริ่มก่อนช่วงเวลาที่เลือก ต้องแสดงด้วย
    const active = getUtilityAlarmEvents({ system, active: true, limit: 500 });
    Promise.all([range, active])
      .then(([a, b]) => {
        if (!alive) return;
        const m = new Map<string, UtilityAlarmEvent>();
        [...a.items, ...b.items].forEach((e) => m.set(e.id, e));
        setServerEvents([...m.values()]);
        setServerError(false);
      })
      .catch((e) => {
        console.warn('[utility-alarms] load events failed:', e);
        if (alive) setServerError(true);
      });
    return () => {
      alive = false;
    };
  }, [system, fromMs, toMs, serverTick]);
  // เกิด / หาย / รับทราบ alarm → โหลดใหม่ทันที (ผ่าน WebSocket ของ backend)
  useEffect(() => backendBridge.onAlarm((a) => a.event?.system === system && setServerTick((n) => n + 1)), [system]);
  const serverIds = useMemo(() => new Set(serverEvents.map((e) => e.id)), [serverEvents]);
  // กลุ่มของเหตุการณ์จริงที่ไม่อยู่ใน catalog (เช่น water-system:<id>) — ใช้ชื่อระบบจากเหตุการณ์
  const serverGroups = useMemo(() => {
    const m = new Map<string, { id: string; th: string; en: string }>();
    serverEvents.forEach((e) => {
      if (!catalog.groups.some((g) => g.id === e.groupId) && !m.has(e.groupId)) m.set(e.groupId, { id: e.groupId, th: e.deviceTh, en: e.deviceEn });
    });
    return [...m.values()];
  }, [serverEvents, catalog]);

  const all = useMemo(
    () => [...serverEvents, ...mockEvents(system, fromMs, toMs, now, acks)].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)),
    [serverEvents, system, fromMs, toMs, now, acks],
  );

  const groupName = (id: string) => {
    const g = catalog.groups.find((x) => x.id === id) ?? serverGroups.find((x) => x.id === id);
    return g ? (isEn ? g.en : g.th) : id;
  };

  /** ชุดฐาน: ช่วงเวลา + กลุ่ม + คำค้น (การ์ดสรุปคำนวณจากชุดนี้ และกดเพื่อกรองต่อได้) */
  const base = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return all.filter(
      (e) =>
        (group === 'all' || e.groupId === group) &&
        (!kw || [e.th, e.en, e.deviceTh, e.deviceEn, e.deviceName, e.metricName].some((x) => x.toLowerCase().includes(kw))),
    );
  }, [all, group, q]);

  const filtered = useMemo(
    () =>
      base.filter(
        (e) =>
          (severity === 'all' || e.severity === severity) &&
          (status === 'all' ||
            (status === 'active' && !e.endedAt) ||
            (status === 'ended' && !!e.endedAt) ||
            (status === 'unack' && !e.acknowledged) ||
            (status === 'ack' && e.acknowledged)),
      ),
    [base, severity, status],
  );

  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [group, severity, status, q, fromMs, toMs, pageSize]);

  const kpi = useMemo(() => {
    const ended = base.filter((e) => e.endedAt && e.durationSec !== null);
    return {
      total: base.length,
      active: base.filter((e) => !e.endedAt).length,
      critical: base.filter((e) => e.severity === 'critical').length,
      warning: base.filter((e) => e.severity === 'warning').length,
      unack: base.filter((e) => !e.acknowledged).length,
      mttr: ended.length ? Math.round(ended.reduce((a, e) => a + (e.durationSec ?? 0), 0) / ended.length) : null,
    };
  }, [base]);

  const groupCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of all) m.set(e.groupId, (m.get(e.groupId) ?? 0) + 1);
    return m;
  }, [all]);

  /* ---------- กราฟจำนวน alarm ตามเวลา ---------- */
  const chart = useMemo(() => {
    const hourly = toMs - fromMs <= 2 * 86_400_000;
    const unit = hourly ? 'hour' : 'day';
    const start = dayjs(fromMs).startOf(unit);
    const n = Math.max(1, Math.ceil(dayjs(toMs).startOf(unit).diff(start, unit, true)) + 1);
    const cats: string[] = [];
    const idx = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const d = start.add(i, unit);
      idx.set(d.format(hourly ? 'YYYY-MM-DD HH' : 'YYYY-MM-DD'), i);
      cats.push(d.format(hourly ? 'HH:00' : 'DD/MM'));
    }
    const sev: AlarmSeverity[] = ['critical', 'warning', 'info'];
    const data: Record<AlarmSeverity, number[]> = { critical: Array(n).fill(0), warning: Array(n).fill(0), info: Array(n).fill(0) };
    for (const e of filtered) {
      const i = idx.get(dayjs(e.startedAt).format(hourly ? 'YYYY-MM-DD HH' : 'YYYY-MM-DD'));
      if (i !== undefined) data[e.severity][i]++;
    }
    const series = sev.filter((s) => s !== 'info' || data.info.some(Boolean)).map((s) => ({ name: t(`utility_alarms.severity.${s}`), data: data[s], color: SEVERITY_STYLE[s].chart }));
    const options: ApexOptions = {
      chart: { type: 'bar', stacked: true, toolbar: { show: false }, fontFamily: 'inherit', background: 'transparent', animations: { enabled: false } },
      theme: { mode: theme === 'dark' ? 'dark' : 'light' },
      plotOptions: { bar: { columnWidth: n > 40 ? '80%' : '55%', borderRadius: 3, borderRadiusApplication: 'end', borderRadiusWhenStacked: 'last' } },
      dataLabels: { enabled: false },
      grid: { borderColor: theme === 'dark' ? '#1f2937' : '#f1f5f9', strokeDashArray: 4 },
      xaxis: { categories: cats, labels: { rotate: -45, hideOverlappingLabels: true, style: { fontSize: '11px' } }, tickAmount: Math.min(n, 15), axisTicks: { show: false } },
      yaxis: { labels: { formatter: (v) => String(Math.round(v)) }, forceNiceScale: true, min: 0 },
      legend: { position: 'top', horizontalAlign: 'right', fontSize: '12px' },
      tooltip: { shared: true, intersect: false },
    };
    return { series, options };
  }, [filtered, fromMs, toMs, theme, t]);

  const topSensors = useMemo(() => {
    const m = new Map<string, { e: UtilityAlarmEvent; n: number; crit: number }>();
    for (const e of filtered) {
      const cur = m.get(e.sensorKey) ?? { e, n: 0, crit: 0 };
      cur.n++;
      if (e.severity === 'critical') cur.crit++;
      m.set(e.sensorKey, cur);
    }
    return [...m.values()].sort((a, b) => b.n - a.n).slice(0, 6);
  }, [filtered]);

  /* ---------- ตาราง ---------- */
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const rows = filtered.slice((page - 1) * pageSize, page * pageSize);
  const selectable = rows.filter((e) => !e.acknowledged);

  const acknowledge = async (ids: string[]) => {
    if (!ids.length) return;
    if (ids.length > 1) {
      const res = await swal.confirm({ title: t('utility_alarms.report.ack_confirm_title'), message: t('utility_alarms.report.ack_confirm_text', { n: ids.length }) });
      if (!res.isConfirmed) return;
    }
    const real = ids.filter((id) => serverIds.has(id));
    const mock = ids.filter((id) => !serverIds.has(id));
    if (real.length) {
      try {
        const res = await ackUtilityAlarmEvents(real);
        const byId = new Map(res.items.map((e) => [e.id, e]));
        setServerEvents((list) => list.map((e) => byId.get(e.id) ?? e));
      } catch (e) {
        console.error('[utility-alarms] acknowledge failed:', e);
        const forbidden = (e as { response?: { status?: number } })?.response?.status === 403;
        swal.error({ message: t(forbidden ? 'utility_alarms.report.ack_forbidden' : 'utility_alarms.report.ack_failed') });
        return;
      }
    }
    if (mock.length) setAcks(saveAcks(mock, username));
    setSelected(new Set());
    swal.Toast({ message: t('utility_alarms.report.ack_done', { n: ids.length }) });
  };

  const exportCsv = () => {
    const head = ['started_at', 'ended_at', 'duration_sec', 'group', 'device', 'sensor', 'level', 'severity', 'value', 'limit', 'unit', 'acknowledged', 'ack_by', 'ack_at'];
    const lines = filtered.map((e) =>
      [
        dayjs(e.startedAt).format('YYYY-MM-DD HH:mm:ss'),
        e.endedAt ? dayjs(e.endedAt).format('YYYY-MM-DD HH:mm:ss') : '',
        e.durationSec,
        groupName(e.groupId),
        isEn ? e.deviceEn : e.deviceTh,
        isEn ? e.en : e.th,
        e.level,
        e.severity,
        e.value,
        e.limit,
        e.unit,
        e.acknowledged ? 'yes' : 'no',
        e.ackBy,
        e.ackAt ? dayjs(e.ackAt).format('YYYY-MM-DD HH:mm:ss') : '',
      ]
        .map(csvField)
        .join(','),
    );
    downloadCsv([head.join(','), ...lines].join('\n'), `${system}_alarms_${dayjs(fromMs).format('YYYYMMDD')}-${dayjs(toMs).format('YYYYMMDD')}.csv`, { dated: false });
  };

  const resetFilters = () => {
    setGroup('all');
    setSeverity('all');
    setStatus('all');
    setQ('');
  };

  const kpiCards: { key: string; label: string; value: string | number; icon: React.ReactNode; tone: string; active: boolean; onClick?: () => void }[] = [
    { key: 'total', label: t('utility_alarms.report.kpi.total'), value: kpi.total, icon: <Bell className="size-5" />, tone: 'text-brand-600 bg-brand-50 dark:text-brand-400 dark:bg-brand-500/10', active: severity === 'all' && status === 'all', onClick: () => { setSeverity('all'); setStatus('all'); } },
    { key: 'active', label: t('utility_alarms.report.kpi.active'), value: kpi.active, icon: <BellRing className={`size-5 ${kpi.active ? 'animate-pulse' : ''}`} />, tone: 'text-error-600 bg-error-50 dark:text-error-400 dark:bg-error-500/10', active: status === 'active', onClick: () => setStatus(status === 'active' ? 'all' : 'active') },
    { key: 'critical', label: t('utility_alarms.report.kpi.critical'), value: kpi.critical, icon: <ShieldAlert className="size-5" />, tone: 'text-error-600 bg-error-50 dark:text-error-400 dark:bg-error-500/10', active: severity === 'critical', onClick: () => setSeverity(severity === 'critical' ? 'all' : 'critical') },
    { key: 'warning', label: t('utility_alarms.report.kpi.warning'), value: kpi.warning, icon: <TriangleAlert className="size-5" />, tone: 'text-warning-600 bg-warning-50 dark:text-warning-400 dark:bg-warning-500/10', active: severity === 'warning', onClick: () => setSeverity(severity === 'warning' ? 'all' : 'warning') },
    { key: 'unack', label: t('utility_alarms.report.kpi.unack'), value: kpi.unack, icon: <CheckCheck className="size-5" />, tone: 'text-orange-600 bg-orange-50 dark:text-orange-400 dark:bg-orange-500/10', active: status === 'unack', onClick: () => setStatus(status === 'unack' ? 'all' : 'unack') },
    { key: 'mttr', label: t('utility_alarms.report.kpi.mttr'), value: fmtDur(kpi.mttr), icon: <Timer className="size-5" />, tone: 'text-gray-600 bg-gray-100 dark:text-gray-300 dark:bg-white/5', active: false },
  ];

  const presetBtn = (p: RangePreset) => (
    <button
      key={p}
      type="button"
      onClick={() => setPreset(p)}
      className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${preset === p ? 'bg-white text-gray-900 shadow-theme-xs dark:bg-gray-800 dark:text-white' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white'}`}
    >
      {t(`utility_alarms.report.range.${p}`)}
    </button>
  );

  return (
    <div className="space-y-5">
      {serverError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          {t('utility_alarms.report.server_events_failed')}
        </div>
      )}
      {/* ---------- แถบตัวกรอง ---------- */}
      <div className={`${card} p-4`}>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <p className="mb-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">{t('utility_alarms.report.range.label')}</p>
            <div className="inline-flex rounded-lg bg-gray-100 p-0.5 dark:bg-gray-900">{(['24h', '7d', '30d', 'custom'] as RangePreset[]).map(presetBtn)}</div>
          </div>
          {preset === 'custom' && (
            <div className="flex items-end gap-2">
              <label className="text-xs text-gray-500 dark:text-gray-400">
                <span className="mb-1.5 block font-medium">{t('utility_alarms.report.from')}</span>
                <input type="date" className={`${inputCls} w-40`} value={fromDate} max={toDate} onChange={(e) => setFromDate(e.target.value)} />
              </label>
              <label className="text-xs text-gray-500 dark:text-gray-400">
                <span className="mb-1.5 block font-medium">{t('utility_alarms.report.to')}</span>
                <input type="date" className={`${inputCls} w-40`} value={toDate} min={fromDate} max={dayjs().format('YYYY-MM-DD')} onChange={(e) => setToDate(e.target.value)} />
              </label>
            </div>
          )}
          <label className="text-xs text-gray-500 dark:text-gray-400">
            <span className="mb-1.5 block font-medium">{t('utility_alarms.report.severity')}</span>
            <select className={`${inputCls} w-36`} value={severity} onChange={(e) => setSeverity(e.target.value as 'all' | AlarmSeverity)}>
              <option value="all">{t('utility_alarms.report.all')}</option>
              {(['critical', 'warning', 'info'] as AlarmSeverity[]).map((s) => (
                <option key={s} value={s}>{t(`utility_alarms.severity.${s}`)}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-gray-500 dark:text-gray-400">
            <span className="mb-1.5 block font-medium">{t('utility_alarms.report.status')}</span>
            <select className={`${inputCls} w-40`} value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
              {(['all', 'active', 'ended', 'unack', 'ack'] as StatusFilter[]).map((s) => (
                <option key={s} value={s}>{t(`utility_alarms.report.status_opt.${s}`)}</option>
              ))}
            </select>
          </label>
          <label className="min-w-48 flex-1 text-xs text-gray-500 dark:text-gray-400">
            <span className="mb-1.5 block font-medium">{t('utility_alarms.report.search')}</span>
            <span className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
              <input className={`${inputCls} pl-9`} value={q} placeholder={t('utility_alarms.report.search_ph')} onChange={(e) => setQ(e.target.value)} />
            </span>
          </label>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={resetFilters} title={t('utility_alarms.report.reset')} className="inline-flex h-9 items-center rounded-lg border border-gray-300 px-3 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5">
              <RotateCcw className="size-4" />
            </button>
            <button type="button" onClick={exportCsv} disabled={!filtered.length} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-300 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5">
              <Download className="size-4" /> CSV
            </button>
            <Link to={meta.settingsPath} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-500 px-3 text-sm font-medium text-white hover:bg-brand-600">
              <Settings2 className="size-4" /> {t('utility_alarms.report.go_settings')}
            </Link>
          </div>
        </div>

        {/* กลุ่มเซนเซอร์ */}
        <div className="mt-4 flex flex-wrap gap-2 border-t border-gray-100 pt-3 dark:border-gray-800">
          {[{ id: 'all', th: t('utility_alarms.report.all_groups'), en: t('utility_alarms.report.all_groups') }, ...catalog.groups, ...serverGroups].map((g) => {
            const n = g.id === 'all' ? all.length : (groupCounts.get(g.id) ?? 0);
            const on = group === g.id;
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => setGroup(g.id)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${on ? 'border-brand-500 bg-brand-500 text-white' : 'border-gray-200 text-gray-600 hover:border-brand-300 dark:border-gray-700 dark:text-gray-300'}`}
              >
                {isEn ? g.en : g.th}
                <span className={`rounded-full px-1.5 text-[10px] ${on ? 'bg-white/25' : 'bg-gray-100 dark:bg-white/10'}`}>{n}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ---------- KPI ---------- */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {kpiCards.map((c) => (
          <button
            key={c.key}
            type="button"
            disabled={!c.onClick}
            onClick={c.onClick}
            className={`${card} flex items-center gap-3 p-4 text-left transition ${c.onClick ? 'hover:border-brand-300 dark:hover:border-brand-500/50' : 'cursor-default'} ${c.active && c.key !== 'total' ? 'ring-2 ring-brand-500/60' : ''}`}
          >
            <span className={`rounded-xl p-2.5 ${c.tone}`}>{c.icon}</span>
            <span className="min-w-0">
              <span className="block truncate text-xs text-gray-500 dark:text-gray-400">{c.label}</span>
              <span className="block text-xl font-bold text-gray-800 dark:text-white/90">{c.value}</span>
            </span>
          </button>
        ))}
      </div>

      {/* ---------- กราฟ + เซนเซอร์ที่แจ้งเตือนบ่อย ---------- */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className={`${card} p-5 xl:col-span-2`}>
          <h3 className="text-base font-semibold text-gray-800 dark:text-white/90">{t('utility_alarms.report.chart_title')}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">{t('utility_alarms.report.chart_sub')}</p>
          <div className="-ml-2 mt-2">
            <Chart key={theme} type="bar" height={260} series={chart.series} options={chart.options} />
          </div>
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-base font-semibold text-gray-800 dark:text-white/90">{t('utility_alarms.report.top_title')}</h3>
          <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">{t('utility_alarms.report.top_sub')}</p>
          {topSensors.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-400">{t('utility_alarms.report.empty')}</p>
          ) : (
            <ul className="space-y-3.5">
              {topSensors.map(({ e, n, crit }) => (
                <li key={e.sensorKey}>
                  <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate">
                      <span className="font-medium text-gray-800 dark:text-white/90">{isEn ? e.en : e.th}</span>
                      <span className="ml-1.5 text-xs text-gray-500 dark:text-gray-400">{isEn ? e.deviceEn : e.deviceTh}</span>
                    </span>
                    <span className="shrink-0 font-semibold text-gray-700 dark:text-gray-300">{n}</span>
                  </div>
                  <div className="flex h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-white/5">
                    <div className="bg-error-500" style={{ width: `${(crit / topSensors[0].n) * 100}%` }} />
                    <div className="bg-warning-400" style={{ width: `${((n - crit) / topSensors[0].n) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ---------- ตารางเหตุการณ์ ---------- */}
      <div className={`${card} overflow-hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-5 py-3.5 dark:border-gray-800">
          <h3 className="flex items-center gap-2 text-base font-semibold text-gray-800 dark:text-white/90">
            <span className={meta.accent}>{meta.icon}</span>
            {t('utility_alarms.report.table_title', { n: filtered.length.toLocaleString() })}
          </h3>
          {selected.size > 0 && (
            <button type="button" onClick={() => acknowledge([...selected])} className="inline-flex items-center gap-1.5 rounded-lg bg-warning-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-warning-600">
              <CheckCheck className="size-4" /> {t('utility_alarms.report.ack_selected', { n: selected.size })}
            </button>
          )}
        </div>
        <div className="custom-scrollbar max-w-full overflow-x-auto">
          <table className="w-full min-w-[1080px] text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold text-gray-500 dark:bg-white/[0.02] dark:text-gray-400">
              <tr>
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    className="size-4 accent-brand-500"
                    disabled={!selectable.length}
                    checked={selectable.length > 0 && selectable.every((e) => selected.has(e.id))}
                    onChange={(ev) => setSelected(ev.target.checked ? new Set(selectable.map((e) => e.id)) : new Set())}
                  />
                </th>
                <th className="px-3 py-3">{t('utility_alarms.report.col.start')}</th>
                <th className="px-3 py-3">{t('utility_alarms.report.col.sensor')}</th>
                <th className="px-3 py-3">{t('utility_alarms.report.col.group')}</th>
                <th className="px-3 py-3">{t('utility_alarms.report.col.level')}</th>
                <th className="px-3 py-3 text-right">{t('utility_alarms.report.col.value')}</th>
                <th className="px-3 py-3">{t('utility_alarms.report.col.end')}</th>
                <th className="px-3 py-3">{t('utility_alarms.report.col.duration')}</th>
                <th className="px-3 py-3 text-center">{t('utility_alarms.report.col.ack')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {rows.map((e) => (
                <tr key={e.id} className={`transition-colors hover:bg-gray-50/80 dark:hover:bg-white/[0.02] ${!e.endedAt ? 'bg-error-50/40 dark:bg-error-500/[0.04]' : ''}`}>
                  <td className="px-4 py-3">
                    {!e.acknowledged && (
                      <input
                        type="checkbox"
                        className="size-4 accent-brand-500"
                        checked={selected.has(e.id)}
                        onChange={(ev) => {
                          const next = new Set(selected);
                          if (ev.target.checked) next.add(e.id);
                          else next.delete(e.id);
                          setSelected(next);
                        }}
                      />
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-gray-600 dark:text-gray-400">{dayjs(e.startedAt).format('DD/MM/YYYY HH:mm')}</td>
                  <td className="px-3 py-3">
                    <span className="block font-medium text-gray-800 dark:text-white/90">{isEn ? e.en : e.th}</span>
                    <span className="block text-xs text-gray-500 dark:text-gray-400">{isEn ? e.deviceEn : e.deviceTh}</span>
                  </td>
                  <td className="px-3 py-3 text-xs text-gray-600 dark:text-gray-400">{groupName(e.groupId)}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <LevelBadge level={e.level} />
                      <SeverityPill severity={e.severity} />
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-xs">
                    {e.value !== null ? (
                      <>
                        <span className="font-bold text-gray-800 dark:text-white/90">{fmtNum(e.value, e.dp)}</span>
                        {e.limit !== null && <span className="text-gray-400"> / {fmtNum(e.limit, e.dp)}</span>}
                        {e.unit && <span className="ml-1 text-gray-500">{e.unit}</span>}
                      </>
                    ) : (
                      <span className="text-gray-400">–</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-xs">
                    {e.endedAt ? (
                      <span className="font-mono text-gray-600 dark:text-gray-400">{dayjs(e.endedAt).format('DD/MM/YYYY HH:mm')}</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-error-100 px-2 py-0.5 text-[11px] font-semibold text-error-700 dark:bg-error-500/20 dark:text-error-300">
                        <span className="size-1.5 animate-pulse rounded-full bg-error-500" /> {t('utility_alarms.report.active_badge')}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-gray-600 dark:text-gray-400">{fmtDur(e.durationSec)}</td>
                  <td className="px-3 py-3 text-center">
                    {e.acknowledged ? (
                      <span className="inline-flex flex-col items-center text-[11px] text-success-600 dark:text-success-400" title={e.ackAt ? dayjs(e.ackAt).format('DD/MM/YYYY HH:mm') : ''}>
                        <CircleCheck className="size-4" />
                        {e.ackBy}
                      </span>
                    ) : (
                      <button type="button" onClick={() => acknowledge([e.id])} className="rounded-md bg-warning-50 px-2.5 py-1 text-xs font-semibold text-warning-700 ring-1 ring-inset ring-warning-200 hover:bg-warning-100 dark:bg-warning-500/10 dark:text-warning-400 dark:ring-warning-500/30">
                        {t('utility_alarms.report.ack')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-5 py-14 text-center">
                    <Bell className="mx-auto mb-2 size-10 text-gray-300 dark:text-gray-700" />
                    <p className="font-medium text-gray-600 dark:text-gray-300">{t('utility_alarms.report.empty')}</p>
                    <p className="text-xs text-gray-400">{t('utility_alarms.report.empty_sub')}</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-5 py-3 text-sm dark:border-gray-800">
          <label className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            {t('utility_alarms.report.rows')}
            <select className={`${inputCls} !h-8 w-20`} value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-1">
            <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-md px-3 py-1.5 text-gray-600 hover:bg-gray-100 disabled:opacity-40 dark:text-gray-300 dark:hover:bg-white/5">‹</button>
            <span className="px-2 text-xs text-gray-500 dark:text-gray-400">{t('utility_alarms.report.page_of', { p: page, n: pages })}</span>
            <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} className="rounded-md px-3 py-1.5 text-gray-600 hover:bg-gray-100 disabled:opacity-40 dark:text-gray-300 dark:hover:bg-white/5">›</button>
          </div>
        </div>
      </div>
    </div>
  );
}

