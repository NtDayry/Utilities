import { useEffect, useState } from 'react';
import type { ConnStatus, LevelPoint, PumpInfo, TankData } from '@/types/waterSupply.types';
import { backendBridge, type BridgeStatus } from '@/lib/mqtt/backendBridge';

/** สถานะของช่องทาง backend → สถานะที่หน้าจอใช้ */
export const bridgeConnStatus = (st: BridgeStatus): ConnStatus =>
  st.ws === 'closed' ? 'offline' : st.ws === 'connecting' || st.broker === null ? 'connecting' : st.broker ? 'connected' : 'offline';

const MAX_HISTORY = 120;

const num = (...vals: unknown[]): number => {
  for (const v of vals) {
    if (v === undefined || v === null || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
};
const bool = (...vals: unknown[]): boolean => {
  for (const v of vals) if (v !== undefined && v !== null) return Boolean(v);
  return false;
};

type RawObj = Record<string, unknown> | undefined;

function parsePump(p: RawObj, c: RawObj, idx: 1 | 2): PumpInfo {
  return {
    running: bool(p?.running, c?.[`pump${idx}_on`]),
    alarm: bool(p?.alarm, c?.[`pump${idx}_alarm`]),
    freq: num(p?.freq),
    current: num(p?.current),
    status_word: num(p?.status_word),
    auto_enabled: bool(p?.auto_enabled, c?.[`auto_pump${idx}`]),
    manual_enabled: bool(p?.manual_enabled, c?.[`manual_pump${idx}`]),
    modbus_ok: bool(p?.modbus_ok),
  };
}

export function parseTankData(raw: any): TankData {
  const w = raw.water_level ?? {};
  // firmware รุ่นใหม่ย้าย flow_rate / volumn ไปไว้ใน flow_meter (มิเตอร์น้ำแยก) — รุ่นเก่าอยู่ใน water_level
  const f = raw.flow_meter ?? {};
  const c = raw.controls ?? {};
  const s = raw.system ?? {};
  const level_cm = num(w.level_cm, raw.level_cm, raw.level);
  const tank_capacity_cm = num(w.tank_capacity_cm, raw.tank_capacity_cm) || 180;
  const pump1 = parsePump(raw.pump1, c, 1);
  const pump2 = parsePump(raw.pump2, c, 2);

  // Overload/Fault: firmware รุ่นใหม่ส่ง pumpN_alarm (alarm จากอินเวอร์เตอร์) — รุ่นเก่าอาจส่ง pumpN_overload/ol/trip
  const overload = (idx: 1 | 2, pump: PumpInfo) =>
    bool(
      c[`pump${idx}_overload`] ?? raw[`pump${idx}_overload`] ?? c[`overload_pump${idx}`] ?? c[`pump${idx}_ol`] ?? c[`pump${idx}_trip`]
    ) || pump.alarm;

  return {
    water_level: {
      level_cm,
      level_pct: num(w.level_pct, raw.level_pct, tank_capacity_cm > 0 ? (level_cm / tank_capacity_cm) * 100 : 0),
      volumn: num(f.volumn, w.volumn, raw.volumn, raw.volume),
      flow_rate: num(f.flow_rate, w.flow_rate, raw.flow_rate),
      tank_capacity_cm,
    },
    controls: {
      valve_on: bool(c.valve_on, raw.valve_on, raw.valve),
      pump1_on: bool(c.pump1_on, raw.pump1_on, raw.pump1?.running),
      pump2_on: bool(c.pump2_on, raw.pump2_on, raw.pump2?.running),
      pump1_overload: overload(1, pump1),
      pump2_overload: overload(2, pump2),
      pump1_alarm: bool(c.pump1_alarm, pump1.alarm),
      pump2_alarm: bool(c.pump2_alarm, pump2.alarm),
      alarm_on: bool(c.alarm_on, raw.alarm_on, raw.alarm),
      auto_mode: bool(c.auto_mode, raw.auto_mode),
      auto_pump1: bool(c.auto_pump1, raw.auto_pump1),
      auto_pump2: bool(c.auto_pump2, raw.auto_pump2),
      manual_pump1: bool(c.manual_pump1, raw.manual_pump1),
      manual_pump2: bool(c.manual_pump2, raw.manual_pump2),
      manual_valve: bool(c.manual_valve, raw.manual_valve),
      manual_speed_pump1: num(c.manual_speed_pump1),
      manual_speed_pump2: num(c.manual_speed_pump2),
      pressure_bar: num(c.pressure_bar, raw.pressure_bar),
      set_pressure: num(c.set_pressure),
      pid_kp: num(c.pid_kp),
      pid_ki: num(c.pid_ki),
      acc_dec: num(c.acc_dec),
      sleep_freq: num(c.sleep_freq),
      sleep_delay_sec: num(c.sleep_delay_sec),
      is_sleeping: bool(c.is_sleeping),
      lower_limit_cm: num(c.lower_limit_cm),
      sensor_type_switch: bool(c.sensor_type_switch),
      sensor_type: String(c.sensor_type ?? (c.sensor_type_switch ? 'pressure_switch' : 'pressure_sensor')),
      pressure_switch: bool(c.pressure_switch, raw.pressure_switch),
      pressure_sensor_ok: bool(c.pressure_sensor_ok),
      pid_target_freq: num(c.pid_target_freq),
    },
    flow_meter: {
      ok: bool(f.ok, s.meter_comm_ok),
      velocity: num(f.velocity),
      today_total: num(f.today_total),
      month_total: num(f.month_total),
      temp_c: num(f.temp_c),
      error_code: String(f.error_code ?? ''),
      battery_v: num(f.battery_v),
      flow_alarm: bool(f.flow_alarm),
    },
    pump1,
    pump2,
    local_io: raw.local_io || { di0: false, di1: false, do0: false, do1: false },
    rs485_io: raw.rs485_io || { status_ok: false, input: {}, output: {} },
    system: {
      wifi_rssi: num(s.wifi_rssi, raw.wifi_rssi),
      ip: String(s.ip ?? raw.ip ?? '-'),
      sensor_comm_ok: bool(s.sensor_comm_ok, raw.sensor_comm_ok),
      rs485_io_ok: bool(s.rs485_io_ok, raw.rs485_io?.status_ok),
      meter_comm_ok: bool(s.meter_comm_ok),
      level_comm_ok: bool(s.level_comm_ok, s.sensor_comm_ok),
      pump1_comm_ok: bool(s.pump1_comm_ok, pump1.modbus_ok),
      pump2_comm_ok: bool(s.pump2_comm_ok, pump2.modbus_ok),
      pressure_comm_ok: bool(s.pressure_comm_ok),
      uptime_sec: num(s.uptime_sec, raw.uptime_sec),
    },
  };
}

/**
 * ข้อมูลถังน้ำจาก MQTT topic (ผ่าน WebSocket ของ backend)
 * systemId: broker ของระบบนั้น (เช่น WATER_SUPPLY_SYSTEM_ID) ; null = broker พื้นฐาน ; topic ว่าง = ยังไม่ฟัง
 */
export function useMqttTank(topic: string, systemId: string | null = null) {
  const [data, setData] = useState<TankData | null>(null);
  const [status, setStatus] = useState<ConnStatus>('connecting');
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [history, setHistory] = useState<LevelPoint[]>([]);

  useEffect(() => {
    setStatus('connecting');
    if (!topic) return;
    setData(null);
    setLastUpdate(null);
    setHistory([]);
    return backendBridge.subscribe(
      topic,
      systemId,
      (m) => {
        try {
          const parsed = parseTankData(m.data);
          setData(parsed);
          setStatus('connected');
          setLastUpdate(m.at);
          setHistory((h) => [...h, { t: m.at, cm: parsed.water_level.level_cm, flow: parsed.water_level.flow_rate }].slice(-MAX_HISTORY));
        } catch (e) {
          console.warn('[MQTT] Parse error:', e);
        }
      },
      (st) => setStatus(bridgeConnStatus(st)),
    );
  }, [topic, systemId]);

  return { data, setData, status, lastUpdate, history, setHistory };
}
