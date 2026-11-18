import { useEffect, useMemo, useState } from 'react';
import { useNow } from '@/hooks/useNow';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { BellRing, ChevronDown, Info, Lock, Mail, MessageCircle, Monitor, RotateCcw, Save, Search, SlidersHorizontal, FileText, Moon } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import useSwalAlert from '@/hooks/useSwalAlert';
import { useAuthStore } from '@/store/auth';
import { isAdminRole } from '@/store/factorySensorSettings';
import {
  DEFAULT_TARGETS,
  defaultRules,
  evaluate,
  getCatalog,
  invalidLimits,
  loadRules,
  loadTargets,
  saveRules,
  saveTargets,
  type AlarmGroupDef,
  type AlarmRule,
  type AlarmSensorDef,
  type AlarmSeverity,
  type NotifyTargets,
  type RuleMap,
  type UtilitySystem,
} from '@/lib/utilityAlarms';
import { LevelBadge, SeverityPill, Toggle } from '@/components/common/utility-alarms/shared';
import { SYSTEM_META, card, fmtNum, groupIcon, inputCls } from '@/components/common/utility-alarms/meta';

type LimitKey = 'll' | 'l' | 'h' | 'hh';
const LIMIT_KEYS: LimitKey[] = ['ll', 'l', 'h', 'hh'];
type ChannelKey = 'notifyWeb' | 'notifyLine' | 'notifyEmail';
const CHANNELS: { key: ChannelKey; icon: React.ReactNode }[] = [
  { key: 'notifyWeb', icon: <Monitor className="size-3.5" /> },
  { key: 'notifyLine', icon: <MessageCircle className="size-3.5" /> },
  { key: 'notifyEmail', icon: <Mail className="size-3.5" /> },
];

/** ช่องกรอกตัวเลขที่พิมพ์ค่าชั่วคราวได้ (เช่น "-" หรือ "0.") โดยไม่ถูกเขียนทับ · ว่าง = ไม่ใช้ขีดนี้ */
function NumInput({ value, onChange, disabled, invalid, step, className = '', placeholder = '—' }: {
  value: number | null; onChange: (v: number | null) => void; disabled?: boolean; invalid?: boolean; step?: number; className?: string; placeholder?: string;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    if (!focus) setText(value === null ? '' : String(value));
  }, [value, focus]);
  return (
    <input
      type="number"
      inputMode="decimal"
      step={step}
      value={text}
      disabled={disabled}
      placeholder={placeholder}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      onChange={(e) => {
        const s = e.target.value;
        setText(s);
        if (s.trim() === '') onChange(null);
        else if (!Number.isNaN(Number(s))) onChange(Number(s));
      }}
      className={`h-8 w-full rounded-md border bg-transparent px-2 text-right font-mono text-xs text-gray-800 focus:outline-hidden focus:ring-2 focus:ring-brand-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-900 dark:text-white/90 ${invalid ? 'border-error-500 ring-2 ring-error-500/20' : 'border-gray-300 dark:border-gray-700'} ${className}`}
    />
  );
}

