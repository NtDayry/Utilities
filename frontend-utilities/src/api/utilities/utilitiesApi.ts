import { api, API_URL } from '@/api';
import type { BrokerConfig, WaterSystemConfig } from '@/types/waterSystem.types';
import type { AlarmRule, NotifyTargets, UtilityAlarmEvent, UtilitySystem } from '@/lib/utilityAlarms/types';

/**
 * API ส่วน Utilities ของ backend (/api/utilities/*) — ระบบน้ำ, การแจ้งเตือน, การตั้งค่าส่วนกลาง, MQTT
 * สิทธิ์: อ่าน = ผู้ใช้ที่ login ; แก้ = admin / super admin
 */

/** backend ไม่ส่งรหัสผ่าน broker กลับมา — ส่งค่านี้แทน ; บันทึกกลับเป็นค่านี้ = ใช้รหัสผ่านเดิม */
export const BROKER_PASSWORD_MASK = '********';

const U = API_URL.UTILITIES;

// ---------------- ระบบน้ำ ----------------
export const getWaterSystems = (): Promise<WaterSystemConfig[]> => api.get(`${U}/water-systems`).then((r) => r.data);

export const putWaterSystem = (system: WaterSystemConfig): Promise<WaterSystemConfig> =>
  api.put(`${U}/water-systems/${encodeURIComponent(system.id)}`, system).then((r) => r.data);

export const deleteWaterSystem = (id: string): Promise<void> => api.delete(`${U}/water-systems/${encodeURIComponent(id)}`).then(() => undefined);

/** ใส่ถัง/บ่อตั้งต้นของโรงงานครั้งเดียวต่อ id (admin) — คืนรายการทั้งหมดหลังใส่ */
export const seedWaterSystems = (systems: WaterSystemConfig[]): Promise<WaterSystemConfig[]> =>
  api.post(`${U}/water-systems/seed`, systems).then((r) => r.data);

export interface HistoryPoint {
  t: string;
  avg: number | null;
  min: number | null;
  max: number | null;
  n: number;
}
export interface HistoryResponse {
  id: string;
  start: string;
  end: string;
  bucketSec: number;
  source: string;
  series: Record<string, HistoryPoint[]>;
}
export const getWaterSystemHistory = (id: string, params: { metrics: string[]; start?: string; end?: string; bucket?: number }): Promise<HistoryResponse> =>
  api
    .get(`${U}/water-systems/${encodeURIComponent(id)}/history`, { params: { ...params, metrics: params.metrics.join(',') }, timeout: 20_000 })
    .then((r) => r.data);

// ---------------- MQTT ----------------
export interface ProbePoint {
  path: string;
  type: 'number' | 'boolean' | 'object';
  preview: string;
}
export type ProbeResult =
  | { ok: true; connectedMs: number; topic: string; payload: Record<string, unknown>; points: ProbePoint[]; guessedLevelPath: string }
  | { ok: false; stage: 'connect' | 'message'; error: string; connectedMs?: number };

/** ให้ backend เชื่อมต่อ broker แล้วรอข้อความแรกของ topic (ใช้กับ broker ที่กำหนดเอง ตอนเพิ่มระบบ) */
export const probeMqtt = (body: { broker: BrokerConfig | null; topic: string; timeout_sec?: number; system_id?: string }): Promise<ProbeResult> =>
  api.post(`${U}/mqtt/probe`, body, { timeout: ((body.timeout_sec ?? 10) + 10) * 1000 }).then((r) => r.data);

// ---------------- การแจ้งเตือน ----------------
export const getAlarmRules = (system: UtilitySystem): Promise<Partial<Record<string, AlarmRule>>> =>
  api.get(`${U}/alarms/${system}/rules`).then((r) => r.data);
export const putAlarmRules = (system: UtilitySystem, rules: Record<string, AlarmRule>): Promise<void> =>
  api.put(`${U}/alarms/${system}/rules`, rules).then(() => undefined);
export const getAlarmTargets = (system: UtilitySystem): Promise<Partial<NotifyTargets>> =>
  api.get(`${U}/alarms/${system}/targets`).then((r) => r.data);
export const putAlarmTargets = (system: UtilitySystem, targets: NotifyTargets): Promise<void> =>
  api.put(`${U}/alarms/${system}/targets`, targets).then(() => undefined);

export const getUtilityAlarmEvents = (params: {
  system?: UtilitySystem;
  group_id?: string;
  active?: boolean;
  start?: string;
  end?: string;
  limit?: number;
  offset?: number;
}): Promise<{ total: number; items: UtilityAlarmEvent[] }> => api.get(`${U}/alarms/events`, { params }).then((r) => r.data);

export const ackUtilityAlarmEvents = (ids: string[]): Promise<{ updated: number; items: UtilityAlarmEvent[] }> =>
  api.post(`${U}/alarms/events/ack`, { ids }).then((r) => r.data);

// ---------------- การตั้งค่าส่วนกลาง ----------------
export type SharedSettingKey = 'factory-sensors' | 'pump-station-tank';
// ไม่พาไปหน้า login เมื่อ 401 (เรียกตอนเปิดแอปพร้อมกับการ refresh session — ล้มได้โดยไม่รบกวนผู้ใช้)
export const getSharedSettings = (): Promise<Partial<Record<SharedSettingKey, unknown>>> =>
  api.get(`${U}/settings`, { _skipAuthRedirect: true }).then((r) => r.data);
export const putSharedSetting = (key: SharedSettingKey, data: object): Promise<void> => api.put(`${U}/settings/${key}`, data).then(() => undefined);

// ---------------- บ่อน้ำประปาโรงงาน + ระบบปั๊ม (คอนโทรลเลอร์ WaterLevel) ----------------
/** systemId ของ /ws/utilities/mqtt สำหรับคอนโทรลเลอร์ประปา (backend ใช้ topic / broker ที่ตั้งไว้) */
export const WATER_SUPPLY_SYSTEM_ID = '__water_supply__';

export interface WaterSupplySource {
  systemId: string;
  /** topic หลัก: <topic> ข้อมูล, <topic>/settings, <topic>/configs, ส่งคำสั่งไป <topic>/set */
  topic: string;
  /** แสดงผล — broker ที่ backend ใช้ */
  brokerUrl: string;
  /** false = broker พื้นฐานของ backend */
  customBroker: boolean;
}
/** ผู้ใช้ที่ login — ไม่มีชื่อผู้ใช้/รหัสผ่าน broker */
export const getWaterSupplySource = (): Promise<WaterSupplySource> => api.get(`${U}/water-supply/source`).then((r) => r.data);

export interface WaterSupplyMqtt {
  topic: string;
  /** null = broker พื้นฐานของ backend ; password = BROKER_PASSWORD_MASK เมื่อมีรหัสผ่านเดิม */
  broker: BrokerConfig | null;
}
/** admin */
export const getWaterSupplyMqtt = (): Promise<WaterSupplyMqtt> => api.get(`${U}/water-supply/mqtt`).then((r) => r.data);
/** admin — รหัสผ่าน BROKER_PASSWORD_MASK = ใช้รหัสผ่านเดิม */
export const putWaterSupplyMqtt = (cfg: WaterSupplyMqtt): Promise<WaterSupplyMqtt> => api.put(`${U}/water-supply/mqtt`, cfg).then((r) => r.data);
