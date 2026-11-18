import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConnStatus, TankData, WaterControllerConfigs, WaterControllerSettings } from '@/types/waterSupply.types';
import { bridgeConnStatus, parseTankData } from '@/hooks/useMqttTank';
import { backendBridge } from '@/lib/mqtt/backendBridge';

/**
 * เชื่อมต่อ MQTT สำหรับหน้าควบคุม/ตั้งค่า (ใช้ topic ตาม firmware WaterLevel/src/main.cpp)
 *  - <base>            : telemetry (เหมือน <base>/data)
 *  - <base>/settings   : ค่าตั้งปัจจุบัน (retained) — ใช้ยืนยันว่าคำสั่งถูกนำไปใช้จริง
 *  - <base>/configs    : ข้อมูลระบบ/Modbus/power (retained)
 *  - <base>/set        : ส่งคำสั่ง/ค่าตั้งเป็น JSON
 */
export interface SendResult {
  ok: boolean;
  /** key ที่อุปกรณ์ยืนยันค่าแล้ว (ค่าจาก /settings ตรงกับที่ส่ง) */
  confirmed: string[];
  /** key ที่อุปกรณ์ปรับค่า (เช่น ถูกจำกัดช่วง) → [ส่ง, ค่าที่อุปกรณ์ใช้จริง] */
  adjusted: Record<string, [unknown, unknown]>;
  /** key ที่ยังไม่ได้รับการยืนยันภายในเวลาที่กำหนด */
  pending: string[];
  error?: string;
}

const num = (v: unknown) => (v === undefined || v === null || v === '' ? NaN : Number(v));

function parseSettings(raw: Record<string, unknown>): WaterControllerSettings {
  const b = (k: string) => Boolean(raw[k]);
  const n = (k: string) => num(raw[k]);
  return {
    valve_on_cm: n('valve_on_cm'),
    tank_capacity: n('tank_capacity'),
    valve_period_sec: n('valve_period_sec'),
    alert_min_cm: n('alert_min_cm'),
    alert_max_cm: n('alert_max_cm'),
    alert_period_sec: n('alert_period_sec'),
    lower_limit_cm: n('lower_limit_cm'),
    auto_mode: b('auto_mode'),
    auto_pump1: b('auto_pump1'),
    auto_pump2: b('auto_pump2'),
    manual_pump1: b('manual_pump1'),
    manual_pump2: b('manual_pump2'),
    manual_valve: b('manual_valve'),
    manual_speed_pump1: n('manual_speed_pump1'),
    manual_speed_pump2: n('manual_speed_pump2'),
    pid_kp: n('pid_kp'),
    pid_ki: n('pid_ki'),
    acc_dec: n('acc_dec'),
    set_pressure: n('set_pressure'),
    sleep_freq: n('sleep_freq'),
    sleep_delay_sec: n('sleep_delay_sec'),
    sensor_type_switch: b('sensor_type_switch'),
  };
}

/** ค่าที่ส่งตรงกับค่าที่อุปกรณ์รายงานกลับหรือไม่ (ตัวเลขยอมคลาดเคลื่อนจากการปัดทศนิยม) */
function same(sent: unknown, got: unknown) {
  if (typeof sent === 'number') return Math.abs(sent - Number(got)) < 0.051;
  return sent === got;
}

