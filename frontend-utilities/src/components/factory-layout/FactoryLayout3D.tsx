import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Clock, Gauge, Pause, RotateCw, Settings } from 'lucide-react';
import { useNavigate } from 'react-router';
import { API_URL } from '@/api/connection/apiURL';
// ข้อมูลอาคารโหลดทันที (ไฟล์เล็ก ไม่มี three.js) ส่วนฉาก 3 มิติโหลดแยกภายหลังเมื่อหน้าเว็บแสดงผลเสร็จ
import { BUILDINGS, N, OBJECTS, ROOMS } from '@/lib/factoryBuildings';
import type { FactorySceneApi } from '@/lib/factoryScene3d';
import { POWER_KW, TR_KVA, TR_PF, TANK, detailFields, hiddenOf, primaryOf, type DetailId, type MeterKey } from '@/lib/factorySensors';
import { useFactorySensorSettings, isAdminRole } from '@/store/factorySensorSettings';
import { useAuthStore } from '@/store/auth';
import { URL } from '@/api';
import { TANK_SITES } from '@/lib/waterTanks';
import { WW_UNITS, wwUnitPath, paramOf, paramTone, type WwUnitKey } from '@/lib/wastewaterUnits';
import { isModelTank, mainFlow, mainMeter, tankFlow, tankLevelPct, tankMeter } from '@/lib/waterTankModel';
import { ELECTRICAL_POINTS, electricalDetailPath, findElectricalPoint, meterAt, readingAt } from '@/lib/electricalPoints';

type ViewKey = 'ov' | 'top' | 'side' | 'gate';
const VIEWS: ViewKey[] = ['ov', 'top', 'side', 'gate'];

const btnOff =
  'bg-gray-50 text-gray-700 border-gray-300 hover:bg-gray-100 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700 dark:hover:bg-slate-700';
const btnOn =
  'bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/80 dark:text-emerald-400 dark:border-emerald-700';

// เวลาของที่ตั้งโรงงาน (Asia/Bangkok) เป็นชั่วโมงทศนิยม จากนาฬิกาที่ปรับเทียบกับเซิร์ฟเวอร์แล้ว
const SITE_TZ = 'Asia/Bangkok';
function siteHours(offsetMs: number) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: SITE_TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(Date.now() + offsetMs));
  const g = (k: string) => Number(parts.find((p) => p.type === k)?.value ?? 0);
  return g('hour') + g('minute') / 60 + g('second') / 3600;
}
// อ่านเวลาเซิร์ฟเวอร์จาก HTTP header "Date" (ไม่ต้องมี endpoint เพิ่ม) แล้วคืนค่าความต่างกับนาฬิกาเครื่อง (ms)
// ใช้ fetch ตรง (ไม่ผ่าน axios interceptor) เพื่อไม่ให้สถานะ 401 พาไปหน้า login
async function fetchServerOffset(): Promise<number> {
  const t0 = Date.now();
  // GET /utilities/health: ไม่ต้อง login และตอบเร็ว (เดิมใช้ HEAD /users/me ซึ่ง backend ไม่รองรับ → 405 ทุกครั้งที่เปิดหน้าแรก)
  const res = await fetch(`${API_URL.BASE_URL}${API_URL.UTILITIES}/health`, { method: 'GET', credentials: 'include', cache: 'no-store' });
  const t1 = Date.now();
  const d = res.headers.get('date');
  const server = d ? Date.parse(d) : NaN;
  if (Number.isNaN(server)) throw new Error('no Date header');
  return server + 500 - (t0 + t1) / 2; // header ละเอียดระดับวินาที → +0.5 วินาที
}

