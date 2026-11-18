import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, AlertTriangle, Droplet, Gauge, Moon, ShieldAlert, ShieldCheck, Zap } from 'lucide-react';
import type { PumpInfo, TankData } from '@/types/waterSupply.types';
import { SIREN_CARD } from '@/lib/sirenStyle';

export type Tone = 'run' | 'sleep' | 'fault' | 'stop' | 'info';

const toneCard: Record<Tone, string> = {
  run: 'border-emerald-300 bg-emerald-50/40 dark:border-emerald-800 dark:bg-emerald-950/20',
  sleep: 'border-amber-300 bg-amber-50/40 dark:border-amber-800 dark:bg-amber-950/20',
  fault: SIREN_CARD,
  stop: 'border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]',
  info: 'border-cyan-300 bg-cyan-50/30 dark:border-cyan-800 dark:bg-cyan-950/20',
};
const toneIcon: Record<Tone, string> = {
  run: 'bg-emerald-500 text-white',
  sleep: 'bg-amber-500 text-white',
  fault: 'bg-error-500 text-white animate-pulse',
  stop: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
  info: 'bg-cyan-500 text-white',
};
const toneBadge: Record<Tone, string> = {
  run: 'border border-emerald-300 bg-emerald-100 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
  sleep: 'border border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
  fault: 'animate-pulse bg-error-600 text-white',
  stop: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  info: 'border border-cyan-300 bg-cyan-100 text-cyan-700 dark:border-cyan-800 dark:bg-cyan-950/60 dark:text-cyan-300',
};