/** หน้าควบคุม/ตั้งค่า: รับ/ส่งผ่าน WebSocket ของ backend — ส่งคำสั่งได้เฉพาะ admin (ตรวจที่ backend) */
export function useWaterControl(base: string, opts: { enabled: boolean; systemId?: string | null }) {
  const systemId = opts.systemId ?? null;
  const [status, setStatus] = useState<ConnStatus>('connecting');
  const [data, setData] = useState<TankData | null>(null);
  const [settings, setSettings] = useState<WaterControllerSettings | null>(null);
  const [configs, setConfigs] = useState<WaterControllerConfigs | null>(null);
  const [lastData, setLastData] = useState<number | null>(null);
  const [lastSettings, setLastSettings] = useState<number | null>(null);
  // ฟังก์ชัน publish — cb(error?) เมื่อ broker รับแล้ว
  const publishRef = useRef<((payload: Record<string, unknown>, cb: (err?: string) => void) => void) | null>(null);
  const settingsRef = useRef<WaterControllerSettings | null>(null);
  const waiters = useRef<Set<(s: WaterControllerSettings) => void>>(new Set());

  // ส่งข้อความที่ได้รับ (ไม่ว่าจากช่องทางไหน) เข้า state เดียวกัน
  const handleMessage = useCallback(
    (topic: string, raw: Record<string, unknown>) => {
      const now = Date.now();
      if (topic === base) {
        setData(parseTankData(raw));
        setLastData(now);
      } else if (topic === `${base}/settings`) {
        const s = parseSettings(raw);
        settingsRef.current = s;
        setSettings(s);
        setLastSettings(now);
        waiters.current.forEach((w) => w(s));
      } else if (topic === `${base}/configs`) {
        setConfigs(raw as unknown as WaterControllerConfigs);
      }
    },
    [base]
  );

  useEffect(() => {
    if (!opts.enabled || !base) {
      setStatus('offline');
      return;
    }

    setStatus('connecting');
    const unsubs = [base, `${base}/settings`, `${base}/configs`].map((tp) =>
      backendBridge.subscribe(
        tp,
        systemId,
        (m) => handleMessage(m.topic, m.data),
        (st) => setStatus(bridgeConnStatus(st)),
      ),
    );
    publishRef.current = (payload, cb) => {
      void backendBridge.publish(`${base}/set`, payload, systemId).then((err) => cb(err));
    };
    return () => {
      unsubs.forEach((u) => u());
      publishRef.current = null;
    };
  }, [base, systemId, opts.enabled, handleMessage]);

  /**
   * ส่งคำสั่งไป <base>/set (QoS 1) แล้วรอ /settings ใหม่จากอุปกรณ์เพื่อยืนยันค่า
   * key ที่ไม่มีใน /settings (เช่น restart) จะไม่ถูกนับว่ารอการยืนยัน
   */
  const send = useCallback(
    (cmd: Record<string, unknown>, timeoutMs = 6000): Promise<SendResult> =>
      new Promise((resolve) => {
        const publish = publishRef.current;
        if (!publish || status !== 'connected') {
          resolve({ ok: false, confirmed: [], adjusted: {}, pending: Object.keys(cmd), error: 'not_connected' });
          return;
        }
        const before = settingsRef.current ? ({ ...settingsRef.current } as unknown as Record<string, unknown>) : null;
        const tracked = Object.keys(cmd).filter((k) => before && k in before);
        let done = false;
        const finish = (s: WaterControllerSettings | null, timedOut: boolean) => {
          if (done) return;
          const confirmed: string[] = [];
          const adjusted: Record<string, [unknown, unknown]> = {};
          const pending: string[] = [];
          tracked.forEach((k) => {
            const got = s ? (s as unknown as Record<string, unknown>)[k] : undefined;
            if (got === undefined) pending.push(k);
            else if (same(cmd[k], got)) confirmed.push(k);
            // ค่ายังเท่าเดิม = อาจเป็น /settings รอบเก่าที่มาก่อนอุปกรณ์ประมวลผล → รอต่อ
            else if (before && same(before[k], got)) pending.push(k);
            else adjusted[k] = [cmd[k], got];
          });
          if (!timedOut && pending.length > 0) return;
          done = true;
          waiters.current.delete(onSettings);
          clearTimeout(timer);
          resolve({ ok: true, confirmed, adjusted, pending });
        };
        const onSettings = (s: WaterControllerSettings) => finish(s, false);
        const timer = setTimeout(() => finish(settingsRef.current, true), timeoutMs);
        waiters.current.add(onSettings);
        publish(cmd, (err) => {
          if (err) {
            done = true;
            waiters.current.delete(onSettings);
            clearTimeout(timer);
            resolve({ ok: false, confirmed: [], adjusted: {}, pending: tracked, error: err });
          } else if (tracked.length === 0) {
            done = true;
            waiters.current.delete(onSettings);
            clearTimeout(timer);
            resolve({ ok: true, confirmed: [], adjusted: {}, pending: [] });
          }
        });
      }),
    [status]
  );

  return { status, data, settings, configs, lastData, lastSettings, send };
}
