import type { AlarmLevel, AlarmRule, AlarmSensorDef, AlarmSeverity } from './types';
import { LEVEL_SEVERITY } from './types';

export interface LiveState {
  level: AlarmLevel | null;
  severity: AlarmSeverity | null;
}

/** สถานะของค่าปัจจุบันเทียบกับกฎ (ไม่คิด delay/deadband — ใช้แสดงผลในหน้าตั้งค่า) */
export function evaluate(s: AlarmSensorDef, r: AlarmRule, v: number | null | undefined): LiveState {
  if (!r.enabled || v === null || v === undefined || Number.isNaN(v)) return { level: null, severity: null };
  if (s.kind === 'digital') {
    if (v !== r.triggerOn) return { level: null, severity: null };
    return s.comm ? { level: 'COMM', severity: LEVEL_SEVERITY.COMM } : { level: 'STATE', severity: r.stateSeverity };
  }
  if (r.hh !== null && v >= r.hh) return { level: 'HH', severity: 'critical' };
  if (r.ll !== null && v <= r.ll) return { level: 'LL', severity: 'critical' };
  if (r.h !== null && v >= r.h) return { level: 'H', severity: 'warning' };
  if (r.l !== null && v <= r.l) return { level: 'L', severity: 'warning' };
  return { level: null, severity: null };
}

/** ตรวจลำดับขีดจำกัด LL < L < H < HH (ข้ามค่าที่ไม่ได้ใช้) → คืน field ที่ผิด */
export function invalidLimits(r: AlarmRule): (keyof Pick<AlarmRule, 'll' | 'l' | 'h' | 'hh'>)[] {
  const order = (['ll', 'l', 'h', 'hh'] as const).filter((k) => r[k] !== null);
  const bad = new Set<'ll' | 'l' | 'h' | 'hh'>();
  for (let i = 1; i < order.length; i++) {
    const a = r[order[i - 1]] as number;
    const b = r[order[i]] as number;
    if (!(a < b)) {
      bad.add(order[i - 1]);
      bad.add(order[i]);
    }
  }
  return [...bad];
}