export function Shell({ tone, icon, title, sub, badge, children, darkSurface }: { tone: Tone; icon: ReactNode; title: string; sub: string; badge: ReactNode; children: ReactNode; /** ใช้พื้นการ์ดธีมมืด dark:bg-gray-800 แทนพื้นตามสถานะ (หน้าถังน้ำ/บ่อเก็บน้ำ) ; ส่งเป็นคลาสเพื่อกำหนดพื้น/ขอบธีมมืดเอง (การ์ดที่ซ้อนในการ์ดอื่น) */ darkSurface?: boolean | string }) {
  // fault คงพื้นแดงอ่อนไว้แม้ใช้ darkSurface
  const custom = typeof darkSurface === 'string';
  const cls =
    darkSurface && tone !== 'fault'
      ? `${toneCard[tone]
          .split(' ')
          .filter((c) => !c.startsWith('dark:bg-') && !(custom && tone === 'stop' && c.startsWith('dark:border-')))
          .join(' ')} ${custom ? darkSurface : 'dark:bg-gray-800'}`
      : toneCard[tone];
  return (
    <div className={`relative overflow-hidden rounded-2xl border p-4.5 shadow-xs transition hover:shadow-md ${cls}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className={`flex h-9 w-9 items-center justify-center rounded-xl shadow-xs ${toneIcon[tone]}`}>{icon}</div>
          <div>
            <h3 className="text-sm font-bold text-gray-900 dark:text-white">{title}</h3>
            <span className="text-[11px] text-gray-500 dark:text-gray-400">{sub}</span>
          </div>
        </div>
        {badge}
      </div>
      <div className="mt-3.5 space-y-1.5 border-t border-gray-100 pt-3 dark:border-gray-800/80">{children}</div>
    </div>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className="font-semibold tabular-nums text-gray-800 dark:text-gray-100">{children}</span>
    </div>
  );
}

export function Bar({ value, max, cls }: { value: number; max: number; cls: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
      <div className={`h-full rounded-full transition-all duration-700 ${cls}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export const Badge = ({ tone, children }: { tone: Tone; children: ReactNode }) => (
  <span className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold ${toneBadge[tone]}`}>{children}</span>
);

export const CommDot = ({ ok }: { ok: boolean }) => (
  <span className={`inline-flex items-center gap-1 ${ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-error-600 dark:text-error-400'}`}>
    <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-error-500'}`} />
    {ok ? 'OK' : 'LOST'}
  </span>
);

/** การ์ดสถานะปั๊ม 1/2, วาล์วน้ำเข้า และแรงดันท่อจ่าย (ค่าจาก MQTT) */
export default function PumpStatusCards({ data }: { data: TankData }) {
  const { t } = useTranslation();
  const c = data.controls, sys = data.system, wl = data.water_level;

  const pumpCard = (i: 1 | 2, p: PumpInfo) => {
    const fault = p.alarm || (i === 1 ? c.pump1_alarm || c.pump1_overload : c.pump2_alarm || c.pump2_overload);
    const running = p.running || (i === 1 ? c.pump1_on : c.pump2_on);
    const tone: Tone = fault ? 'fault' : running ? 'run' : c.is_sleeping ? 'sleep' : 'stop';
    const auto = i === 1 ? c.auto_pump1 : c.auto_pump2;
    const comm = (i === 1 ? sys.pump1_comm_ok : sys.pump2_comm_ok) || p.modbus_ok;
    const manualSpeed = i === 1 ? c.manual_speed_pump1 : c.manual_speed_pump2;
    return (
      <Shell
        key={i}
        tone={tone}
        icon={<Zap className="h-4.5 w-4.5" />}
        title={t(`water_supply.pump_${i}`)}
        sub={auto ? t('water_supply.auto') : `${t('water_supply.manual')} · ${manualSpeed.toFixed(1)} Hz`}
        badge={
          tone === 'fault' ? (
            <Badge tone="fault"><AlertTriangle className="h-3 w-3" />FAULT</Badge>
          ) : tone === 'run' ? (
            <Badge tone="run"><span className="h-2 w-2 animate-ping rounded-full bg-emerald-500" />{t('water_supply.pump_run')}</Badge>
          ) : tone === 'sleep' ? (
            <Badge tone="sleep"><Moon className="h-3 w-3" />SLEEP</Badge>
          ) : (
            <Badge tone="stop">{t('water_supply.pump_stop')}</Badge>
          )
        }
      >
        <Row label={t('water_supply.scene3d.frequency')}>{p.freq.toFixed(1)} Hz</Row>
        <Bar value={p.freq} max={50} cls={fault ? 'bg-error-500' : 'bg-emerald-500'} />
        <Row label={t('water_supply.scene3d.current')}>{p.current.toFixed(1)} A</Row>
        <Row label={t('water_supply.overload_status')}>
          {fault ? (
            <span className="inline-flex items-center gap-1 text-error-600 dark:text-error-400"><ShieldAlert className="h-3.5 w-3.5" />{t('water_supply.tripped')}</span>
          ) : (
            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><ShieldCheck className="h-3.5 w-3.5" />{t('water_supply.normal')}</span>
          )}
        </Row>
        <Row label="Modbus"><CommDot ok={comm} /></Row>
      </Shell>
    );
  };

  const usesSensor = c.sensor_type !== 'pressure_switch' && !c.sensor_type_switch;
  const flowAlarm = !!data.flow_meter?.flow_alarm;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {pumpCard(1, data.pump1)}
      {pumpCard(2, data.pump2)}

      {/* flow_alarm จากมิเตอร์น้ำ → กรอบแดง */}
      <Shell
        tone={flowAlarm ? 'fault' : c.valve_on ? 'info' : 'stop'}
        icon={<Droplet className="h-4.5 w-4.5" />}
        title={t('water_supply.inlet_valve')}
        sub={c.manual_valve ? t('water_supply.manual') : t('water_supply.auto')}
        badge={<Badge tone={c.valve_on ? 'info' : 'stop'}>{c.valve_on ? t('water_supply.valve_open') : t('water_supply.valve_closed')}</Badge>}
      >
        <Row label={t('water_supply.flow_rate')}>
          <span className={flowAlarm ? 'text-error-600 dark:text-error-400' : undefined}>{wl.flow_rate.toFixed(3)} m³/h</span>
        </Row>
        <Row label={t('water_supply.accumulated_volume')}>{wl.volumn.toFixed(3)} m³</Row>
        <Row label={t('water_supply.scene3d.flow_meter')}><CommDot ok={sys.meter_comm_ok} /></Row>
        {flowAlarm && (
          <Row label={t('water_supply.flow_alarm')}>
            <Badge tone="fault">ALARM</Badge>
          </Row>
        )}
      </Shell>

      <Shell
        tone={usesSensor && !c.pressure_sensor_ok ? 'fault' : c.pressure_switch ? 'run' : 'stop'}
        icon={usesSensor ? <Gauge className="h-4.5 w-4.5" /> : <Activity className="h-4.5 w-4.5" />}
        title={t('water_supply.scene3d.discharge_pressure')}
        sub={c.sensor_type === 'pressure_switch' ? 'Pressure switch' : 'Pressure transmitter'}
        badge={<Badge tone={c.pressure_switch ? 'run' : 'stop'}>PS {c.pressure_switch ? 'ON' : 'OFF'}</Badge>}
      >
        <Row label={t('water_supply.scene3d.pressure_now')}>{c.pressure_bar.toFixed(2)} bar</Row>
        <Bar value={c.pressure_bar} max={Math.max(c.set_pressure * 1.5, 1)} cls="bg-sky-500" />
        <Row label={t('water_supply.scene3d.setpoint')}>{c.set_pressure.toFixed(2)} bar</Row>
        <Row label={t('water_supply.scene3d.pressure_sensor')}><CommDot ok={c.pressure_sensor_ok && sys.pressure_comm_ok} /></Row>
      </Shell>
    </div>
  );
}