export default function UtilityAlarmSettings({ system }: { system: UtilitySystem }) {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === 'en';
  const swal = useSwalAlert();
  const role = useAuthStore((s) => s.role);
  const canEdit = isAdminRole(role);
  const catalog = useMemo(() => getCatalog(system), [system]);
  const meta = SYSTEM_META[system];

  const [rules, setRules] = useState<RuleMap>(() => defaultRules(system));
  const [saved, setSaved] = useState(() => JSON.stringify(defaultRules(system)));
  const [targets, setTargets] = useState<NotifyTargets>(DEFAULT_TARGETS);
  const [savedTargets, setSavedTargets] = useState(() => JSON.stringify(DEFAULT_TARGETS));
  // โหลดจาก backend — ยังไม่สำเร็จ = ห้ามบันทึก (กันการเขียนค่าตั้งต้นทับค่าจริงบนเซิร์ฟเวอร์)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [saving, setSaving] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const editable = canEdit && loadState === 'ready';
  useEffect(() => {
    let alive = true;
    setLoadState('loading');
    Promise.all([loadRules(system, canEdit), loadTargets(system, canEdit)])
      .then(([r, tg]) => {
        if (!alive) return;
        setRules(r);
        setSaved(JSON.stringify(r));
        setTargets(tg);
        setSavedTargets(JSON.stringify(tg));
        setLoadState('ready');
      })
      .catch((e) => {
        console.error('[utility-alarms] load settings failed:', e);
        if (alive) setLoadState('error');
      });
    return () => {
      alive = false;
    };
  }, [system, canEdit, reloadTick]);
  const [open, setOpen] = useState<Set<string>>(() => new Set(catalog.groups.slice(0, 1).map((g) => g.id)));
  const [q, setQ] = useState('');
  const [onlyAlarm, setOnlyAlarm] = useState(false);
  const [advKey, setAdvKey] = useState<string | null>(null);
  const now = useNow(5000);


  const dirty = JSON.stringify(rules) !== saved || JSON.stringify(targets) !== savedTargets;
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const live = useMemo(() => {
    const m = new Map<string, { v: number | null; state: ReturnType<typeof evaluate> }>();
    for (const s of catalog.sensors) {
      const v = s.read ? s.read(now) : null;
      m.set(s.key, { v, state: evaluate(s, rules[s.key], v) });
    }
    return m;
  }, [catalog, rules, now]);

  const errors = useMemo(() => {
    const m = new Map<string, LimitKey[]>();
    for (const s of catalog.sensors) {
      const r = rules[s.key];
      if (s.kind !== 'analog' || !r.enabled) continue;
      const bad = invalidLimits(r);
      if (bad.length) m.set(s.key, bad);
    }
    return m;
  }, [catalog, rules]);

  const update = (key: string, patch: Partial<AlarmRule>) => setRules((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  const updateMany = (keys: string[], patch: Partial<AlarmRule>) =>
    setRules((prev) => {
      const next = { ...prev };
      for (const k of keys) next[k] = { ...next[k], ...patch };
      return next;
    });

  const name = (s: { th: string; en: string }) => (isEn ? s.en : s.th);
  const kw = q.trim().toLowerCase();
  const visible = (s: AlarmSensorDef) =>
    (!kw || [s.th, s.en, s.deviceTh, s.deviceEn, s.deviceName, s.metricName].some((x) => x.toLowerCase().includes(kw))) &&
    (!onlyAlarm || !!live.get(s.key)?.state.level);

  const stats = useMemo(() => {
    const enabled = catalog.sensors.filter((s) => rules[s.key].enabled).length;
    const alarming = [...live.values()].filter((x) => x.state.level).length;
    return { groups: catalog.groups.length, sensors: catalog.sensors.length, enabled, alarming };
  }, [catalog, rules, live]);

  const onSave = () => {
    if (errors.size) {
      const first = catalog.sensors.find((s) => errors.has(s.key))!;
      setOpen((o) => new Set(o).add(first.groupId));
      swal.error({ title: t('utility_alarms.settings.invalid_title'), message: t('utility_alarms.settings.invalid_text', { n: errors.size, name: `${name({ th: first.deviceTh, en: first.deviceEn })} · ${name(first)}` }) });
      return;
    }
    if (loadState !== 'ready' || saving) return;
    setSaving(true);
    Promise.all([saveRules(system, rules), saveTargets(system, targets)])
      .then(() => {
        setSaved(JSON.stringify(rules));
        setSavedTargets(JSON.stringify(targets));
        swal.Toast({ message: t('utility_alarms.settings.saved') });
      })
      .catch((e) => {
        console.error('[utility-alarms] save settings failed:', e);
        swal.error({ message: t('utility_alarms.settings.save_failed') });
      })
      .finally(() => setSaving(false));
  };
  const onDiscard = () => {
    setRules(JSON.parse(saved) as RuleMap);
    setTargets(JSON.parse(savedTargets) as NotifyTargets);
  };
  const onResetDefaults = async () => {
    const r = await swal.confirm({ title: t('utility_alarms.settings.reset_title'), message: t('utility_alarms.settings.reset_text') });
    if (r.isConfirmed) setRules(defaultRules(system));
  };

  const advSensor = advKey ? catalog.sensors.find((s) => s.key === advKey) : undefined;

  return (
    <div className="space-y-5 pb-20">
      {!canEdit && (
        <div className="flex items-center gap-2.5 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-300">
          <Lock className="size-4 shrink-0" /> {t('utility_alarms.settings.readonly')}
        </div>
      )}
      {loadState === 'error' && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          <span>{t('utility_alarms.settings.load_failed')}</span>
          <button type="button" className="rounded-lg bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700" onClick={() => setReloadTick((n) => n + 1)}>
            {t('water_systems.retry')}
          </button>
        </div>
      )}

      {/* ---------- สรุป + คำอธิบายระดับ ---------- */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { k: 'groups', v: stats.groups },
          { k: 'sensors', v: stats.sensors },
          { k: 'enabled', v: `${stats.enabled}/${stats.sensors}` },
          { k: 'alarming', v: stats.alarming, tone: stats.alarming ? 'text-error-600 dark:text-error-400' : '' },
        ].map((c) => (
          <div key={c.k} className={`${card} p-4`}>
            <p className="text-xs text-gray-500 dark:text-gray-400">{t(`utility_alarms.settings.stat.${c.k}`)}</p>
            <p className={`mt-1 text-xl font-bold text-gray-800 dark:text-white/90 ${c.tone ?? ''}`}>{c.v}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
        {/* คำอธิบาย */}
        <div className={`${card} p-5 xl:col-span-2`}>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-white/90">
            <Info className="size-4 text-brand-500" /> {t('utility_alarms.settings.legend_title')}
          </h3>
          <ul className="space-y-2.5 text-xs text-gray-600 dark:text-gray-400">
            <li className="flex items-center gap-2"><LevelBadge level="HH" /><LevelBadge level="LL" /> <SeverityPill severity="critical" /> {t('utility_alarms.settings.legend_hhll')}</li>
            <li className="flex items-center gap-2"><LevelBadge level="H" /><LevelBadge level="L" /> <SeverityPill severity="warning" /> {t('utility_alarms.settings.legend_hl')}</li>
            <li className="flex items-center gap-2"><LevelBadge level="STATE" /><LevelBadge level="COMM" /> {t('utility_alarms.settings.legend_state')}</li>
            <li className="leading-relaxed text-gray-500">{t('utility_alarms.settings.legend_note')}</li>
          </ul>
        </div>

        {/* ผู้รับการแจ้งเตือน */}
        <div className={`${card} p-5 xl:col-span-3`}>
          <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-white/90">
            <BellRing className="size-4 text-brand-500" /> {t('utility_alarms.settings.targets_title')}
          </h3>
          <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">{t('utility_alarms.settings.targets_sub')}</p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
              <span className="mb-1.5 flex items-center gap-1.5"><Mail className="size-3.5" /> {t('utility_alarms.settings.emails')}</span>
              <input className={inputCls} disabled={!editable} value={targets.emails} placeholder="utility@company.com, eng@company.com" onChange={(e) => setTargets({ ...targets, emails: e.target.value })} />
            </label>
            <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
              <span className="mb-1.5 flex items-center gap-1.5"><MessageCircle className="size-3.5" /> {t('utility_alarms.settings.line')}</span>
              <input className={inputCls} disabled={!editable} value={targets.lineTarget} placeholder={t('utility_alarms.settings.line_ph')} onChange={(e) => setTargets({ ...targets, lineTarget: e.target.value })} />
            </label>
            <div className="text-xs font-medium text-gray-600 dark:text-gray-400">
              <span className="mb-1.5 flex items-center gap-1.5"><Moon className="size-3.5" /> {t('utility_alarms.settings.quiet')}</span>
              <div className="flex items-center gap-2">
                <input type="time" className={inputCls} disabled={!editable} value={targets.quietStart} onChange={(e) => setTargets({ ...targets, quietStart: e.target.value })} />
                <span>–</span>
                <input type="time" className={inputCls} disabled={!editable} value={targets.quietEnd} onChange={(e) => setTargets({ ...targets, quietEnd: e.target.value })} />
              </div>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2.5 pb-2 text-xs text-gray-600 dark:text-gray-400">
                <Toggle checked={targets.criticalIgnoresQuiet} disabled={!editable} onChange={(v) => setTargets({ ...targets, criticalIgnoresQuiet: v })} />
                {t('utility_alarms.settings.critical_ignores_quiet')}
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* ---------- เครื่องมือ ---------- */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
          <input className={`${inputCls} pl-9`} value={q} placeholder={t('utility_alarms.settings.search_ph')} onChange={(e) => setQ(e.target.value)} />
        </span>
        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          <Toggle checked={onlyAlarm} onChange={setOnlyAlarm} size="sm" /> {t('utility_alarms.settings.only_alarm')}
        </label>
        <button type="button" onClick={() => setOpen(open.size === catalog.groups.length ? new Set() : new Set(catalog.groups.map((g) => g.id)))} className="h-9 rounded-lg border border-gray-300 px-3 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5">
          {open.size === catalog.groups.length ? t('utility_alarms.settings.collapse_all') : t('utility_alarms.settings.expand_all')}
        </button>
        <Link to={meta.alarmsPath} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-300 px-3 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5">
          <FileText className="size-4" /> {t('utility_alarms.settings.go_report')}
        </Link>
        {editable && (
          <button type="button" onClick={onResetDefaults} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-300 px-3 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5">
            <RotateCcw className="size-4" /> {t('utility_alarms.settings.reset_defaults')}
          </button>
        )}
      </div>

      {/* ---------- กลุ่มเซนเซอร์ ---------- */}
      {catalog.groups.map((g) => {
        const sensors = catalog.sensors.filter((s) => s.groupId === g.id);
        const shown = sensors.filter(visible);
        if ((kw || onlyAlarm) && !shown.length) return null;
        return (
          <GroupCard
            key={g.id}
            group={g}
            sensors={sensors}
            shown={shown}
            rules={rules}
            live={live}
            errors={errors}
            isOpen={open.has(g.id) || !!kw || onlyAlarm}
            canEdit={editable}
            isEn={isEn}
            onToggleOpen={() => {
              const n = new Set(open);
              if (n.has(g.id)) n.delete(g.id);
              else n.add(g.id);
              setOpen(n);
            }}
            update={update}
            updateMany={updateMany}
            onAdvanced={setAdvKey}
          />
        );
      })}

      {/* ---------- แถบบันทึก ---------- */}
      {editable && dirty && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-gray-800 dark:bg-gray-900/95 lg:left-auto lg:right-6 lg:bottom-6 lg:rounded-2xl lg:border lg:shadow-theme-lg">
          <div className="flex items-center justify-end gap-3">
            <span className="mr-auto text-sm text-gray-600 dark:text-gray-300 lg:mr-4">
              {errors.size ? <span className="text-error-600 dark:text-error-400">{t('utility_alarms.settings.has_errors', { n: errors.size })}</span> : t('utility_alarms.settings.unsaved')}
            </span>
            <button type="button" onClick={onDiscard} className="h-9 rounded-lg border border-gray-300 px-4 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5">
              {t('utility_alarms.settings.discard')}
            </button>
            <button type="button" onClick={onSave} disabled={saving} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-500 px-4 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60">
              <Save className="size-4" /> {t('utility_alarms.settings.save')}
            </button>
          </div>
        </div>
      )}

      {/* ---------- ตั้งค่าขั้นสูง ---------- */}
      <Modal isOpen={!!advSensor} onClose={() => setAdvKey(null)} size="md" className="p-6">
        {advSensor && (
          <AdvancedForm sensor={advSensor} rule={rules[advSensor.key]} canEdit={editable} isEn={isEn} onChange={(p) => update(advSensor.key, p)} onClose={() => setAdvKey(null)} />
        )}
      </Modal>
    </div>
  );
}

/* ====================================================================== */
/* การ์ดกลุ่ม                                                              */
/* ====================================================================== */
function GroupCard({ group, sensors, shown, rules, live, errors, isOpen, canEdit, isEn, onToggleOpen, update, updateMany, onAdvanced }: {
  group: AlarmGroupDef;
  sensors: AlarmSensorDef[];
  shown: AlarmSensorDef[];
  rules: RuleMap;
  live: Map<string, { v: number | null; state: ReturnType<typeof evaluate> }>;
  errors: Map<string, LimitKey[]>;
  isOpen: boolean;
  canEdit: boolean;
  isEn: boolean;
  onToggleOpen: () => void;
  update: (key: string, patch: Partial<AlarmRule>) => void;
  updateMany: (keys: string[], patch: Partial<AlarmRule>) => void;
  onAdvanced: (key: string) => void;
}) {
  const { t } = useTranslation();
  const keys = sensors.map((s) => s.key);
  const enabled = sensors.filter((s) => rules[s.key].enabled).length;
  const alarming = sensors.filter((s) => live.get(s.key)?.state.level).length;
  const groupErr = sensors.some((s) => errors.has(s.key));
  const allOn = (c: ChannelKey) => sensors.every((s) => rules[s.key][c]);

  return (
    <div className={`${card} overflow-hidden ${groupErr ? 'border-error-300 dark:border-error-500/40' : ''}`}>
      <div className="flex flex-wrap items-center gap-3 px-5 py-4">
        <button type="button" onClick={onToggleOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <span className="rounded-xl bg-brand-50 p-2.5 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400">{groupIcon(group)}</span>
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-gray-800 dark:text-white/90">{isEn ? group.en : group.th}</span>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600 dark:bg-white/10 dark:text-gray-300">
                {t('utility_alarms.settings.enabled_of', { a: enabled, b: sensors.length })}
              </span>
              {alarming > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-error-50 px-2 py-0.5 text-[11px] font-semibold text-error-600 dark:bg-error-500/15 dark:text-error-400">
                  <span className="size-1.5 animate-pulse rounded-full bg-error-500" /> {t('utility_alarms.settings.alarming_n', { n: alarming })}
                </span>
              )}
            </span>
            <span className="block truncate text-xs text-gray-500 dark:text-gray-400">{isEn ? group.descEn : group.descTh}</span>
          </span>
        </button>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-0.5 dark:bg-white/5" title={t('utility_alarms.settings.group_channels')}>
            {CHANNELS.map((c) => {
              const on = allOn(c.key);
              return (
                <button
                  key={c.key}
                  type="button"
                  disabled={!canEdit}
                  title={t(`utility_alarms.channel.${c.key}`)}
                  onClick={() => updateMany(keys, { [c.key]: !on })}
                  className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition disabled:cursor-not-allowed ${on ? 'bg-white text-brand-600 shadow-theme-xs dark:bg-gray-800 dark:text-brand-400' : 'text-gray-400'}`}
                >
                  {c.icon}
                  <span className="hidden sm:inline">{t(`utility_alarms.channel_short.${c.key}`)}</span>
                </button>
              );
            })}
          </div>
          <Toggle checked={enabled === sensors.length} disabled={!canEdit} title={t('utility_alarms.settings.group_toggle')} onChange={(v) => updateMany(keys, { enabled: v })} />
          <button type="button" onClick={onToggleOpen} className="rounded-md p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5">
            <ChevronDown className={`size-5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="custom-scrollbar overflow-x-auto border-t border-gray-100 dark:border-gray-800">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-gray-50 text-xs font-semibold text-gray-500 dark:bg-white/[0.02] dark:text-gray-400">
              <tr>
                <th className="w-14 px-4 py-2.5 text-left">{t('utility_alarms.settings.col.on')}</th>
                <th className="px-3 py-2.5 text-left">{t('utility_alarms.settings.col.sensor')}</th>
                <th className="w-32 px-3 py-2.5 text-right">{t('utility_alarms.settings.col.now')}</th>
                <th className="w-24 px-2 py-2.5 text-center text-error-600 dark:text-error-400">LL</th>
                <th className="w-24 px-2 py-2.5 text-center text-warning-600 dark:text-warning-400">L</th>
                <th className="w-24 px-2 py-2.5 text-center text-warning-600 dark:text-warning-400">H</th>
                <th className="w-24 px-2 py-2.5 text-center text-error-600 dark:text-error-400">HH</th>
                <th className="w-24 px-2 py-2.5 text-center">{t('utility_alarms.settings.col.delay')}</th>
                <th className="w-32 px-2 py-2.5 text-center">{t('utility_alarms.settings.col.channels')}</th>
                <th className="w-12 px-2 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {shown.map((s) => {
                const r = rules[s.key];
                const lv = live.get(s.key);
                const bad = errors.get(s.key) ?? [];
                const step = 10 ** -Math.max(s.dp, 0);
                const dis = !canEdit || !r.enabled;
                return (
                  <tr key={s.key} className={`${!r.enabled ? 'opacity-60' : ''} ${lv?.state.severity === 'critical' ? 'bg-error-50/50 dark:bg-error-500/[0.05]' : lv?.state.severity === 'warning' ? 'bg-warning-50/50 dark:bg-warning-500/[0.05]' : ''}`}>
                    <td className="px-4 py-2.5">
                      <Toggle size="sm" checked={r.enabled} disabled={!canEdit} onChange={(v) => update(s.key, { enabled: v })} />
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="block font-medium text-gray-800 dark:text-white/90">
                        {isEn ? s.en : s.th}
                        {s.unit && <span className="ml-1 text-xs font-normal text-gray-400">({s.unit})</span>}
                      </span>
                      <span className="block text-xs text-gray-500 dark:text-gray-400">{isEn ? s.deviceEn : s.deviceTh}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className="inline-flex items-center justify-end gap-1.5">
                        {lv?.state.level && <LevelBadge level={lv.state.level} />}
                        {s.kind === 'digital' ? (
                          <span className="text-xs text-success-600 dark:text-success-400">{lv?.state.level ? (isEn ? s.stateEn : s.stateTh) : t('utility_alarms.settings.normal')}</span>
                        ) : (
                          <span className="font-mono text-xs font-semibold text-gray-700 dark:text-gray-200">{fmtNum(lv?.v, s.dp)}</span>
                        )}
                      </span>
                    </td>
                    {s.kind === 'analog' ? (
                      LIMIT_KEYS.map((k) => (
                        <td key={k} className="px-2 py-2.5">
                          <NumInput value={r[k]} step={step} disabled={dis} invalid={bad.includes(k)} onChange={(v) => update(s.key, { [k]: v })} />
                        </td>
                      ))
                    ) : (
                      <td colSpan={4} className="px-2 py-2.5">
                        <div className="flex items-center justify-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                          {t('utility_alarms.settings.alarm_when')}
                          <span className="rounded bg-gray-100 px-2 py-0.5 font-semibold text-gray-700 dark:bg-white/10 dark:text-gray-200">{isEn ? s.stateEn : s.stateTh}</span>
                          {s.comm ? (
                            <SeverityPill severity="warning" />
                          ) : (
                            <select
                              disabled={dis}
                              value={r.stateSeverity}
                              onChange={(e) => update(s.key, { stateSeverity: e.target.value as AlarmSeverity })}
                              className="h-7 rounded-md border border-gray-300 bg-transparent px-1.5 text-xs disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900"
                            >
                              {(['critical', 'warning', 'info'] as AlarmSeverity[]).map((v) => (
                                <option key={v} value={v}>{t(`utility_alarms.severity.${v}`)}</option>
                              ))}
                            </select>
                          )}
                        </div>
                      </td>
                    )}
                    <td className="px-2 py-2.5">
                      <NumInput value={r.delaySec} step={1} disabled={dis} placeholder="0" onChange={(v) => update(s.key, { delaySec: Math.max(0, Math.round(v ?? 0)) })} />
                    </td>
                    <td className="px-2 py-2.5">
                      <div className="flex justify-center gap-1">
                        {CHANNELS.map((c) => (
                          <button
                            key={c.key}
                            type="button"
                            disabled={dis}
                            title={t(`utility_alarms.channel.${c.key}`)}
                            onClick={() => update(s.key, { [c.key]: !r[c.key] })}
                            className={`rounded-md p-1.5 transition disabled:cursor-not-allowed ${r[c.key] ? 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400' : 'text-gray-300 hover:text-gray-500 dark:text-gray-600'}`}
                          >
                            {c.icon}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className="px-2 py-2.5 text-center">
                      <button type="button" onClick={() => onAdvanced(s.key)} title={t('utility_alarms.settings.advanced')} className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-brand-600 dark:hover:bg-white/5">
                        <SlidersHorizontal className="size-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {sensors.some((s) => errors.has(s.key)) && <p className="px-5 py-2 text-xs text-error-600 dark:text-error-400">{t('utility_alarms.settings.order_hint')}</p>}
        </div>
      )}
    </div>
  );
}

/* ====================================================================== */
/* ตั้งค่าขั้นสูงรายเซนเซอร์                                                  */
/* ====================================================================== */
function AdvancedForm({ sensor: s, rule: r, canEdit, isEn, onChange, onClose }: {
  sensor: AlarmSensorDef; rule: AlarmRule; canEdit: boolean; isEn: boolean; onChange: (p: Partial<AlarmRule>) => void; onClose: () => void;
}) {
  const { t } = useTranslation();
  const field = 'text-xs font-medium text-gray-600 dark:text-gray-400';
  const hint = 'mt-1 block text-[11px] font-normal text-gray-400';
  return (
    <div>
      <p className="text-xs text-gray-500 dark:text-gray-400">{isEn ? s.deviceEn : s.deviceTh}</p>
      <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">{isEn ? s.en : s.th}</h3>
      <p className="mb-5 font-mono text-[11px] text-gray-400">
        device_name: {s.deviceName} · metric_name: {s.metricName}
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {s.kind === 'analog' ? (
          <label className={field}>
            {t('utility_alarms.settings.deadband')} {s.unit && `(${s.unit})`}
            <NumInput className="!h-9 !text-sm" value={r.deadband} step={10 ** -s.dp} disabled={!canEdit} placeholder="0" onChange={(v) => onChange({ deadband: Math.max(0, v ?? 0) })} />
            <span className={hint}>{t('utility_alarms.settings.deadband_hint')}</span>
          </label>
        ) : (
          <label className={field}>
            {t('utility_alarms.settings.trigger_on')}
            <select className={inputCls} disabled={!canEdit} value={r.triggerOn} onChange={(e) => onChange({ triggerOn: Number(e.target.value) as 0 | 1 })}>
              <option value={1}>1 (ON / TRUE)</option>
              <option value={0}>0 (OFF / FALSE)</option>
            </select>
            <span className={hint}>{t('utility_alarms.settings.trigger_hint')}</span>
          </label>
        )}
        <label className={field}>
          {t('utility_alarms.settings.delay')}
          <NumInput className="!h-9 !text-sm" value={r.delaySec} step={1} disabled={!canEdit} placeholder="0" onChange={(v) => onChange({ delaySec: Math.max(0, Math.round(v ?? 0)) })} />
          <span className={hint}>{t('utility_alarms.settings.delay_hint')}</span>
        </label>
        <label className={field}>
          {t('utility_alarms.settings.repeat')}
          <NumInput className="!h-9 !text-sm" value={r.repeatMin} step={1} disabled={!canEdit} placeholder="0" onChange={(v) => onChange({ repeatMin: Math.max(0, Math.round(v ?? 0)) })} />
          <span className={hint}>{t('utility_alarms.settings.repeat_hint')}</span>
        </label>
        <div className={field}>
          {t('utility_alarms.settings.col.channels')}
          <div className="mt-2 space-y-2">
            {CHANNELS.map((c) => (
              <label key={c.key} className="flex items-center gap-2.5">
                <Toggle size="sm" checked={r[c.key]} disabled={!canEdit} onChange={(v) => onChange({ [c.key]: v })} />
                <span className="inline-flex items-center gap-1.5">{c.icon} {t(`utility_alarms.channel.${c.key}`)}</span>
              </label>
            ))}
            <label className="flex items-center gap-2.5">
              <Toggle size="sm" checked={r.saveAlarm} disabled={!canEdit} onChange={(v) => onChange({ saveAlarm: v })} />
              {t('utility_alarms.settings.save_alarm')}
            </label>
          </div>
        </div>
      </div>

      <div className="mt-6 flex justify-end">
        <button type="button" onClick={onClose} className="h-9 rounded-lg bg-brand-500 px-5 text-sm font-medium text-white hover:bg-brand-600">
          {t('utility_alarms.settings.done')}
        </button>
      </div>
    </div>
  );
}
