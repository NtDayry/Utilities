import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  AlertTriangle,
  ArrowLeft,
  Cpu,
  Droplet,
  Gauge,
  Loader2,
  Lock,
  Play,
  Power,
  RotateCcw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Undo2,
  Zap,
} from 'lucide-react';
import PageMeta from '@/components/common/page/PageMeta';
import BackNav from '@/components/common/navigation/BackNav';
import IoStatusCards from '@/components/water-supply/control/IoStatusCards';
import { WaterSupplyMqttCard } from '@/components/water-supply/WaterSupplyMqttCard';
import { URL } from '@/api';
import { useAuthStore } from '@/store/auth';
import { isAdminRole } from '@/store/factorySensorSettings';
import useSwalAlert from '@/hooks/useSwalAlert';
import { createAuditLog } from '@/api/audit-logs/createAuditLog';
import { useWaterControl, type SendResult } from '@/hooks/useWaterControl';
import {
  ALL_FIELDS,
  SETTING_SECTIONS,
  fieldHintKey,
  fieldLabelKey,
  findField,
  optionKey,
  sectionDescKey,
  sectionTitleKey,
  validateField,
  type SettingKey,
} from '@/lib/waterControlFields';
import { useWaterSupplySource } from '@/lib/waterSupply/source';

const card = 'rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-white/[0.03]';
const btnBase = 'inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold shadow-sm transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50';
const btn = {
  primary: `${btnBase} bg-brand-500 text-white hover:bg-brand-600`,
  success: `${btnBase} bg-emerald-600 text-white hover:bg-emerald-700`,
  danger: `${btnBase} bg-error-600 text-white hover:bg-error-700`,
  ghost: `${btnBase} border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700`,
};
const inputCls =
  'w-full rounded-lg border bg-white px-3 py-2 text-sm tabular-nums text-gray-900 outline-none transition focus:ring-2 focus:ring-brand-500/30 dark:bg-gray-900 dark:text-white';

const AUDIT_ENTITY = 'water_supply_controller';

/**
 * หน้าควบคุมและตั้งค่าระบบปั๊มน้ำประปาผ่าน MQTT (เฉพาะ admin / super admin)
 * ส่งคำสั่งไป <topic>/set ตาม firmware แล้วรอยืนยันจาก <topic>/settings · ทุกคำสั่งบันทึก audit log
 */
export default function WaterSupplyControl() {
  const role = useAuthStore((s) => s.role);
  const isAdmin = isAdminRole(role);
  const { t } = useTranslation();

  if (!isAdmin) {
    return (
      <div className={`${card} mx-auto mt-10 max-w-lg text-center`}>
        <PageMeta title={t('water_supply.control.access_denied')} description="water supply control" />
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-error-50 text-error-600 dark:bg-error-500/10">
          <Lock className="h-6 w-6" />
        </div>
        <h1 className="text-lg font-bold text-gray-900 dark:text-white">{t('water_supply.control.administrators_only')}</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {t('water_supply.control.pump_control_settings_require_an_admin')}
        </p>
        <Link to={URL.WATER_SUPPLY_DETAILS} className={`${btn.ghost} mt-5`}>
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('water_supply.control.back_to_details')}
        </Link>
      </div>
    );
  }
  return <ControlPanel />;
}

