import type {
  BrokerConfig,
  LevelUnit,
  PumpDrive,
  SensorKey,
  SensorRef,
  TankShape,
  WaterSystemConfig,
  WaterSystemKind,
  WaterSystemPump,
  WaterSystemTank,
} from '@/types/waterSystem.types';

// ตรรกะของถังน้ำ/บ่อเก็บน้ำที่เพิ่มจากหน้าเว็บ — pure ทั้งไฟล์ (ไม่มี React / ไม่แตะ storage / ไม่ต่อ MQTT)

export const MAX_TANKS = 4;
export const MAX_PUMPS = 4;
export const STALE_MS = 15_000;
export const KINDS: WaterSystemKind[] = ['tank', 'pond'];
export const SENSOR_KEYS: SensorKey[] = ['level', 'meterTotal', 'flowRate', 'inletValve'];
export const LEVEL_UNITS: LevelUnit[] = ['cm', 'm', 'mm', 'percent'];
export const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,47}$/;
/** สีน้ำเริ่มต้น (น้ำเงิน) — ต้องตรงกับ DEFAULT_WATER_COLOR ใน lib/tankScene3d.ts */
export const DEFAULT_WATER_COLOR = '#2563eb';
export const isValidColor = (c: unknown): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);

/** ตำแหน่ง/หน่วยที่เสนอให้ตอนเปิดใช้เซ็นเซอร์ (ตรงกับ firmware WaterLevel — แก้ได้ทุกช่อง) */
export const SENSOR_DEFAULTS: Record<SensorKey, { path: string; unit: string }> = {
  level: { path: 'water_level.level_cm', unit: '' },
  meterTotal: { path: 'flow_meter.volumn', unit: 'm³' },
  flowRate: { path: 'flow_meter.flow_rate', unit: 'm³/h' },
  inletValve: { path: 'controls.valve_on', unit: '' },
};

/** รูปทรงกำหนดจากชนิดระบบ: ถังน้ำ = ทรงกระบอกมีฝาปิด, บ่อเก็บน้ำ = ทรงสี่เหลี่ยม (ไม่ให้เลือกเอง) */
export const shapeForKind = (kind: WaterSystemKind): TankShape => (kind === 'tank' ? 'cylinder' : 'rect');

export const defaultTank = (kind: WaterSystemKind, index: number): WaterSystemTank =>
  kind === 'tank'
    ? { name: `ถัง ${index + 1}`, shape: 'cylinder', width_m: 2, length_m: 2, diameter_m: 2, height_m: 2.5, offset_cm: 0 }
    : { name: `บ่อ ${index + 1}`, shape: 'rect', width_m: 4, length_m: 8, diameter_m: 2, height_m: 1.5, offset_cm: 0 };

export const defaultPump = (index: number, drive: PumpDrive = 'inverter'): WaterSystemPump => ({
  name: `ปั๊ม ${index + 1}`,
  drive,
  path: drive === 'inverter' ? `pump${index + 1}` : `controls.pump${index + 1}_on`,
  faultPath: '',
});

/** ค่าตั้งต้น: 1 ใบ (ถัง = ทรงกระบอก, บ่อ = บ่อปูนสี่เหลี่ยม), เปิดเฉพาะเซ็นเซอร์ระดับน้ำ, ไม่มีปั๊ม */
export function newSystem(kind: WaterSystemKind): WaterSystemConfig {
  const now = new Date().toISOString();
  const off = (key: SensorKey): SensorRef => ({ enabled: false, ...SENSOR_DEFAULTS[key] });
  return {
    id: '',
    name: '',
    location: '',
    kind,
    broker: null,
    topic: '',
    tanks: [defaultTank(kind, 0)],
    sensorTank: 0,
    sensors: { level: { ...off('level'), enabled: true }, meterTotal: off('meterTotal'), flowRate: off('flowRate'), inletValve: off('inletValve') },
    levelUnit: 'cm',
    waterColor: DEFAULT_WATER_COLOR,
    pumps: [],
    lowPct: 20,
    highPct: 95,
    createdAt: now,
    updatedAt: now,
  };
}

/* ====================================================================== */
/* อ่านค่าจาก JSON                                                         */
/* ====================================================================== */
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);