// ===== ค่ามิเตอร์ (MOCKUP) — แทนที่ด้วยข้อมูลจริงได้ที่ useMeterValues() =====
// extra = ค่าละเอียดของเซ็นเซอร์ (แสดงเมื่อคลิกจุดนั้น): มิเตอร์ไฟ/หม้อแปลง kw/v/a/pf/hz, ระบบน้ำ flow/meter/press, PW uv/toc/cond
type ExtraKey = 'kw' | 'v' | 'a' | 'pf' | 'hz' | 'flow' | 'meter' | 'press' | 'uv' | 'toc' | 'cond';   // meter = เลขมิเตอร์น้ำสะสม (m³), uv/toc/cond = คุณภาพน้ำ PW
// alarm = สัญญาณ alarm ของค่าหลัก (true/false จากระบบจริง), extraAlarm = สัญญาณ alarm รายช่องรายละเอียด (true/false จากระบบจริง)
// → ไอคอนบนแผนผังกะพริบแดงเมื่อมี alarm ช่องใดช่องหนึ่ง, ช่องที่ alarm แสดงตัวหนังสือสีแดงในกล่องรายละเอียด
type MeterValue = {
  value: number; unit: string; updatedAt?: string; alarm?: boolean;
  extra?: Partial<Record<ExtraKey, number>>; extraAlarm?: Partial<Record<DetailId, boolean>>;
};
// key: water = มิเตอร์น้ำประปา, power = มิเตอร์ไฟฟ้า, tr1..tr5 = หม้อแปลงไฟฟ้า 1–5 (เรียงจากประตูหน้าเข้าไปด้านใน)
// tank14 = บ่อเก็บน้ำอาคาร 1,4 (ลานจอดรถ), b5tank = ถังเก็บน้ำดาดฟ้าอาคาร 5, pump = บ่อน้ำประปาโรงงาน, pool = บ่อน้ำโรงอาหาร → ระดับน้ำ (%)
// b5chiller = Chiller ดาดฟ้าอาคาร 5, chiller = Chiller ลานโหลดโกดัง, cda = ห้อง CDA → มิเตอร์ไฟ (kWh)
// pwtank = ระดับน้ำในถังห้องระบบน้ำ Purified (%), pwvel = ความเร็วการไหล (Fluid velocity, m/s), whtank = ถังเก็บน้ำดาดฟ้าโกดัง (%)
type MeterValues = Record<MeterKey, MeterValue>;
const METER_MOCK: MeterValues = {
  water: { value: 12845.6, unit: 'm³' },
  power: { value: 98432, unit: 'kWh' },
  tr1: { value: 412530, unit: 'kWh' },
  tr2: { value: 287640, unit: 'kWh' },
  tr3: { value: 356210, unit: 'kWh' },
  tr4: { value: 198870, unit: 'kWh' },
  tr5: { value: 243905, unit: 'kWh' },
  tank14: { value: 78.5, unit: '%' },
  pool: { value: 71.3, unit: '%' },
  b5tank: { value: 64.2, unit: '%' },
  pump: { value: 82.0, unit: '%' },
  b5chiller: { value: 154320, unit: 'kWh' },
  chiller: { value: 87650, unit: 'kWh' },
  cda: { value: 63210, unit: 'kWh' },
  pwtank: { value: 68.4, unit: '%' },
  pwvel: { value: 1.85, unit: 'm/s' },
  whtank: { value: 74.6, unit: '%' },
  // ระบบบำบัดน้ำเสีย: ค่าจริงของ mock มาจากแบบจำลองเดียวกับหน้าระบบบำบัดน้ำเสีย (WW_METER ด้านล่าง)
  ww_eq: { value: 0, unit: '%' },
  ww_aer: { value: 0, unit: 'mg/L' },
  ww_sand: { value: 0, unit: 'NTU' },
  ww_anae: { value: 0, unit: '%' },
};
// จุดบนแผนผังที่ใช้แบบจำลองของระบบบำบัดน้ำเสีย (lib/wastewaterUnits) → ตัวเลข/alarm ตรงกับหน้า /wastewater
const WW_METER: Partial<Record<MeterKey, { unit: WwUnitKey; param: string }>> = {
  ww_eq: { unit: 'eq', param: 'level' },
  ww_aer: { unit: 'aer', param: 'do' },
  ww_sand: { unit: 'sand', param: 'turb' },
  ww_anae: { unit: 'anae', param: 'sludge' },
  pool: { unit: 'pool', param: 'level' },
};
const wwReading = (k: MeterKey, ms: number) => {
  if (isModelTank(k)) return { value: +tankLevelPct(k, ms).toFixed(1), alarm: false };
  if (k === 'water') return { value: +mainMeter(ms).toFixed(1), alarm: false };   // เลขมิเตอร์น้ำประปาหลัก   // ถังประปา: แบบจำลองเดียวกับรายงานระบบประปา
  const w = WW_METER[k];
  if (!w) return undefined;
  const p = paramOf(w.unit, w.param), v = p.fn(ms);
  return { value: +v.toFixed(p.dp), alarm: paramTone(p, v) === 'error' };
};
// ===== รายละเอียดเซ็นเซอร์ (MOCKUP) — ค่าตั้งต้นของแต่ละจุด ใช้สร้างค่าจำลอง/คำนวณค่าที่อนุมานได้ =====
const PIPE_A = Math.PI * (0.0657 / 2) ** 2;   // ท่อ Purified Water DN65 (พื้นที่หน้าตัด m²) → อัตราการไหล = ความเร็ว × พื้นที่
const rnd = (c: number, w: number) => c + (Math.random() - 0.5) * w;
// ระบบน้ำ (MOCKUP): อัตราการไหลเฉลี่ย (m³/h) + เลขมิเตอร์เริ่มต้น (m³) + แรงดัน (bar) — เลขมิเตอร์เพิ่มตามอัตราการไหลทุกรอบ 5 วินาที
// (มิเตอร์น้ำประปา 'water' ใช้ค่าหลักเป็นเลขมิเตอร์)
const WATER_MOCK: Partial<Record<MeterKey, { q: number; total: number; p: number }>> = {
  water: { q: 2.6, total: 0, p: 2.5 }, pump: { q: 6, total: 48210, p: 2.2 }, tank14: { q: 4, total: 21536, p: 1.8 },
  b5tank: { q: 1.2, total: 3418, p: 1.5 }, whtank: { q: 1, total: 2871, p: 1.5 }, pool: { q: 1.5, total: 9642, p: 0.8 },
};
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
function mockExtra(k: MeterKey): MeterValue['extra'] {
  // ถังที่ใช้แบบจำลองร่วมกับรายงานระบบประปา (อาคาร 1,4 / ดาดฟ้าอาคาร 5 / ดาดฟ้าโกดัง)
  if (k === 'water') {   // มิเตอร์น้ำประปาหลัก: แบบจำลองเดียวกับรายงานระบบประปา
    const now = Date.now();
    return { flow: mainFlow(now), meter: mainMeter(now), press: rnd(WATER_MOCK.water?.p ?? 2.5, 0.25) };
  }
  if (isModelTank(k)) {
    const now = Date.now();
    return { flow: tankFlow(k, now), meter: tankMeter(k, now), press: rnd(WATER_MOCK[k]?.p ?? 1.5, 0.2) };
  }
  const wm = WATER_MOCK[k];
  if (wm) {
    const flow = Math.max(0, rnd(wm.q, wm.q * 0.4));
    wm.total += (flow * 5) / 3600;
    return { flow, meter: wm.total, press: rnd(wm.p, wm.p * 0.12) };
  }
  if (k === 'pwvel') return { uv: clamp(rnd(96, 6), 0, 102), toc: rnd(150, 60), cond: rnd(0.9, 0.3) };   // คุณภาพน้ำ PW
  // จุดวัดไฟฟ้า: ใช้แบบจำลองเดียวกับหน้ารายละเอียด (lib/electricalPoints) เพื่อให้ตัวเลขสองหน้าตรงกัน
  const ep = findElectricalPoint(k);
  if (ep) {
    const r = readingAt(ep, Date.now());
    return { kw: r.kw, v: r.vLL, a: r.aAvg, pf: r.pf, hz: r.hz };
  }
  const kw0 = POWER_KW[k];
  if (kw0 !== undefined) {
    const kw = rnd(kw0, kw0 * 0.08), v = rnd(400, 6), pf = rnd(0.93, 0.04), hz = rnd(50, 0.1), a = (kw * 1000) / (Math.sqrt(3) * v * pf);
    return { kw, v, a, pf, hz };
  }
  return undefined;
}
type DetailRow = { id: DetailId; th: string; en: string; v: string; u: string; al: boolean };
const f = (x: number | undefined, d = 1) => (x === undefined ? '–' : x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
// ค่าของแต่ละช่องรายละเอียด (รายชื่อช่อง/หน่วยมาจาก detailFields() ใน lib/factorySensors — หน้าตั้งค่าเลือกได้ว่าจะแสดงช่องไหน)
function detailValue(k: MeterKey, id: DetailId, m: MeterValue): string {
  const e = m.extra ?? {}, t = TANK[k];
  switch (id) {
    case 'pf': case 'hz': return f(e[id], 2);
    case 'kw': case 'a': case 'v': return f(e[id]);
    case 'flow': return f(k === 'pwvel' ? m.value * PIPE_A * 3600 : e.flow, 2);
    case 'press': return f(e.press, 2);
    case 'meter': return f(k === 'water' ? m.value : e.meter, 1);
    case 'liters': return t ? `${Math.round(t.cap * 10 * m.value).toLocaleString('en-US')} / ${(t.cap * 1000).toLocaleString('en-US')}` : '–';
    case 'uv': return f(e.uv, 1);
    case 'toc': return f(e.toc, 0);
    case 'cond': return f(e.cond, 2);
    case 'size': { const kva = TR_KVA[k]; return kva ? `${kva.toLocaleString('en-US')} kVA (≈ ${(kva * TR_PF).toLocaleString('en-US')} kW)` : '–'; }
    case 'vol': return t ? `${f((t.cap * m.value) / 100)} / ${t.cap}` : '–';
    case 'height': return t ? f((t.h * m.value) / 100, 2) : '–';
  }
}
function detailRows(k: MeterKey, m: MeterValue, hidden: DetailId[] = [], showAl = true): DetailRow[] {
  return detailFields(k).filter((d) => !hidden.includes(d.id)).map((d) => ({ ...d, v: detailValue(k, d.id, m), al: showAl && !!m.extraAlarm?.[d.id] }));
}
const withExtra = (mv: MeterValues): MeterValues => {
  const n = { ...mv };
  (Object.keys(n) as MeterKey[]).forEach((k) => {
    const e = mockExtra(k);
    const ep = findElectricalPoint(k);
    const ww = wwReading(k, Date.now());
    n[k] = {
      ...n[k],
      ...(ep ? { value: Math.round(meterAt(ep, Date.now())) } : {}),
      ...(ww ? { value: ww.value, alarm: ww.alarm } : {}),
      ...(e ? { extra: e } : {}),
    };
  });
  return n;
};
// เกณฑ์แจ้งเตือน (alarm) — ค่าหลุดช่วงนี้ หรือข้อมูลส่ง alarm: true มา → ไอคอน/ป้ายเป็นสีแดงกะพริบ
const ALARM_RULES: Partial<Record<MeterKey, { min?: number; max?: number }>> = {
  tank14: { min: 20, max: 98 },
  pool: { min: 20, max: 98 },
  b5tank: { min: 20, max: 98 },
  pump: { min: 20, max: 98 },
  pwtank: { min: 20, max: 95 },
  whtank: { min: 20, max: 98 },
  pwvel: { min: 0.5, max: 2.5 },
};
const mainAlarm = (k: MeterKey, m: MeterValue) => {   // alarm ของค่าหลัก: สัญญาณจากระบบ หรือค่าหลุดเกณฑ์
  const r = ALARM_RULES[k];
  return !!m.alarm || (!!r && ((r.min !== undefined && m.value < r.min) || (r.max !== undefined && m.value > r.max)));
};
const isAlarm = (k: MeterKey, m: MeterValue) => mainAlarm(k, m) || Object.values(m.extraAlarm ?? {}).some(Boolean);   // ไอคอนบนแผนผัง
// id วัตถุที่คลิกได้ -> key ของค่ามิเตอร์ (ใช้แสดงตัวเลขในกล่องมุมขวาบน)
const METER_OF: Record<string, MeterKey[]> = {
  o_wmeter: ['water'],
  o_emeter: ['power'],
  o_tr1: ['tr1'],
  o_tr2: ['tr2'],
  o_tr3: ['tr3'],
  o_tr4: ['tr4'],
  o_tr5: ['tr5'],
  o_tank14: ['tank14'],
  o_pool: ['pool'],
  o_b5tank: ['b5tank'],
  o_pump: ['pump'],
  o_b5chiller: ['b5chiller'],
  o_chiller: ['chiller'],
  r_cda: ['cda'],
  r_pw: ['pwtank', 'pwvel'],
  o_whtank: ['whtank'],
  o_wt_eq: ['ww_eq'],
  o_wt_aer: ['ww_aer'],
  o_wt_sand: ['ww_sand'],
  o_wt_anae: ['ww_anae'],
};
// id วัตถุที่คลิกได้ -> หน้ารายละเอียดของจุดนั้น (ปุ่ม "ดูรายละเอียด" ในกล่องข้อมูล)
// ถัง/บ่อน้ำใช้ปลายทางเดียวกับการ์ดในหน้าภาพรวมระบบน้ำ · มิเตอร์ไฟ/หม้อแปลง/ชิลเลอร์/CDA → หน้ารายละเอียดจุดวัดไฟฟ้า
const DETAIL_PATH_OF: Record<string, string> = {
  ...Object.fromEntries(TANK_SITES.map((s) => [s.objectId, s.detailPath])),
  ...Object.fromEntries(ELECTRICAL_POINTS.map((p) => [p.objectId, electricalDetailPath(p.key)])),
  // หน่วยบำบัดน้ำเสีย (รวมบ่อพักน้ำทิ้ง → หน้าหน่วยบำบัด ซึ่งมีคุณภาพน้ำทิ้ง)
  ...Object.fromEntries(WW_UNITS.map((u) => [u.objectId, wwUnitPath(u.key)])),
  o_wmeter: URL.WATER_SUPPLY_REPORTS, // มิเตอร์น้ำประปา → รายงาน (เลขมิเตอร์ / ปริมาณการใช้)
};
const pushMeters = (scene: FactorySceneApi, mv: MeterValues, showAlarm: (k: MeterKey) => boolean) =>
  (Object.keys(mv) as MeterKey[]).forEach((k) => {
    scene.setMeter(k, mv[k].value, mv[k].unit);
    scene.setAlarm(k, showAlarm(k) && isAlarm(k, mv[k]));
  });
// จำลอง alarm แบบสุ่มเพื่อดูการแสดงผล — ตั้งเป็น false เมื่อต่อข้อมูลจริง (alarm จะมาจากข้อมูลจริง/เกณฑ์ ALARM_RULES เท่านั้น)
const SIMULATE_ALARMS = true;
function useMeterValues(disabledRef: { current: MeterKey[] }): MeterValues {
  // TODO: ดึงข้อมูลจริง (เช่น API/MQTT) แล้ว setValues(...) — ตอนนี้ใช้ค่าจำลองที่ขยับเล็กน้อยทุก 5 วินาทีเพื่อดูการแสดงผล
  const [values, setValues] = useState<MeterValues>(() => withExtra(METER_MOCK));
  const alarmUntil = useRef<Partial<Record<MeterKey, { until: number; field: DetailId | null }>>>({});   // field = null → alarm ค่าหลัก
  useEffect(() => {
    const id = setInterval(() => {
      // จำลอง alarm แบบสุ่ม (ปิดได้ที่ SIMULATE_ALARMS): ทุกรอบมีโอกาสเกิด alarm ใหม่ที่จุดสุ่ม 1 จุด ค้างอยู่ 10–25 วินาที, พร้อมกันไม่เกิน 2 จุด
      // แต่ละครั้งสุ่มว่าเป็น alarm ของค่าหลัก หรือของช่องรายละเอียดช่องใดช่องหนึ่ง
      const now = Date.now();
      const au = alarmUntil.current;
      (Object.keys(au) as MeterKey[]).forEach((k) => { if ((au[k]?.until ?? 0) <= now) delete au[k]; });
      if (SIMULATE_ALARMS && Object.keys(au).length < 2 && Math.random() < 0.3) {
        const free = (Object.keys(METER_MOCK) as MeterKey[]).filter((k) => !au[k] && !disabledRef.current.includes(k) && !WW_METER[k] && !isModelTank(k) && k !== 'water');   // จุดน้ำเสีย/ถังประปาแบบจำลอง: alarm มาจากแบบจำลองเท่านั้น
        const k = free[Math.floor(Math.random() * free.length)];
        if (k) {
          const fs = detailFields(k);
          const field = fs.length && Math.random() < 0.6 ? fs[Math.floor(Math.random() * fs.length)].id : null;
          au[k] = { until: now + 10000 + Math.random() * 15000, field };
        }
      }
      const simAlarm = { ...au };
      setValues((v) => {
        const n = { ...v };
        (Object.keys(n) as MeterKey[]).forEach((k) => {
          const u = n[k].unit;
          const value =
            u === '%' ? +Math.min(100, Math.max(0, n[k].value + (Math.random() - 0.5))).toFixed(1) // ระดับน้ำขึ้น-ลงเล็กน้อย
            : u === 'm/s' ? +Math.max(0, n[k].value + (Math.random() - 0.5) * 0.06).toFixed(2) // ความเร็วการไหลแกว่งเล็กน้อย
            : k === 'water' ? +(n[k].value + Math.random() * 0.3).toFixed(1)
            : findElectricalPoint(k) ? Math.round(meterAt(findElectricalPoint(k)!, Date.now())) // เลขมิเตอร์ไฟ: แบบจำลองเดียวกับหน้ารายละเอียด
            : Math.round(n[k].value + Math.random() * 4);
          const sa = simAlarm[k];
          const ww = wwReading(k, Date.now());
          n[k] = {
            ...n[k],
            value: ww ? ww.value : value,
            alarm: ww ? ww.alarm : !!sa && sa.field === null,
            extraAlarm: sa?.field ? { [sa.field]: true } : {},
            extra: mockExtra(k) ?? n[k].extra,
          };
        });
        return n;
      });
    }, 5000);
    return () => clearInterval(id);
  }, []);
  return values;
}

function formatTime(h: number) {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60) % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export default function FactoryLayout3D() {
  const { t, i18n } = useTranslation();
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<FactorySceneApi | null>(null);

  const [selected, setSelected] = useState('fac');
  // ค่าเริ่มต้นเมื่อเปิดหน้า: หมุนอัตโนมัติ + ซ่อนป้ายชื่อ
  const [auto, setAuto] = useState(true);
  const [icons, setIcons] = useState(true); // แสดงไอคอน + ตัวเลขมิเตอร์
  const [time, setTime] = useState(() => siteHours(0));
  // live = เวลาเดินตามเวลาเซิร์ฟเวอร์อัตโนมัติ; เมื่อผู้ใช้เลื่อนเองจะหยุดตาม จนกดปุ่ม "เวลาปัจจุบัน"
  const [live, setLive] = useState(true);
  const offsetRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const disabled = useFactorySensorSettings((s) => s.disabled);
  const hiddenFields = useFactorySensorSettings((s) => s.hiddenFields);
  const alarmsOn = useFactorySensorSettings((s) => s.alarms);
  const alarmOff = useFactorySensorSettings((s) => s.alarmOff);
  const showAlarm = (k: MeterKey) => alarmsOn && !alarmOff.includes(primaryOf(k));   // หน้าตั้งค่า: สวิตช์ alarm รวม + รายจุด
  const showAlarmRef = useRef(showAlarm);
  showAlarmRef.current = showAlarm;
  const offKeys = (Object.keys(METER_MOCK) as MeterKey[]).filter((k) => disabled.includes(primaryOf(k)));   // key ที่ปิด (รวม key ย่อยของแถวเดียวกัน)
  const offSig = offKeys.join(',');
  const disabledRef = useRef(offKeys);
  disabledRef.current = offKeys;
  const meters = useMeterValues(disabledRef);
  const isAdmin = isAdminRole(useAuthStore((s) => s.role));
  const navigate = useNavigate();
  const meterKeys = (METER_OF[selected] ?? []).filter((k) => !offKeys.includes(k));   // จุดที่เลือก: เฉพาะเซ็นเซอร์ที่เปิดใช้งาน
  const [loadError, setLoadError] = useState(false);
  const [loadErrorMsg, setLoadErrorMsg] = useState(''); // ข้อความ error จริง (ช่วยหาสาเหตุ)

  const liveRef = useRef(live);
  liveRef.current = live;
  const syncNow = () => {
    const h = siteHours(offsetRef.current);
    setTime(h);
    sceneRef.current?.setTime(h);
  };
  useEffect(() => {
    let alive = true;
    fetchServerOffset()
      .then((off) => {
        if (alive) offsetRef.current = off;
      })
      .catch(() => {
        /* อ่านเวลาเซิร์ฟเวอร์ไม่ได้ → ใช้นาฬิกาเครื่อง */
      })
      .finally(() => {
        if (alive && liveRef.current) syncNow();
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!live) return;
    syncNow();
    const id = setInterval(syncNow, 30_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  // โหลดโมเดลหลังหน้าเว็บแสดงผลเสร็จ: รอให้เบราว์เซอร์วาดหน้าก่อน (2 เฟรม + ช่วงว่าง) แล้วค่อย import โค้ดฉาก 3 มิติแบบแยกไฟล์
  // ค่าที่ผู้ใช้ปรับระหว่างรอ (ป้าย/โซลาร์/หมุน/เวลา) จะถูกส่งเข้าโมเดลตอนสร้างเสร็จ
  const meterRef = useRef(meters);
  meterRef.current = meters;
  useEffect(() => {
    if (sceneRef.current) pushMeters(sceneRef.current, meters, showAlarmRef.current);
  }, [meters, alarmsOn, alarmOff]);
  useEffect(() => {
    sceneRef.current?.setHiddenIcons(disabledRef.current);   // เซ็นเซอร์ที่ปิดใช้งาน (หน้าตั้งค่า) → ซ่อนไอคอน
  }, [offSig]);
  const stateRef = useRef({ auto, time, selected, icons });
  stateRef.current = { auto, time, selected, icons };
  useEffect(() => {
    let cancelled = false;
    let scene: FactorySceneApi | null = null;
    let idleId: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const start = () => {
          import('@/lib/factoryScene3d')
            .then(({ createFactoryScene }) => {
              if (cancelled || !hostRef.current) return;
              const st = stateRef.current;
              scene = createFactoryScene(hostRef.current, {
                onSelect: setSelected,
                onAutoRotateChange: setAuto, // คลิก object / หมุน-ซูมกล้องเอง → ปุ่มหมุนอัตโนมัติเปลี่ยนเป็นปิด
                initialId: st.selected,
                initialTime: st.time,
                initialLabels: false,
                initialAutoRotate: st.auto,
              });
              sceneRef.current = scene;
              setLoading(false);
              pushMeters(scene, meterRef.current, showAlarmRef.current);
              if (!st.icons) scene.setIcons(false);
              scene.setHiddenIcons(disabledRef.current);
            })
            .catch((err) => {
              console.error('[FactoryLayout3D] load failed', err);
              if (!cancelled) {
                setLoadError(true);
                setLoadErrorMsg(err instanceof Error ? err.message : String(err));
              }
            });
        };
        const ric = (window as any).requestIdleCallback as undefined | ((cb: () => void, o?: { timeout: number }) => number);
        if (ric) idleId = ric(start, { timeout: 300 });
        else timer = setTimeout(start, 0);
      }),
    );
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      if (idleId !== undefined) (window as any).cancelIdleCallback?.(idleId);
      if (timer) clearTimeout(timer);
      scene?.dispose();
      sceneRef.current = null;
    };
  }, []);

  const isTh = i18n.language?.startsWith('th');
  const room = ROOMS.find((x) => x.id === selected);
  const obj = OBJECTS.find((x) => x.id === selected);
  const b = BUILDINGS.find((x) => x.id === (room ? room.parent : obj ? obj.parent : selected)) ?? BUILDINGS[1];
  const nameOf = (x: (typeof BUILDINGS)[number]) => (isTh ? x.name : x.en);

  const [view, setViewKey] = useState<ViewKey | ''>('');
  const selectCls =
    'h-9 rounded-lg border border-gray-300 bg-white pl-3 pr-8 text-sm font-medium text-gray-800 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200';
  const iconBtn = (on: boolean) =>
    `inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 text-xs font-semibold shadow-sm transition active:scale-95 ${on ? btnOn : btnOff}`;

  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
      {/* แถบควบคุม: อาคาร + มุมกล้อง (dropdown) | ป้าย/โซลาร์/หมุน | เวลา */}
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
        <select
          aria-label={t('factory_layout3d.building')}
          className={selectCls}
          value={room ? room.parent : selected}
          onChange={(e) => sceneRef.current?.select(e.target.value)}
        >
          <optgroup label={t('factory_layout3d.group_buildings')}>
            {BUILDINGS.map((x) => (
              <option key={x.id} value={x.id}>
                {nameOf(x)}
              </option>
            ))}
          </optgroup>
          <optgroup label={t('factory_layout3d.group_objects')}>
            {OBJECTS.map((x) => (
              <option key={x.id} value={x.id}>
                {isTh ? x.name : x.en}
              </option>
            ))}
          </optgroup>
        </select>
        <select
          aria-label={t('factory_layout3d.camera')}
          className={selectCls}
          value={view}
          onChange={(e) => {
            const v = e.target.value as ViewKey;
            if (!v) return;
            setViewKey(v);
            // เลือกมุมมองแล้วหยุดการหมุนอัตโนมัติ เพื่อให้ภาพค้างที่มุมนั้น
            sceneRef.current?.setAutoRotate(false);
            setAuto(false);
            sceneRef.current?.setView(v);
          }}
        >
          <option value="" disabled>
            {t('factory_layout3d.camera')}
          </option>
          {VIEWS.map((v) => (
            <option key={v} value={v}>
              {t(`factory_layout3d.view_${v}`)}
            </option>
          ))}
        </select>

        <div className="mx-1 hidden h-6 w-px bg-gray-200 sm:block dark:bg-slate-700" />
        <button
          type="button"
          className={iconBtn(auto)}
          title={t('factory_layout3d.auto_rotate')}
          onClick={() => {
            sceneRef.current?.setAutoRotate(!auto);
            setAuto(!auto);
          }}
        >
          {auto ? <Pause className="h-3.5 w-3.5" /> : <RotateCw className="h-3.5 w-3.5" />}
          <span className="hidden md:inline">{t('factory_layout3d.auto_rotate')}</span>
        </button>
        <button
          type="button"
          className={iconBtn(icons)}
          title={t('factory_layout3d.icons')}
          aria-pressed={icons}
          onClick={() => {
            sceneRef.current?.setIcons(!icons);
            setIcons(!icons);
          }}
        >
          <Gauge className="h-3.5 w-3.5" />
          <span className="hidden md:inline">{t('factory_layout3d.icons')}</span>
        </button>
        {isAdmin && (
          <button
            type="button"
            className={iconBtn(false)}
            title={t('factory_layout3d.settings')}
            onClick={() => navigate(URL.FACTORY_LAYOUT_SETTINGS)}
          >
            <Settings className="h-3.5 w-3.5" />
            <span className="hidden md:inline">{t('factory_layout3d.settings')}</span>
          </button>
        )}

        <div className="ml-auto flex min-w-[220px] flex-1 items-center gap-2 sm:max-w-sm">
          <input
            id="factory-time"
            aria-label={t('factory_layout3d.time')}
            type="range"
            min={0}
            max={24}
            step={0.05}
            value={time}
            onChange={(e) => {
              const v = Number(e.target.value);
              setLive(false);
              setTime(v);
              sceneRef.current?.setTime(v);
            }}
            className="w-full accent-emerald-600"
          />
          <span className="w-11 text-sm font-semibold tabular-nums text-gray-800 dark:text-slate-200">
            {formatTime(time)}
          </span>
          <button
            type="button"
            className={iconBtn(live)}
            onClick={() => setLive(true)}
            title={t('factory_layout3d.time_live_hint')}
          >
            <Clock className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">{t('factory_layout3d.time_live')}</span>
          </button>
        </div>
      </div>

      {/* พื้นที่ 3 มิติ (เต็มความสูงจอ) */}
      <div
        className="relative w-full bg-slate-100 dark:bg-slate-950"
        style={{ height: 'calc(100vh - 190px)', minHeight: 480 }}
      >
        <div ref={hostRef} className="absolute inset-0" style={{ cursor: 'grab' }} />
        {/* ข้อมูลอาคารที่เลือก (ย่อ) */}
        <div className="pointer-events-none absolute right-3 top-3 rounded-xl bg-black/45 px-3 py-2 text-white backdrop-blur-sm">
          {room || obj ? (
            <>
              <div className="text-sm font-bold leading-tight">{isTh ? (room ?? obj)!.name : (room ?? obj)!.en}</div>
              {(room || obj?.parent) && <div className="text-[11px] opacity-85">{nameOf(b)}</div>}
              {obj?.note && <div className="mt-1 max-w-[280px] text-[11px] leading-snug opacity-90">{isTh ? obj.note : obj.noteEn ?? obj.note}</div>}
              {meterKeys.map((k) => {
                const m = meters[k];
                const al = showAlarm(k) && mainAlarm(k, m);
                return (
                  <div key={k} className={`mt-1 font-mono text-lg font-bold tabular-nums ${al ? 'animate-pulse rounded bg-red-600 px-1.5' : ''}`}>
                    {m.value.toLocaleString('en-US', m.unit === '%' ? { minimumFractionDigits: 1, maximumFractionDigits: 1 } : { maximumFractionDigits: 2 })} <span className="text-xs font-normal opacity-80">{m.unit}</span>
                    {al && <span className="ml-1.5 text-[11px] font-semibold">ALARM</span>}
                  </div>
                );
              })}
              {meterKeys.some((k) => detailRows(k, meters[k], hiddenOf(hiddenFields, primaryOf(k)), showAlarm(k)).length > 0) && (
                <div className="mt-1.5 grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 border-t border-white/20 pt-1.5 text-[11px] tabular-nums">
                  {meterKeys.flatMap((k) => detailRows(k, meters[k], hiddenOf(hiddenFields, primaryOf(k)), showAlarm(k)).map((r) => [
                    <div key={`${k}-${r.id}-l`} className={r.al ? 'font-bold text-red-400' : 'opacity-75'}>{isTh ? r.th : r.en}</div>,
                    <div key={`${k}-${r.id}-v`} className={`text-right font-semibold ${r.al ? 'font-bold text-red-400' : ''}`}>{r.v}{r.u && <span className={`ml-1 font-normal ${r.al ? '' : 'opacity-75'}`}>{r.u}</span>}</div>,
                  ]))}
                </div>
              )}
              {DETAIL_PATH_OF[selected] && (
                <button
                  type="button"
                  onClick={() => navigate(DETAIL_PATH_OF[selected])}
                  className="pointer-events-auto mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-white/90 px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-sm transition hover:bg-white"
                >
                  {t('factory_layout3d.view_details')}
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              )}
            </>
          ) : (
            <>
              <div className="text-sm font-bold leading-tight">{nameOf(b)}</div>
              <div className="text-[11px] opacity-85 tabular-nums">
                {b.w} × {b.l} {t('factory_layout3d.unit_m')} · {t('factory_layout3d.kpi_height_short')} {b.h} {t('factory_layout3d.unit_m')} ·{' '}
                {N(b.gfa)} {t('factory_layout3d.unit_sqm')}
              </div>
            </>
          )}
        </div>
        <span className="pointer-events-none absolute bottom-2 left-24 rounded-full bg-black/45 px-2.5 py-0.5 text-[11px] text-white">
          {t('factory_layout3d.hint')}
        </span>
        {(loading || loadError) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-100/90 dark:bg-slate-950/90">
            {loadError ? (
              <span className="flex flex-col items-center gap-1 text-center text-sm text-red-600 dark:text-red-400">
                {t('factory_layout3d.load_error')}
                {loadErrorMsg && <code className="max-w-md break-all text-xs opacity-80">{loadErrorMsg}</code>}
              </span>
            ) : (
              <>
                <span className="h-9 w-9 animate-spin rounded-full border-4 border-emerald-500/30 border-t-emerald-600" />
                <span className="text-sm text-gray-600 dark:text-slate-300">{t('factory_layout3d.loading')}</span>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