function ControlPanel() {
  const { t } = useTranslation();
  const Swal = useSwalAlert();
  const username = useAuthStore((s) => s.username);
  const src = useWaterSupplySource();
  const WATER_MQTT_TOPIC = src.topic;
  const { status, data, settings, configs, lastSettings, send } = useWaterControl(src.topic, { enabled: true, systemId: src.systemId });
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<Record<SettingKey, string | boolean>>>({});
  const [speedDraft, setSpeedDraft] = useState<{ 1?: string; 2?: string }>({});

  const ready = status === 'connected' && settings !== null;
  const s = settings;
  const levelMax = s && Number.isFinite(s.tank_capacity) ? Number(draft.tank_capacity ?? s.tank_capacity) || s.tank_capacity : 1000;

  const label = (k: string) => {
    if (findField(k)) return t(fieldLabelKey(k));
    // คำสั่งที่ไม่ใช่ช่องตั้งค่า (โหมด/ปั๊ม/วาล์ว/รีสตาร์ท)
    return t(`water_supply.control.labels.${k}`, { defaultValue: k });
  };
  const show = (k: string, v: unknown) => {
    if (k === 'auto_mode') return v ? 'AUTO' : 'MANUAL';
    if (k === 'sensor_type_switch') return v ? 'Pressure switch' : 'RS485 sensor';
    if (typeof v === 'boolean') return v ? t('water_supply.control.on') : t('water_supply.control.off');
    const f = findField(k);
    const unit = f?.kind === 'number' ? f.unit : k.startsWith('manual_speed') ? 'Hz' : '';
    return `${v}${unit ? ` ${unit}` : ''}`;
  };

  /** ส่งคำสั่ง + ยืนยัน + แจ้งผล + audit log */
  const run = async (id: string, cmd: Record<string, unknown>, opts: { title: string; confirm?: boolean; danger?: boolean; action: string }) => {
    if (!ready && !('restart' in cmd)) return;
    const rows = Object.entries(cmd)
      .map(([k, v]) => {
        const old = s ? (s as unknown as Record<string, unknown>)[k] : undefined;
        return `<tr><td style="text-align:left;padding:2px 10px 2px 0">${label(k)}</td><td style="text-align:right;color:#64748b">${old === undefined ? '-' : show(k, old)}</td><td style="padding:0 6px">→</td><td style="text-align:right;font-weight:700">${show(k, v)}</td></tr>`;
      })
      .join('');
    if (opts.confirm !== false) {
      const r = await Swal.confirm({
        title: opts.title,
        message: '',
        html: `<table style="margin:0 auto;font-size:14px">${rows}</table>`,
        icon: opts.danger ? 'warning' : 'question',
        confirmButtonText: t('water_supply.control.send_command'),
        cancelButtonText: t('water_supply.control.cancel'),
      });
      if (!r.isConfirmed) return;
    }
    setBusy(id);
    const before = s ? Object.fromEntries(Object.keys(cmd).map((k) => [k, (s as unknown as Record<string, unknown>)[k]])) : null;
    const res: SendResult = await send(cmd).finally(() => setBusy(null));
    createAuditLog({
      action: opts.action,
      entity: AUDIT_ENTITY,
      entity_id: WATER_MQTT_TOPIC,
      old_data: before,
      new_data: { command: cmd, topic: `${WATER_MQTT_TOPIC}/set`, by: username, result: { ok: res.ok, confirmed: res.confirmed, adjusted: res.adjusted, pending: res.pending, error: res.error } },
    });
    if (!res.ok) {
      Swal.error({
        title: t('water_supply.control.command_failed'),
        message: res.error === 'not_connected' ? t('water_supply.control.not_connected_to_the_mqtt_broker') : res.error,
        showConfirmButton: true,
        showCancelButton: false,
      });
      return;
    }
    const adj = Object.entries(res.adjusted);
    if (res.pending.length || adj.length) {
      const lines = [
        ...adj.map(([k, [a, b]]) => `${label(k)}: ${t('water_supply.control.sent')} ${show(k, a)} → ${t('water_supply.control.device_applied')} ${show(k, b)}`),
        ...res.pending.map((k) => `${label(k)}: ${t('water_supply.control.not_confirmed_yet')}`),
      ];
      Swal.warning({ title: t('water_supply.control.sent_but_some_values_differ'), message: '', html: lines.join('<br/>') });
    } else {
      Swal.Toast({ message: t('water_supply.control.confirmed_by_the_controller') });
    }
    return res;
  };

  // ---------- ฟอร์มตั้งค่า ----------
  const value = (k: SettingKey) => (draft[k] !== undefined ? draft[k] : s ? s[k] : '');
  const changes = useMemo(() => {
    if (!s) return {} as Record<string, number | boolean>;
    const out: Record<string, number | boolean> = {};
    (Object.keys(draft) as SettingKey[]).forEach((k) => {
      const f = findField(k);
      const v = draft[k];
      if (!f || v === undefined) return;
      if (f.kind === 'select') {
        if (v !== s[k]) out[k] = v as boolean;
      } else {
        const n = Number(v);
        if (v !== '' && Number.isFinite(n) && Math.abs(n - Number(s[k])) > 1e-6) out[k] = n;
      }
    });
    return out;
  }, [draft, s]);
  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    ALL_FIELDS.forEach((f) => {
      if (draft[f.key] === undefined) return;
      const err = validateField(f, draft[f.key], levelMax, t);
      if (err) e[f.key] = err;
    });
    const lo = Number(value('alert_min_cm')), hi = Number(value('alert_max_cm'));
    if ((draft.alert_min_cm !== undefined || draft.alert_max_cm !== undefined) && lo >= hi)
      e.alert_max_cm = t('water_supply.control.must_be_above_the_low_alarm');
    return e;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, levelMax, t, s]);
  const nChanges = Object.keys(changes).length;
  const hasErrors = Object.keys(errors).length > 0;

  const saveSettings = async () => {
    const res = await run('settings', changes, { title: t('water_supply.control.save_nchanges_setting_s', { nChanges }), action: 'water_supply_update_settings' });
    if (res?.ok) setDraft({});
  };

  // ---------- สถานะสด ----------
  const d = data;
  const pumpLive = (i: 1 | 2) => {
    const p = d ? (i === 1 ? d.pump1 : d.pump2) : null;
    const alarm = !!p && (p.alarm || (i === 1 ? d!.controls.pump1_alarm : d!.controls.pump2_alarm));
    const running = !!p && (p.running || (i === 1 ? d!.controls.pump1_on : d!.controls.pump2_on));
    return { p, alarm, running };
  };
  const levelLow = !!(d && s && d.water_level.level_cm < s.lower_limit_cm);

  const connBadge =
    status === 'connected'
      ? 'bg-success-50 text-success-700 border-success-200 dark:bg-success-500/10 dark:text-success-400 dark:border-success-800'
      : status === 'connecting'
        ? 'bg-warning-50 text-warning-700 border-warning-200 dark:bg-warning-500/10 dark:text-warning-400 dark:border-warning-800'
        : 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700';

  const isAuto = !!s?.auto_mode;

  return (
    <div className="space-y-6 pb-12">
      <PageMeta title={t('water_supply.control.pump_control_settings')} description="water supply control (admin)" />

      {/* Header */}
      <div className={card}>
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900 dark:text-white sm:text-2xl">
            {t('water_supply.control.pump_control_settings')}
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-bold text-brand-600 dark:bg-brand-500/15 dark:text-brand-400">
              <ShieldCheck className="h-3.5 w-3.5" />
              Admin
            </span>
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {t('water_supply.control.commands_go_to')} <span className="font-mono text-xs font-semibold text-brand-600 dark:text-brand-400">{WATER_MQTT_TOPIC}/set</span>
            {' · '}
            {t('water_supply.control.last_settings_from_device')}:{' '}
            <span className="font-medium text-gray-700 dark:text-gray-200">{lastSettings ? new Date(lastSettings).toLocaleTimeString() : '-'}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-gray-100 pt-4 dark:border-gray-800">
          <BackNav
            to={URL.WATER_SUPPLY_DETAILS}
            label={t('water_supply.control.back_to_system_details')}
            crumbs={[
              { label: t('water_supply.control.water_overview'), to: URL.WATER_SUPPLY_DASHBOARD },
              { label: t('water_supply.control.tanks_pumps'), to: URL.WATER_SUPPLY_DETAILS },
              { label: t('water_supply.control.control_settings') },
            ]}
            className=""
          />
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {configs?.system?.firmware_version && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 px-3 py-1 font-medium text-gray-600 dark:border-gray-700 dark:text-gray-300">
                <Cpu className="h-3.5 w-3.5" />
                FW {configs.system.firmware_version} · {configs.network?.ip ?? d?.system.ip ?? '-'}
              </span>
            )}
            <span className={`rounded-full border px-3 py-1 font-semibold ${connBadge}`}>
              ● {status === 'connected' ? t('water_supply.control.connected') : status === 'connecting' ? t('water_supply.control.connecting') : t('water_supply.control.offline')}
            </span>
          </div>
        </div>
      </div>

      {/* การเชื่อมต่อ MQTT ของระบบควบคุมปั๊มน้ำ (topic / broker) — ถัง / บ่อเก็บน้ำอื่นตั้งในหน้าของแต่ละระบบ */}
      <WaterSupplyMqttCard connected={status === 'connected'} />

      {!ready && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
          {status !== 'connected'
            ? t('water_supply.control.connecting_to_the_mqtt_broker_controls')
            : t('water_supply.control.waiting_for_water_mqtt_topic_settings', { WATER_MQTT_TOPIC })}
        </div>
      )}

      {/* ===== การควบคุม ===== */}
      <section className="grid gap-4 lg:grid-cols-4">
        {/* โหมด */}
        <div className={card}>
          <Title icon={<SlidersHorizontal className="h-4 w-4" />}>{t('water_supply.control.operating_mode')}</Title>
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1 dark:bg-gray-800">
            {[true, false].map((auto) => (
              <button
                key={String(auto)}
                type="button"
                disabled={!ready || !!busy || isAuto === auto}
                onClick={() =>
                  run('mode', { auto_mode: auto }, {
                    title: auto
                      ? t('water_supply.control.switch_to_auto_manual_pump_valve')
                      : t('water_supply.control.switch_to_manual_pumps_run_only'),
                    action: 'water_supply_set_mode',
                    danger: true,
                  })
                }
                className={`rounded-lg py-2.5 text-sm font-bold transition disabled:cursor-default ${
                  isAuto === auto && ready ? 'bg-white text-brand-600 shadow dark:bg-gray-900 dark:text-brand-400' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white'
                }`}
              >
                {auto ? 'AUTO' : 'MANUAL'}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
            {isAuto
              ? t('water_supply.control.auto_vfds_hold_pressure_via_pid')
              : t('water_supply.control.manual_start_stop_pumps_set_speed')}
          </p>
          {busy === 'mode' && <Sending />}
        </div>

        {/* ปั๊ม 1, 2 */}
        {([1, 2] as const).map((i) => {
          const { p, alarm, running } = pumpLive(i);
          const autoEn = s ? (i === 1 ? s.auto_pump1 : s.auto_pump2) : false;
          const manOn = s ? (i === 1 ? s.manual_pump1 : s.manual_pump2) : false;
          const spdKey = (i === 1 ? 'manual_speed_pump1' : 'manual_speed_pump2') as SettingKey;
          const spdNow = s ? Number(s[spdKey]) : 0;
          const minHz = s && Number.isFinite(s.sleep_freq) ? Math.max(0, s.sleep_freq) : 0; // อุปกรณ์ยังไม่ส่ง sleep_freq → เดิมแสดง "NaN–50 Hz"
          const spdVal = speedDraft[i] ?? (Number.isFinite(spdNow) ? String(spdNow) : '');
          const spdNum = Number(spdVal);
          const spdErr = spdVal !== '' && (!Number.isFinite(spdNum) || spdNum < minHz || spdNum > 50);
          return (
            <div key={i} className={card}>
              <div className="mb-3 flex items-center justify-between">
                <Title icon={<Zap className="h-4 w-4" />} className="mb-0">
                  {t('water_supply.control.pump_i', { i })}
                </Title>
                <StatusPill tone={alarm ? 'bad' : running ? 'ok' : 'idle'}>{alarm ? 'FAULT' : running ? t('water_supply.control.run') : t('water_supply.control.stop')}</StatusPill>
              </div>
              <div className="mb-3 grid grid-cols-2 gap-2 text-xs">
                <Mini label={t('water_supply.control.freq')} value={p ? `${p.freq.toFixed(1)} Hz` : '-'} />
                <Mini label={t('water_supply.control.current')} value={p ? `${p.current.toFixed(1)} A` : '-'} />
              </div>
              {isAuto ? (
                <ToggleRow
                  label={t('water_supply.control.enabled_in_auto')}
                  on={autoEn}
                  disabled={!ready || !!busy}
                  onChange={(v) => run(`p${i}`, { [`auto_pump${i}`]: v }, { title: t(v ? 'water_supply.control.pump_auto_enable' : 'water_supply.control.pump_auto_disable', { i }), action: 'water_supply_pump_auto_enable', danger: !v })}
                />
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      className={btn.success}
                      disabled={!ready || !!busy || manOn || (levelLow && !manOn)}
                      title={levelLow ? t('water_supply.control.level_below_cut_off') : undefined}
                      onClick={() => run(`p${i}`, { [`manual_pump${i}`]: true }, { title: t('water_supply.control.start_pump_i', { i }), action: 'water_supply_pump_start', danger: true })}
                    >
                      <Play className="h-3.5 w-3.5" />
                      {t('water_supply.control.start')}
                    </button>
                    <button
                      type="button"
                      className={btn.danger}
                      disabled={!ready || !!busy || !manOn}
                      onClick={() => run(`p${i}`, { [`manual_pump${i}`]: false }, { title: t('water_supply.control.stop_pump_i', { i }), action: 'water_supply_pump_stop', danger: true })}
                    >
                      <Square className="h-3.5 w-3.5" />
                      {t('water_supply.control.stop_2')}
                    </button>
                  </div>
                  <div>
                    <div className="mb-1 flex justify-between text-[11px] text-gray-500 dark:text-gray-400">
                      <span>{t('water_supply.control.manual_speed')}</span>
                      <span>
                        {minHz.toFixed(1)}–50 Hz
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="range"
                        min={minHz}
                        max={50}
                        step={0.5}
                        value={Number.isFinite(spdNum) ? spdNum : minHz}
                        disabled={!ready || !!busy}
                        onChange={(e) => setSpeedDraft((x) => ({ ...x, [i]: e.target.value }))}
                        className="w-full accent-brand-500"
                      />
                      <input
                        type="number"
                        min={minHz}
                        max={50}
                        step={0.5}
                        value={spdVal}
                        disabled={!ready || !!busy}
                        onChange={(e) => setSpeedDraft((x) => ({ ...x, [i]: e.target.value }))}
                        className={`${inputCls} w-20 px-2 py-1 ${spdErr ? 'border-error-500' : 'border-gray-300 dark:border-gray-700'}`}
                      />
                    </div>
                    <button
                      type="button"
                      className={`${btn.primary} mt-2 w-full`}
                      disabled={!ready || !!busy || spdErr || speedDraft[i] === undefined || Math.abs(spdNum - spdNow) < 1e-6}
                      onClick={async () => {
                        const r = await run(`p${i}`, { [spdKey]: spdNum }, { title: t('water_supply.control.set_pump_i_speed', { i }), action: 'water_supply_pump_speed' });
                        if (r?.ok) setSpeedDraft((x) => ({ ...x, [i]: undefined }));
                      }}
                    >
                      {t('water_supply.control.apply_speed')}
                    </button>
                  </div>
                </div>
              )}
              {busy === `p${i}` && <Sending />}
            </div>
          );
        })}

        {/* วาล์ว + อุปกรณ์ */}
        <div className={`${card} flex flex-col`}>
          <div className="mb-3 flex items-center justify-between">
            <Title icon={<Droplet className="h-4 w-4" />} className="mb-0">
              {t('water_supply.control.inlet_valve')}
            </Title>
            <StatusPill tone={d?.controls.valve_on ? 'ok' : 'idle'}>{d?.controls.valve_on ? t('water_supply.control.open') : t('water_supply.control.closed')}</StatusPill>
          </div>
          {isAuto ? (
            <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
              {t('water_supply.control.auto_opens_below_v_cm_see', { v: s ? s.valve_on_cm : '-' })}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className={btn.success} disabled={!ready || !!busy || !!s?.manual_valve} onClick={() => run('valve', { manual_valve: true }, { title: t('water_supply.control.open_inlet_valve'), action: 'water_supply_valve_open' })}>
                {t('water_supply.control.open_2')}
              </button>
              <button type="button" className={btn.ghost} disabled={!ready || !!busy || !s?.manual_valve} onClick={() => run('valve', { manual_valve: false }, { title: t('water_supply.control.close_inlet_valve'), action: 'water_supply_valve_close' })}>
                {t('water_supply.control.close')}
              </button>
            </div>
          )}
          {busy === 'valve' && <Sending />}
          <div className="border-gray-100 pt-4 dark:border-gray-800">
            <button
              type="button"
              className={`${btn.ghost} h-[42px] w-full text-error-600 dark:text-error-400`}
              disabled={status !== 'connected' || !!busy}
              onClick={() => run('restart', { restart: true }, { title: t('water_supply.control.restart_controller_control_pauses_while'), action: 'water_supply_restart', danger: true })}
            >
              <Power className="h-3.5 w-3.5" />
              {t('water_supply.control.restart_controller')}
            </button>
          </div>
        </div>
      </section>

      {levelLow && (
        <div className="flex items-center gap-2 rounded-xl border border-error-200 bg-error-50 px-4 py-2.5 text-xs font-medium text-error-700 dark:border-error-800 dark:bg-error-950/30 dark:text-error-300">
          <AlertTriangle className="h-4 w-4" />
          {t('water_supply.control.level_is_below_the_pump_cut')}
        </div>
      )}

      {/* ===== ค่าตั้ง ===== */}
      <section className={card}>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Title icon={<Gauge className="h-4 w-4" />} className="mb-0">
            {t('water_supply.control.controller_settings')}
          </Title>
          <div className="flex items-center gap-2">
            <button type="button" className={btn.ghost} disabled={nChanges === 0 && Object.keys(draft).length === 0} onClick={() => setDraft({})}>
              <Undo2 className="h-3.5 w-3.5" />
              {t('water_supply.control.discard')}
            </button>
            <button type="button" className={btn.primary} disabled={!ready || !!busy || nChanges === 0 || hasErrors} onClick={saveSettings}>
              {busy === 'settings' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              {t('water_supply.control.save_changesv', { v: nChanges ? ` (${nChanges})` : '' })}
            </button>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          {SETTING_SECTIONS.map((sec) => (
            <div key={sec.id} className="rounded-xl border border-gray-100 p-4 dark:border-gray-800">
              <h3 className="text-sm font-bold text-gray-800 dark:text-white/90">{t(sectionTitleKey(sec.id))}</h3>
              <p className="mb-4 mt-0.5 text-xs text-gray-500 dark:text-gray-400">{t(sectionDescKey(sec.id))}</p>
              <div className="grid gap-4 sm:grid-cols-2">
                {sec.fields.map((f) => {
                  const changed = f.key in changes;
                  const err = errors[f.key];
                  const cur = s ? s[f.key] : undefined;
                  const border = err ? 'border-error-500' : changed ? 'border-brand-500 ring-1 ring-brand-500/30' : 'border-gray-300 dark:border-gray-700';
                  return (
                    <label key={f.key} className="block">
                      <span className="mb-1 flex items-center justify-between gap-2 text-xs font-medium text-gray-600 dark:text-gray-300">
                        {t(fieldLabelKey(f.key))}
                        {changed && <span className="rounded bg-brand-50 px-1.5 text-[10px] font-bold text-brand-600 dark:bg-brand-500/15 dark:text-brand-400">{t('water_supply.control.edited')}</span>}
                      </span>
                      {f.kind === 'select' ? (
                        <select
                          className={`${inputCls} ${border}`}
                          disabled={!ready || !!busy}
                          value={String(value(f.key))}
                          onChange={(e) => setDraft((x) => ({ ...x, [f.key]: e.target.value === 'true' }))}
                        >
                          {f.options.map((o) => (
                            <option key={String(o)} value={String(o)}>
                              {t(optionKey(f.key, o))}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div className="relative">
                          <input
                            type="number"
                            inputMode="decimal"
                            className={`${inputCls} ${border} ${f.unit ? 'pr-12' : ''}`}
                            disabled={!ready || !!busy}
                            min={f.min}
                            max={f.max === 'level' ? levelMax : f.max}
                            step={f.step}
                            value={String(value(f.key))}
                            onChange={(e) => setDraft((x) => ({ ...x, [f.key]: e.target.value }))}
                          />
                          {f.unit && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">{f.unit}</span>}
                        </div>
                      )}
                      <span className={`mt-1 block text-[11px] ${err ? 'text-error-600 dark:text-error-400' : 'text-gray-400 dark:text-gray-500'}`}>
                        {err ??
                          (changed && cur !== undefined
                            ? `${t('water_supply.control.current_2')}: ${show(f.key, cur)}`
                            : f.kind === 'number'
                              ? `${f.min}–${f.max === 'level' ? levelMax : f.max}${f.unit ? ` ${f.unit}` : ''}${f.hint ? ` · ${t(fieldHintKey(f.key))}` : ''}`
                              : f.hint
                                ? t(fieldHintKey(f.key))
                                : '')}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 flex items-center gap-1.5 text-[11px] text-gray-400 dark:text-gray-500">
          <RotateCcw className="h-3 w-3" />
          {t('water_supply.control.after_sending_the_page_waits_for')}
        </p>
      </section>

      {/* สถานะ I/O ของ controller (ย้ายมาจากหน้ารายละเอียดระบบประปา) */}
      <IoStatusCards data={data} />
    </div>
  );
}

/* ---------- ส่วนประกอบย่อย ---------- */
function Title({ icon, children, className = 'mb-3' }: { icon: ReactNode; children: ReactNode; className?: string }) {
  return (
    <h2 className={`flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-white/90 ${className}`}>
      <span className="text-brand-500">{icon}</span>
      {children}
    </h2>
  );
}

function StatusPill({ tone, children }: { tone: 'ok' | 'bad' | 'idle'; children: ReactNode }) {
  const cls = {
    ok: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
    bad: 'animate-pulse bg-error-600 text-white',
    idle: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  }[tone];
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${cls}`}>{children}</span>;
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 px-2.5 py-1.5 dark:bg-white/[0.03]">
      <div className="text-[10px] text-gray-500 dark:text-gray-400">{label}</div>
      <div className="font-bold tabular-nums text-gray-900 dark:text-white">{value}</div>
    </div>
  );
}

function ToggleRow({ label, on, disabled, onChange }: { label: string; on: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="flex w-full items-center justify-between rounded-xl border border-gray-200 px-3 py-2.5 text-left text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
    >
      {label}
      <span className={`relative h-5 w-9 rounded-full transition ${on ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
    </button>
  );
}

function Sending() {
  const { t } = useTranslation();
  return (
    <div className="mt-3 flex items-center gap-1.5 text-xs text-brand-600 dark:text-brand-400">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      {t('water_supply.control.sending_and_waiting_for_confirmation')}
    </div>
  );
}
