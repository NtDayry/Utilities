/**
 * ที่เก็บการตั้งค่าการแจ้งเตือน + การรับทราบ alarm
 *
 * - กฎ (rules) และผู้รับแจ้ง (targets): backend /api/utilities/alarms/{system}/{rules|targets} — ทุกเครื่องเห็นค่าเดียวกัน
 *   ค่าเดิมที่เคยเก็บใน localStorage ของเบราว์เซอร์: admin เปิดหน้าครั้งแรกแล้ว backend ยังไม่มีค่า → ย้ายขึ้น backend ให้
 * - การรับทราบ: เหตุการณ์จริงจาก backend รับทราบผ่าน API (ackUtilityAlarmEvents) ;
 *   เหตุการณ์จำลอง (mockEvents — ส่วนที่ยังไม่มีข้อมูลจริง) เก็บการรับทราบใน localStorage เหมือนเดิม
 */
import { getAlarmRules, getAlarmTargets, putAlarmRules, putAlarmTargets } from '@/api/utilities/utilitiesApi';
import { defaultRule, getCatalog } from './catalog';
import type { AlarmRule, NotifyTargets, UtilitySystem } from './types';

const LEGACY_RULES_KEY = (s: UtilitySystem) => `utility-alarm-rules:v1:${s}`;
const LEGACY_TARGETS_KEY = (s: UtilitySystem) => `utility-alarm-targets:v1:${s}`;
const ACK_KEY = 'utility-alarm-ack:v1';

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn('utility alarms: cannot write localStorage', e);
  }
}
const isEmpty = (o: object | null | undefined) => !o || Object.keys(o).length === 0;

export type RuleMap = Record<string, AlarmRule>;

/** กฎทุกตัวของระบบ = ค่าตั้งต้นจาก catalog ทับด้วยค่าที่บันทึกไว้ (เซนเซอร์ใหม่ได้ค่าตั้งต้นอัตโนมัติ) */
function mergeRules(system: UtilitySystem, saved: Partial<RuleMap>): RuleMap {
  const out: RuleMap = {};
  for (const s of getCatalog(system).sensors) out[s.key] = { ...defaultRule(s), ...(saved[s.key] ?? {}), sensorKey: s.key };
  return out;
}

export function defaultRules(system: UtilitySystem): RuleMap {
  const out: RuleMap = {};
  for (const s of getCatalog(system).sensors) out[s.key] = defaultRule(s);
  return out;
}

/** โหลดกฎจาก backend (canMigrate = admin: ย้ายค่าเดิมจาก localStorage ถ้า backend ยังไม่มี) */
export async function loadRules(system: UtilitySystem, canMigrate = false): Promise<RuleMap> {
  let saved = (await getAlarmRules(system)) as Partial<RuleMap>;
  const legacy = readJson<Partial<RuleMap>>(LEGACY_RULES_KEY(system));
  if (isEmpty(saved) && !isEmpty(legacy) && canMigrate) {
    const merged = mergeRules(system, legacy!);
    await putAlarmRules(system, merged);
    localStorage.removeItem(LEGACY_RULES_KEY(system));
    saved = merged;
  }
  return mergeRules(system, saved);
}

export async function saveRules(system: UtilitySystem, rules: RuleMap): Promise<void> {
  await putAlarmRules(system, rules);
}

export const DEFAULT_TARGETS: NotifyTargets = {
  emails: '',
  lineTarget: '',
  quietStart: '',
  quietEnd: '',
  criticalIgnoresQuiet: true,
};

export async function loadTargets(system: UtilitySystem, canMigrate = false): Promise<NotifyTargets> {
  let saved = (await getAlarmTargets(system)) as Partial<NotifyTargets>;
  const legacy = readJson<Partial<NotifyTargets>>(LEGACY_TARGETS_KEY(system));
  if (isEmpty(saved) && !isEmpty(legacy) && canMigrate) {
    const merged = { ...DEFAULT_TARGETS, ...legacy };
    await putAlarmTargets(system, merged);
    localStorage.removeItem(LEGACY_TARGETS_KEY(system));
    saved = merged;
  }
  return { ...DEFAULT_TARGETS, ...saved };
}
export async function saveTargets(system: UtilitySystem, t: NotifyTargets): Promise<void> {
  await putAlarmTargets(system, t);
}

/** การรับทราบของเหตุการณ์จำลองเท่านั้น (เหตุการณ์จริงใช้ค่า acknowledged/ackBy จาก backend) */
export type AckMap = Record<string, { by: string; at: string }>;
export const loadAcks = (): AckMap => readJson<AckMap>(ACK_KEY) ?? {};
export function saveAcks(ids: string[], by: string) {
  const acks = loadAcks();
  const at = new Date().toISOString();
  for (const id of ids) acks[id] = { by, at };
  writeJson(ACK_KEY, acks);
  return acks;
}