export const isValidPath = (path: string) => path.length > 0 && path.split('.').every((p) => p.trim() !== '');

export function readPath(root: unknown, path: string): unknown {
  if (!path) return undefined;
  let cur: unknown = root;
  for (const key of path.split('.')) {
    if (!isObj(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

/** ตัวเลขที่ใช้ได้ (null = ไม่มีค่า / ไม่ใช่ตัวเลข) — boolean ไม่นับเป็นตัวเลข */
export function toNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** สถานะเปิด/ปิด: boolean, ตัวเลข (≠0 = เปิด) หรือข้อความ on/off, open/closed, true/false, run/stop */
export function toBool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v !== 0 : null;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['1', 'on', 'open', 'true', 'run', 'running'].includes(s)) return true;
    if (['0', 'off', 'close', 'closed', 'false', 'stop', 'stopped'].includes(s)) return false;
  }
  return null;
}

export interface ScannedPoint {
  path: string;
  type: 'number' | 'boolean' | 'object';
  /** ค่าปัจจุบัน (object = รายชื่อ key ข้างใน) */
  preview: string;
}

/** สแกนข้อความ 1 ก้อน: ทุกจุดข้อมูลที่เป็นตัวเลข / boolean และก้อนข้อมูลย่อย (ใช้เป็นตัวเลือก "ตำแหน่งของข้อมูล") */
export function scanPayload(raw: unknown, maxDepth = 5): ScannedPoint[] {
  const out: ScannedPoint[] = [];
  const walk = (node: unknown, prefix: string, depth: number) => {
    if (!isObj(node) || depth > maxDepth) return;
    for (const [key, value] of Object.entries(node)) {
      if (key.includes('.')) continue; // path คั่นด้วยจุด จึงอ้างถึง key ที่มีจุดไม่ได้
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof value === 'boolean') out.push({ path, type: 'boolean', preview: String(value) });
      else if (typeof value === 'number' && Number.isFinite(value)) out.push({ path, type: 'number', preview: String(value) });
      else if (isObj(value)) {
        out.push({ path, type: 'object', preview: `{ ${Object.keys(value).slice(0, 6).join(', ')} }` });
        walk(value, path, depth + 1);
      }
    }
  };
  walk(raw, '', 1);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** เดาตำแหน่งค่าระดับน้ำจากผลสแกน (ชื่อมี level ก่อน) — ไม่พบคืน '' ให้ผู้ใช้เลือกเอง */
export function guessLevelPath(points: ScannedPoint[]): string {
  const nums = points.filter((p) => p.type === 'number');
  const pick = (re: RegExp) => nums.find((p) => re.test(p.path))?.path;
  return pick(/level_cm$/i) ?? pick(/level/i) ?? '';
}

export interface PumpReading {
  /** พบข้อมูลของปั๊มที่ตำแหน่งที่ตั้งไว้หรือไม่ */
  found: boolean;
  running: boolean;
  fault: boolean;
  /** เฉพาะเมื่อ path ชี้ไปที่ก้อนข้อมูลที่มีค่าเหล่านี้ (null = ไม่มีค่า) */
  freq: number | null;
  current: number | null;
  commOk: boolean | null;
}

export interface SystemReading {
  /** ค่าดิบจากเซ็นเซอร์ระดับ (หน่วยตาม levelUnit) — null = ปิดอยู่ หรือไม่พบค่าที่ตำแหน่งนั้น */
  levelRaw: number | null;
  meterTotal: number | null;
  flowRate: number | null;
  valveOn: boolean | null;
  pumps: PumpReading[];
}

function readPump(pump: WaterSystemPump, raw: unknown): PumpReading {
  const node = readPath(raw, pump.path);
  const extFault = pump.faultPath ? toBool(readPath(raw, pump.faultPath)) : null;
  if (isObj(node)) {
    const running = toBool(node.running ?? node.run ?? node.on);
    return {
      found: true,
      running: running ?? false,
      fault: Boolean(extFault) || [node.alarm, node.fault, node.overload, node.trip].some((v) => toBool(v) === true),
      freq: toNum(node.freq ?? node.frequency ?? node.hz),
      current: toNum(node.current ?? node.amp),
      commOk: toBool(node.modbus_ok ?? node.comm_ok),
    };
  }
  const running = toBool(node);
  return { found: running !== null, running: running ?? false, fault: Boolean(extFault), freq: null, current: null, commOk: null };
}

export function readSystem(cfg: WaterSystemConfig, raw: unknown): SystemReading {
  const s = cfg.sensors;
  return {
    levelRaw: s.level.enabled ? toNum(readPath(raw, s.level.path)) : null,
    meterTotal: s.meterTotal.enabled ? toNum(readPath(raw, s.meterTotal.path)) : null,
    flowRate: s.flowRate.enabled ? toNum(readPath(raw, s.flowRate.path)) : null,
    valveOn: s.inletValve.enabled ? toBool(readPath(raw, s.inletValve.path)) : null,
    pumps: cfg.pumps.map((p) => readPump(p, raw)),
  };
}

/* ====================================================================== */
/* ปริมาตร / ระดับน้ำ                                                       */
/* ====================================================================== */
export const tankArea = (t: WaterSystemTank) => (t.shape === 'cylinder' ? Math.PI * (t.diameter_m / 2) ** 2 : t.width_m * t.length_m);

/** ค่าจากเซ็นเซอร์ → ความลึกน้ำ (ซม.) ที่ใบซึ่งติดตั้งเซ็นเซอร์ */
export function levelToCm(cfg: WaterSystemConfig, value: number): number {
  if (cfg.levelUnit === 'm') return value * 100;
  if (cfg.levelUnit === 'mm') return value / 10;
  if (cfg.levelUnit === 'percent') return (value / 100) * (cfg.tanks[cfg.sensorTank]?.height_m ?? 0) * 100;
  return value;
}

export interface TankCalc {
  level_cm: number;
  height_cm: number;
  volume_l: number;
  capacity_l: number;
  percent: number;
}
export interface SystemCalc {
  tanks: TankCalc[];
  total: { volume_l: number; capacity_l: number; percent: number };
}

/**
 * ระดับ/ปริมาตรของทุกใบจากเซ็นเซอร์ตัวเดียว (เชื่อมถึงกัน = ผิวน้ำระดับเดียวกัน)
 * ความลึกในใบ i = ความลึกที่ใบเซ็นเซอร์ + (offset ของใบ i − offset ของใบเซ็นเซอร์) แล้วจำกัดไว้ที่ 0…ความสูง
 * (สูตรเดียวกับ lib/tankCalculations.ts ของบ่อน้ำประปาโรงงาน แต่รองรับ N ใบและทรงกระบอก)
 */
export function calcSystem(cfg: WaterSystemConfig, sensorCm: number): SystemCalc {
  const sensorOffset = cfg.tanks[cfg.sensorTank]?.offset_cm ?? 0;
  const tanks = cfg.tanks.map((t): TankCalc => {
    const height_cm = t.height_m * 100;
    const level_cm = Math.max(0, Math.min(height_cm, sensorCm + t.offset_cm - sensorOffset));
    const area = tankArea(t);
    const volume_l = area * level_cm * 10; // m² × cm × 10 = ลิตร
    const capacity_l = area * t.height_m * 1000;
    return { level_cm, height_cm, volume_l, capacity_l, percent: capacity_l > 0 ? Math.min(100, (volume_l / capacity_l) * 100) : 0 };
  });
  const volume_l = tanks.reduce((a, t) => a + t.volume_l, 0);
  const capacity_l = tanks.reduce((a, t) => a + t.capacity_l, 0);
  return { tanks, total: { volume_l, capacity_l, percent: capacity_l > 0 ? Math.min(100, (volume_l / capacity_l) * 100) : 0 } };
}

export const capacityM3 = (cfg: WaterSystemConfig) => cfg.tanks.reduce((a, t) => a + tankArea(t) * t.height_m, 0);

/* ====================================================================== */
/* สถานะรวม                                                                */
/* ====================================================================== */
export type SystemStatus = 'normal' | 'low' | 'high' | 'alarm' | 'offline' | 'connecting' | 'no-sensor';

export interface SystemState {
  status: SystemStatus;
  /** ข้อมูลยังสดอยู่ (มีข้อความใหม่ภายใน STALE_MS) */
  live: boolean;
  reading: SystemReading | null;
  /** null = ปิดเซ็นเซอร์ระดับ หรือยังไม่มีค่า */
  calc: SystemCalc | null;
  levelCm: number | null;
  faultPumps: number;
}

export function evaluateSystem(cfg: WaterSystemConfig, snap: { status: 'connecting' | 'connected' | 'offline'; raw: unknown; at: number | null } | undefined, now: number): SystemState {
  const empty = { reading: null, calc: null, levelCm: null, faultPumps: 0, live: false };
  if (!cfg.topic) return { ...empty, status: 'no-sensor' };
  if (!snap || snap.at === null || snap.raw === undefined) return { ...empty, status: snap?.status === 'offline' ? 'offline' : 'connecting' };

  const reading = readSystem(cfg, snap.raw);
  // ไม่พบค่าระดับ → ไม่เดาเป็น 0 (จะไม่ขึ้น "ระดับต่ำ" ผิด ๆ)
  const levelCm = reading.levelRaw !== null ? levelToCm(cfg, reading.levelRaw) : null;
  const calc = levelCm !== null ? calcSystem(cfg, levelCm) : null;
  const faultPumps = reading.pumps.filter((p) => p.fault).length;
  const live = now - snap.at <= STALE_MS;

  let status: SystemStatus = 'normal';
  if (!live) status = 'offline';
  else if (faultPumps > 0) status = 'alarm';
  else if (calc && calc.total.percent < cfg.lowPct) status = 'low';
  else if (calc && calc.total.percent > cfg.highPct) status = 'high';
  return { status, live, reading, calc, levelCm, faultPumps };
}

/* ====================================================================== */
/* ตรวจ / ซ่อมข้อมูล                                                        */
/* ====================================================================== */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

export function uniqueId(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const root = base || 'system';
  if (!used.has(root)) return root;
  for (let i = 2; ; i++) if (!used.has(`${root}-${i}`)) return `${root}-${i}`;
}

/** topic ที่ใช้ subscribe ได้: ไม่ว่าง ไม่มีช่องว่าง ไม่มี wildcard (# +) */
export const isValidTopic = (topic: string) => topic.length > 0 && topic.length <= 200 && !/[\s#+]/.test(topic) && !topic.startsWith('/') && !topic.endsWith('/');
/** เบราว์เซอร์ต่อ MQTT ได้ผ่าน WebSocket เท่านั้น */
export const isValidBrokerUrl = (url: string) => /^wss?:\/\/[^\s/]+/i.test(url);

const posNum = (v: unknown, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const anyNum = (v: unknown, fallback: number) => {
  const n = v === null || v === undefined || v === '' ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** คืน null เมื่อข้อมูลขาดสิ่งจำเป็น (id / ชื่อ) จนใช้ไม่ได้ ; ค่าที่หาย/ผิดรูปเติมจากค่าตั้งต้นของชนิดนั้น */
export function normalizeSystem(input: unknown): WaterSystemConfig | null {
  if (!isObj(input)) return null;
  const id = text(input.id).toLowerCase();
  const name = text(input.name);
  if (!ID_PATTERN.test(id) || !name) return null;
  const kind: WaterSystemKind = input.kind === 'pond' ? 'pond' : 'tank';
  const base = newSystem(kind);

  const tanks = (Array.isArray(input.tanks) ? input.tanks : []).filter(isObj).slice(0, MAX_TANKS).map((t, i): WaterSystemTank => {
    const d = defaultTank(kind, i);
    return {
      name: text(t.name) || d.name,
      shape: shapeForKind(kind),
      width_m: posNum(t.width_m, d.width_m),
      length_m: posNum(t.length_m, d.length_m),
      diameter_m: posNum(t.diameter_m, d.diameter_m),
      height_m: posNum(t.height_m, d.height_m),
      offset_cm: i === 0 ? 0 : anyNum(t.offset_cm, 0),
    };
  });
  if (tanks.length === 0) tanks.push(...base.tanks);

  const pumps = (Array.isArray(input.pumps) ? input.pumps : []).filter(isObj).slice(0, MAX_PUMPS).map((p, i): WaterSystemPump => {
    const drive: PumpDrive = p.drive === 'magnetic' ? 'magnetic' : 'inverter';
    const d = defaultPump(i, drive);
    return { name: text(p.name) || d.name, drive, path: text(p.path) || d.path, faultPath: text(p.faultPath) };
  });

  const rawSensors = isObj(input.sensors) ? input.sensors : {};
  const sensor = (key: SensorKey): SensorRef => {
    const s = isObj(rawSensors[key]) ? (rawSensors[key] as Obj) : {};
    return { enabled: typeof s.enabled === 'boolean' ? s.enabled : base.sensors[key].enabled, path: text(s.path) || SENSOR_DEFAULTS[key].path, unit: typeof s.unit === 'string' ? s.unit.trim() : SENSOR_DEFAULTS[key].unit };
  };

  const b = isObj(input.broker) ? input.broker : null;
  const broker: BrokerConfig | null = b && text(b.url) ? { url: text(b.url), username: text(b.username), password: typeof b.password === 'string' ? b.password : '' } : null;
  const sensorTank = Math.round(anyNum(input.sensorTank, 0));
  const lowPct = Math.min(100, Math.max(0, anyNum(input.lowPct, base.lowPct)));
  const highPct = Math.min(100, Math.max(0, anyNum(input.highPct, base.highPct)));

  return {
    id,
    name,
    location: text(input.location),
    kind,
    broker,
    topic: text(input.topic),
    tanks,
    sensorTank: sensorTank >= 0 && sensorTank < tanks.length ? sensorTank : 0,
    sensors: { level: sensor('level'), meterTotal: sensor('meterTotal'), flowRate: sensor('flowRate'), inletValve: sensor('inletValve') },
    levelUnit: LEVEL_UNITS.includes(input.levelUnit as LevelUnit) ? (input.levelUnit as LevelUnit) : 'cm',
    waterColor: isValidColor(input.waterColor) ? input.waterColor.toLowerCase() : DEFAULT_WATER_COLOR,
    pumps,
    lowPct: lowPct < highPct ? lowPct : base.lowPct,
    highPct: lowPct < highPct ? highPct : base.highPct,
    createdAt: text(input.createdAt) || base.createdAt,
    updatedAt: text(input.updatedAt) || base.updatedAt,
  };
}

export type SystemField = 'name' | 'broker' | 'topic' | 'tanks' | 'sensors' | 'pumps' | 'limits';
export type SystemErrors = Partial<Record<SystemField, string>>;

/** ตรวจก่อนบันทึก — ค่าที่คืนคือ key ของข้อความ (water_systems.error.*) */
export function validateSystem(cfg: WaterSystemConfig): SystemErrors {
  const errors: SystemErrors = {};
  if (!cfg.name.trim()) errors.name = 'name_required';
  if (cfg.broker && !isValidBrokerUrl(cfg.broker.url)) errors.broker = 'broker_invalid';
  if (!cfg.topic) errors.topic = 'topic_required';
  else if (!isValidTopic(cfg.topic)) errors.topic = 'topic_invalid';
  if (cfg.tanks.length < 1 || cfg.tanks.length > MAX_TANKS) errors.tanks = 'tanks_count';
  else if (cfg.tanks.some((t) => !(t.height_m > 0) || !(tankArea(t) > 0) || !Number.isFinite(t.offset_cm) || !t.name.trim())) errors.tanks = 'tanks_invalid';
  // เซ็นเซอร์ที่เปิดใช้ต้องระบุตำแหน่งของข้อมูล
  if (SENSOR_KEYS.some((k) => cfg.sensors[k].enabled && !isValidPath(cfg.sensors[k].path))) errors.sensors = 'sensor_path_required';
  if (cfg.pumps.length > MAX_PUMPS || cfg.pumps.some((p) => !p.name.trim())) errors.pumps = 'pump_name_required';
  else if (cfg.pumps.some((p) => !isValidPath(p.path) || (p.faultPath !== '' && !isValidPath(p.faultPath)))) errors.pumps = 'pump_path_required';
  if (!(cfg.lowPct >= 0 && cfg.highPct <= 100 && cfg.lowPct < cfg.highPct)) errors.limits = 'limits_invalid';
  return errors;
}
