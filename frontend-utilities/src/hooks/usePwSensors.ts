import { useCallback, useEffect, useState } from 'react';
import { getAlertRules, getSensorConfigs, type AlertRule, type SensorConfig } from '@/api';
import { subscribePwLive } from '@/lib/purifiedWater/pwMqttLive';
import type { ConnStatus } from '@/types/waterSupply.types';

/**
 * ข้อมูลเซ็นเซอร์ระบบ Purified Water จาก MQTT (lib/purifiedWater/pwMqttLive) + ค่าตั้ง (sensor configs / alert rules) จาก backend
 * ใช้ร่วมกันทั้งหน้า Purified Water และการ์ด "ถังเก็บน้ำ PW" ในหน้าภาพรวมระบบน้ำ
 * - ค่าที่ปรับแล้ว (msg.data.adjusted) มีลำดับความสำคัญสูงกว่าค่าดิบ (เหมือนหน้า PW เดิม)
 * - สถานะของแต่ละค่า: สถานะจาก backend (NO_SIGNAL / UNDER_RANGE / OVER_RANGE / ERROR) ก่อน แล้วจึงเทียบเกณฑ์ alert rule / config
 */
export type PwSensorStatus = 'normal' | 'warning' | 'under_range' | 'over_range' | 'no_signal' | 'inactive';

const CONFIG_REFRESH_MS = 15_000;
/** ข้อมูลเกินเวลานี้ถือว่าค้าง (เหมือนระบบน้ำประปา) */
export const PW_STALE_MS = 15_000;

type CfgMap = Record<string, Record<string, SensorConfig>>;
type RuleMap = Record<string, Record<string, AlertRule>>;

export function usePwSensors() {
  const [values, setValues] = useState<Record<string, number>>({});
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [seen, setSeen] = useState<Set<string>>(() => new Set());
  const [configs, setConfigs] = useState<CfgMap>({});
  const [rules, setRules] = useState<RuleMap>({});
  const [configsLoaded, setConfigsLoaded] = useState(false);
  const [status, setStatus] = useState<ConnStatus>('connecting');
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);

  const loadConfigs = useCallback(() => {
    Promise.all([getSensorConfigs(), getAlertRules().catch(() => [] as AlertRule[])])
      .then(([cfgs, rs]) => {
        const c: CfgMap = {};
        cfgs.forEach((x) => ((c[x.device_name] ??= {})[x.metric_name] = x));
        const r: RuleMap = {};
        rs.forEach((x) => ((r[x.device_name] ??= {})[x.metric_name] = x));
        setConfigs(c);
        setRules(r);
      })
      .catch((err) => console.warn('[pw-sensors] load configs failed:', err))
      .finally(() => setConfigsLoaded(true));
  }, []);

  useEffect(() => {
    loadConfigs();
    const id = setInterval(loadConfigs, CONFIG_REFRESH_MS);
    return () => clearInterval(id);
  }, [loadConfigs]);

  useEffect(
    () =>
      subscribePwLive(
        (msg) => {
          const flat: Record<string, number> = {};
          for (const dev of Object.values(msg.data)) {
            if (dev && typeof dev === 'object') {
              for (const [k, v] of Object.entries(dev)) {
                const n = Number(v);
                if (v !== null && v !== '' && Number.isFinite(n)) flat[k] = n;
              }
            }
          }
          setValues((prev) => ({ ...prev, ...flat }));
          setStatuses((prev) => ({ ...prev, ...msg.statuses }));
          setSeen((prev) => {
            const keys = Object.keys(flat).filter((k) => !prev.has(k));
            if (!keys.length) return prev;
            const next = new Set(prev);
            keys.forEach((k) => next.add(k));
            return next;
          });
          setLastUpdate(Date.now());
        },
        setStatus,
      ),
    [],
  );

  const value = useCallback((metric: string): number | null => (metric in values ? values[metric] : null), [values]);
  const has = useCallback((metric: string) => seen.has(metric), [seen]);
  const unit = useCallback((device: string, metric: string, fallback = '') => configs[device]?.[metric]?.unit ?? fallback, [configs]);
  const decimals = useCallback(
    (device: string, metric: string, fallback = 2) => {
      const d = configs[device]?.[metric]?.decimal_places;
      return typeof d === 'number' ? d : fallback;
    },
    [configs]
  );
  /** เกณฑ์เตือน: alert rule ก่อน แล้วจึงค่าใน sensor config */
  const limits = useCallback(
    (device: string, metric: string) => {
      const r = rules[device]?.[metric];
      const c = configs[device]?.[metric];
      return { min: r?.threshold_min ?? c?.alert_min ?? null, max: r?.threshold_max ?? c?.alert_max ?? null };
    },
    [rules, configs]
  );
  const sensorStatus = useCallback(
    (device: string, metric: string): PwSensorStatus => {
      const raw = statuses[metric];
      if (raw && raw !== 'OK') {
        if (raw === 'NO_SIGNAL') return 'no_signal';
        if (raw === 'UNDER_RANGE') return 'under_range';
        if (raw === 'OVER_RANGE') return 'over_range';
        if (raw === 'ERROR') return 'inactive';
      }
      const v = metric in values ? values[metric] : undefined;
      if (v === undefined) return 'normal';
      const { min, max } = limits(device, metric);
      if (min !== null && v < min) return 'warning';
      if (max !== null && v > max) return 'warning';
      return 'normal';
    },
    [statuses, values, limits]
  );

  return { values, value, has, unit, decimals, limits, sensorStatus, configs, configsLoaded, status, lastUpdate };
}

export type PwSensors = ReturnType<typeof usePwSensors>;
