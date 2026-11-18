// อ่านข้อความจาก locales/th.json, en.json สำหรับไฟล์ข้อมูล (lib/*) ที่เก็บชื่อสองภาษาเป็นฟิลด์ th/en
// ข้อความทั้งหมดอยู่ใน locales ใต้ key "data.*" — ไฟล์ข้อมูลอ้างอิงด้วย key แทนการเขียนข้อความตรงในโค้ด
import th from '@/locales/th.json';
import en from '@/locales/en.json';

type Dict = { [k: string]: string | Dict };

function pick(dict: Dict, key: string): string {
  let cur: string | Dict | undefined = dict;
  for (const part of key.split('.')) {
    if (typeof cur !== 'object' || cur === null) return key;
    cur = cur[part];
  }
  return typeof cur === 'string' ? cur : key;
}

type Vars = Record<string, string | number>;
const fill = (text: string, vars?: Vars) => (vars ? text.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : text);

/** ข้อความภาษาไทยของ key (ไม่พบ → คืน key เพื่อให้เห็นชัดว่าขาด) · vars แทนค่า {{name}} */
export const locTh = (key: string, vars?: Vars): string => fill(pick(th as Dict, key), vars);
/** ข้อความภาษาอังกฤษของ key (ไม่พบ → คืน key) · vars แทนค่า {{name}} */
export const locEn = (key: string, vars?: Vars): string => fill(pick(en as Dict, key), vars);
