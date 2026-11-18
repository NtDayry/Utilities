/**
 * แปลงค่า raw ของเซนเซอร์ Purified Water → ค่าจริง
 * พอร์ตตรงจาก backend: app/purified_water/mqtt_ingest.py (convert) + app/purified_water/decoders.py
 * (ซึ่งคัดลอกจาก modbus_service/decoders.py) — แก้สูตรที่ใดต้องแก้ทั้งสองฝั่ง ; ตรวจด้วย tests/parity/pw_convert
 */
export type PwReadingStatus = 'OK' | 'UNDER_RANGE' | 'OVER_RANGE' | 'NO_SIGNAL' | 'ERROR';

export interface PwConvertConfig {
  decode_type: string;
  raw_min?: number | null;
  raw_max?: number | null;
  range_min?: number | null;
  range_max?: number | null;
  decimal_places?: number | null;
}

export interface PwConverted {
  raw: number;
  value: number;
  status: PwReadingStatus;
}

/**
 * ปัดทศนิยมแบบ Python round(x, n): ปัดตามค่าจริงของ float (toFixed คำนวณจากค่าจริง)
 * และกรณีครึ่งพอดีปัดเข้าเลขคู่ (toFixed ปัดออกจากศูนย์)
 */
export function pyRound(x: number, n: number): number {
  const ax = Math.abs(x);
  if (!Number.isFinite(x) || ax >= 1e21) return x;
  const exact = ax.toFixed(Math.min(100, n + 60));
  const [ip, fp = ''] = exact.split('.');
  let r: number;
  if (/^50*$/.test(fp.slice(n))) {
    const kept = n > 0 ? `${ip}.${fp.slice(0, n)}` : ip;
    r = Number(kept.slice(-1)) % 2 === 0 ? Number(kept) : Number(ax.toFixed(n));
  } else {
    r = Number(ax.toFixed(n));
  }
  return x < 0 ? -r : r;
}

const NUM_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

/** ตัวเลขที่ใช้ได้ (boolean ไม่นับ ; ข้อความตัวเลขฐานสิบ) — เหมือน _num() ของ backend */
export function toNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '' && NUM_RE.test(v.trim())) {
    const f = Number(v.trim());
    return Number.isFinite(f) ? f : null;
  }
  return null;
}

function registers(v: unknown): number[] | null {
  if (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 0xffff)) return v as number[];
  return null;
}

const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, '0');

function decodeBcd(regs: number[]): { value: number; status: PwReadingStatus } {
  if (regs.length !== 2) return { value: 0, status: 'ERROR' };
  const s = `${hex4(regs[0])}.${hex4(regs[1])}`;
  return /^\d+\.\d+$/.test(s) ? { value: Number(s), status: 'OK' } : { value: 0, status: 'ERROR' };
}

function decodeFloat32Cdab(regs: number[]): { value: number; status: PwReadingStatus } {
  if (regs.length !== 2) return { value: 0, status: 'ERROR' };
  const dv = new DataView(new ArrayBuffer(4));
  dv.setUint16(0, regs[1]);
  dv.setUint16(2, regs[0]);
  const v = dv.getFloat32(0);
  return Number.isFinite(v) ? { value: v, status: 'OK' } : { value: 0, status: 'ERROR' };
}

function decodeAnalog(raw: number, cfg: PwConvertConfig): { value: number; status: PwReadingStatus } {
  const rawMin = cfg.raw_min ?? 0;
  const rawMax = cfg.raw_max ?? 20000;
  const rangeMin = cfg.range_min ?? 0;
  const rangeMax = cfg.range_max ?? 100;
  const minMa = 4;
  const maxMa = 20;
  if (rawMax <= rawMin || raw <= 0) return { value: rangeMin, status: 'NO_SIGNAL' };
  const currentMa = pyRound((raw * maxMa) / rawMax, 4);
  const status: PwReadingStatus = currentMa < 2 ? 'NO_SIGNAL' : currentMa < 3.8 ? 'UNDER_RANGE' : currentMa > 20.5 ? 'OVER_RANGE' : 'OK';
  const value = rangeMin + ((currentMa - minMa) * (rangeMax - rangeMin)) / (maxMa - minMa);
  return { value: pyRound(value, 4), status };
}

function roundDp(value: number, cfg: PwConvertConfig): number {
  const dp = cfg.decimal_places;
  return dp === null || dp === undefined || !Number.isInteger(Number(dp)) ? value : pyRound(value, Number(dp));
}

/** ค่า raw (ตัวเลข / ข้อความตัวเลข / register [hi, lo]) → ค่าจริง ; null = ใช้ไม่ได้ */
export function convertPwRaw(raw: unknown, cfg: PwConvertConfig): PwConverted | null {
  const decodeType = cfg.decode_type || 'analog_4_20ma';
  const regs = registers(raw);
  if (regs && regs.length === 2 && (decodeType === 'bcd_hex' || decodeType === 'float32_cdab')) {
    if (decodeType === 'bcd_hex') {
      const res = decodeBcd(regs);
      const s = `${hex4(regs[0])}.${hex4(regs[1])}`;
      return { raw: /^\d+\.\d+$/.test(s) ? Number(s) : regs[0], value: roundDp(res.value, cfg), status: res.status };
    }
    const res = decodeFloat32Cdab(regs);
    return { raw: res.status !== 'ERROR' ? res.value : regs[0], value: roundDp(res.value, cfg), status: res.status };
  }
  let r: unknown = raw;
  if (regs && regs.length === 1) r = regs[0];
  const n = toNum(r);
  if (n === null) return null;
  if (decodeType === 'analog_4_20ma') {
    const res = decodeAnalog(n, cfg);
    return { raw: n, value: roundDp(res.value, cfg), status: res.status };
  }
  return { raw: n, value: roundDp(n, cfg), status: 'OK' };
}

/** อ่านค่าตาม path ("a.b", "regs.0") ; path ว่าง = ค่าเดี่ยวของ payload — เหมือน read_field() ของ backend */
export function readPwField(payload: unknown, path: string): unknown {
  if (!path) return payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>).value : payload;
  let cur: unknown = payload;
  for (const key of path.split('.')) {
    if (cur && typeof cur === 'object' && !Array.isArray(cur)) cur = (cur as Record<string, unknown>)[key];
    else if (Array.isArray(cur) && /^\d+$/.test(key) && Number(key) < cur.length) cur = cur[Number(key)];
    else return undefined;
    if (cur === undefined || cur === null) return undefined;
  }
  return cur;
}
