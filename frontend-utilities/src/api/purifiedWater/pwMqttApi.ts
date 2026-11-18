import { api } from '@/api';

/**
 * Purified Water — แหล่งข้อมูล MQTT (/api/purified-water/mqtt/*) แทนตัวอ่าน Modbus RS485
 * backend รับค่าตาม topic + field → แปลงด้วย sensor config → บันทึกรายนาที + แจ้งเตือน ; ค่าสดบนหน้าเว็บ: lib/purifiedWater/pwMqttLive
 * สิทธิ์: page:device
 */

const P = '/purified-water/mqtt';

/** backend ไม่ส่งรหัสผ่านกลับมา — ส่งค่านี้แทน ; บันทึกกลับเป็นค่านี้ = ใช้รหัสผ่านเดิม */
export const PW_MQTT_PASSWORD_MASK = '********';

export interface PwMqttBroker {
  url: string;
  username: string;
  password: string;
  enabled: boolean;
}

export interface PwMqttMapping {
  device_name: string;
  metric_name: string;
  /** topic ว่าง = ลบ (ไม่รับค่าจาก MQTT) */
  topic: string;
  /** ตำแหน่งค่าใน payload เช่น "ro1.conduct", "regs.0" ; ว่าง = payload เป็นค่าเดี่ยว */
  field: string;
  enabled?: boolean;
}

export interface PwMqttConfig {
  broker: PwMqttBroker;
  mappings: PwMqttMapping[];
}

export interface PwMqttSensorStatus {
  raw: unknown;
  value: number | null;
  status: string;
  /** no_config | field_missing | not_number */
  error: string | null;
  ageMs: number | null;
}

export interface PwMqttStatus {
  enabled: boolean;
  running: boolean;
  connected: boolean;
  error: string | null;
  topics: string[];
  lastMessageAgeMs: number | null;
  /** key = "device_name/metric_name" */
  sensors: Record<string, PwMqttSensorStatus>;
}

export interface PwMqttField {
  path: string;
  type: 'number' | 'text' | 'registers';
  preview: unknown;
}

export type PwMqttProbeResult =
  | { ok: true; connectedMs: number; topic: string; payload: unknown; fields: PwMqttField[] }
  | { ok: false; stage: 'connect' | 'message'; error: string; connectedMs?: number };

export type PwMqttPreview =
  | { ok: true; raw: unknown; value: number; status: string; unit: string | null }
  | { ok: false; error: string };

export const getPwMqttConfig = (): Promise<PwMqttConfig> => api.get(`${P}/config`).then((r) => r.data);

export const putPwMqttBroker = (broker: PwMqttBroker): Promise<PwMqttBroker> => api.put(`${P}/broker`, broker).then((r) => r.data);

export const putPwMqttMappings = (mappings: PwMqttMapping[]): Promise<{ updated: number }> =>
  api.put(`${P}/mappings`, mappings).then((r) => r.data);

/** รอข้อความแรกของ topic (ไม่ส่ง broker = ใช้ broker ที่บันทึกไว้) */
export const probePwMqtt = (topic: string, broker?: PwMqttBroker, timeoutSec = 10): Promise<PwMqttProbeResult> =>
  api.post(`${P}/probe`, { topic, broker, timeout_sec: timeoutSec }, { timeout: (timeoutSec + 10) * 1000 }).then((r) => r.data);

export const previewPwMqtt = (deviceName: string, metricName: string, raw: unknown): Promise<PwMqttPreview> =>
  api.post(`${P}/preview`, { device_name: deviceName, metric_name: metricName, raw }).then((r) => r.data);

export const getPwMqttStatus = (): Promise<PwMqttStatus> => api.get(`${P}/status`).then((r) => r.data);

export const pwSensorKey = (deviceName: string, metricName: string) => `${deviceName}/${metricName}`;

/** อ่านค่าตาม path แบบเดียวกับ backend (read_field) — ใช้แสดงตัวอย่างจาก payload ที่สแกนได้ */
export function readPayloadPath(payload: unknown, path: string): unknown {
  if (!path) return payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>).value : payload;
  let cur: unknown = payload;
  for (const key of path.split('.')) {
    if (Array.isArray(cur) && /^\d+$/.test(key)) cur = cur[Number(key)];
    else if (cur && typeof cur === 'object') cur = (cur as Record<string, unknown>)[key];
    else return undefined;
    if (cur === undefined || cur === null) return undefined;
  }
  return cur;
}

/** detail ของ error จาก axios (422: { errors: {...} }) และ HTTP status */
export function apiErrorDetail(err: unknown): { errors?: Record<string, string> } | undefined {
  return (err as { response?: { data?: { detail?: { errors?: Record<string, string> } } } })?.response?.data?.detail;
}
export function apiErrorStatus(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status;
}
