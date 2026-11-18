/**
 * การแจ้งเตือนระบบสาธารณูปโภค (ประปา / ไฟฟ้า / บำบัดน้ำเสีย) — โครงสร้างข้อมูลกลาง
 *
 * รูปแบบเดียวกับระบบ SCADA ทั่วไป:
 *   - เซนเซอร์แบบ analog มีขีดจำกัด 4 ระดับ  LL < L < H < HH  (LL/HH = วิกฤต, L/H = เตือน)
 *   - เซนเซอร์แบบ digital แจ้งเตือนเมื่อสถานะ = triggerOn (เช่น ปั๊ม Trip, วาล์วขัดข้อง, ขาดการสื่อสาร)
 *   - deadband กันการแจ้งเตือนกระพริบ, delaySec = ค่าต้องค้างเกินเวลานี้ก่อนแจ้ง
 *
 * ฟิลด์ deviceName / metricName ตั้งให้ตรงกับ AlertRule ของ backend (api/alerts/alertRules.ts)
 * เพื่อให้เปลี่ยนจาก MOCKUP (localStorage) เป็น API จริงได้โดยแก้แค่ repository.ts
 */

export type UtilitySystem = 'water' | 'electrical' | 'wastewater';
export type AlarmSeverity = 'critical' | 'warning' | 'info';
/** HH/H/L/LL = analog · STATE = digital ตรงสถานะแจ้งเตือน · COMM = ขาดการสื่อสาร */
export type AlarmLevel = 'HH' | 'H' | 'L' | 'LL' | 'STATE' | 'COMM';
export type SensorKind = 'analog' | 'digital';

export interface AlarmLimits {
  ll: number | null;
  l: number | null;
  h: number | null;
  hh: number | null;
}

export interface AlarmRule extends AlarmLimits {
  sensorKey: string;
  enabled: boolean;
  deadband: number;
  delaySec: number;
  /** digital: สถานะที่ถือว่าเป็น alarm */
  triggerOn: 0 | 1;
  /** digital: ระดับความรุนแรงเมื่อเกิด alarm */
  stateSeverity: AlarmSeverity;
  notifyWeb: boolean;
  notifyLine: boolean;
  notifyEmail: boolean;
  saveAlarm: boolean;
  /** แจ้งซ้ำทุก n นาทีถ้ายังไม่รับทราบ (0 = ไม่แจ้งซ้ำ) */
  repeatMin: number;
}

export interface AlarmSensorDef {
  key: string; // ไม่ซ้ำภายในระบบ เช่น 'tr1.voltage'
  groupId: string;
  deviceName: string;
  metricName: string;
  deviceTh: string;
  deviceEn: string;
  th: string;
  en: string;
  unit: string;
  dp: number;
  kind: SensorKind;
  /** digital: ข้อความสถานะเมื่อเกิด alarm (เช่น Trip / Fault / Offline) */
  stateTh?: string;
  stateEn?: string;
  /** digital ที่หมายถึงการขาดการสื่อสาร → level COMM */
  comm?: boolean;
  /** ค่าปัจจุบัน (MOCKUP) */
  read?: (ms: number) => number;
  /** ค่าตั้งต้นของกฎ */
  defaults: Partial<Omit<AlarmRule, 'sensorKey'>>;
  /** โอกาสเกิด alarm ต่อวัน (ใช้สร้างข้อมูลจำลองเท่านั้น) */
  mockRate?: number;
}

export interface AlarmGroupDef {
  id: string;
  system: UtilitySystem;
  th: string;
  en: string;
  descTh: string;
  descEn: string;
  icon: 'pond' | 'pump' | 'tank' | 'meter' | 'bolt' | 'transformer' | 'chiller' | 'air' | 'process' | 'panel' | 'quality';
}

export interface UtilityAlarmEvent {
  id: string;
  system: UtilitySystem;
  groupId: string;
  sensorKey: string;
  deviceName: string;
  metricName: string;
  deviceTh: string;
  deviceEn: string;
  th: string;
  en: string;
  unit: string;
  dp: number;
  level: AlarmLevel;
  severity: AlarmSeverity;
  value: number | null;
  limit: number | null;
  startedAt: string;
  endedAt: string | null;
  durationSec: number | null;
  acknowledged: boolean;
  ackBy: string | null;
  ackAt: string | null;
}

export interface NotifyTargets {
  emails: string;
  lineTarget: string;
  quietStart: string; // HH:mm ('' = ไม่ใช้)
  quietEnd: string;
  criticalIgnoresQuiet: boolean;
}

export const LEVEL_SEVERITY: Record<Exclude<AlarmLevel, 'STATE'>, AlarmSeverity> = {
  HH: 'critical',
  LL: 'critical',
  H: 'warning',
  L: 'warning',
  COMM: 'warning',
};
