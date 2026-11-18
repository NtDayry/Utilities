// นิยามช่องตั้งค่าของคอนโทรลเลอร์ระบบประปา — ช่วงค่า (min/max) ตรงกับ constrain() ใน firmware WaterLevel/src/main.cpp
// ข้อความทั้งหมดอยู่ใน locales: water_supply.control.fields.<key>.label/.hint, .sections.<id>.title/.desc, .options.<key>.<value>
import type { TFunction } from 'i18next';
import type { WaterControllerSettings } from '@/types/waterSupply.types';

export type SettingKey = keyof WaterControllerSettings;

export interface NumberField {
  key: SettingKey;
  kind: 'number';
  unit?: string;
  min: number;
  /** ค่าสูงสุด — 'level' = ไม่เกินช่วงวัดระดับ (tank_capacity) */
  max: number | 'level';
  step: number;
  int?: boolean;
  /** มีคำอธิบายเพิ่ม (fields.<key>.hint) */
  hint?: boolean;
}
export interface SelectField {
  key: SettingKey;
  kind: 'select';
  options: boolean[];
  hint?: boolean;
}
export type SettingField = NumberField | SelectField;

export interface FieldSection {
  id: string;
  fields: SettingField[];
}

const P = 'water_supply.control';
export const fieldLabelKey = (k: string) => `${P}.fields.${k}.label`;
export const fieldHintKey = (k: string) => `${P}.fields.${k}.hint`;
export const sectionTitleKey = (id: string) => `${P}.sections.${id}.title`;
export const sectionDescKey = (id: string) => `${P}.sections.${id}.desc`;
export const optionKey = (k: string, v: boolean) => `${P}.options.${k}.${v}`;

export const SETTING_SECTIONS: FieldSection[] = [
  {
    id: 'pressure',
    fields: [
      { key: 'set_pressure', kind: 'number', unit: 'bar', min: 0, max: 6, step: 0.05 },
      { key: 'pid_kp', kind: 'number', min: 0, max: 100, step: 0.01 },
      { key: 'pid_ki', kind: 'number', min: 0, max: 100, step: 0.01 },
      { key: 'acc_dec', kind: 'number', unit: 's', min: 0.1, max: 3600, step: 0.1 },
      { key: 'sleep_freq', kind: 'number', unit: 'Hz', min: 0, max: 50, step: 0.5, hint: true },
      { key: 'sleep_delay_sec', kind: 'number', unit: 's', min: 0, max: 3600, step: 1, int: true },
      { key: 'sensor_type_switch', kind: 'select', options: [true, false] },
    ],
  },
  {
    id: 'level',
    fields: [
      { key: 'tank_capacity', kind: 'number', unit: 'cm', min: 0.1, max: 1000, step: 1, hint: true },
      { key: 'valve_on_cm', kind: 'number', unit: 'cm', min: 0, max: 'level', step: 1 },
      { key: 'valve_period_sec', kind: 'number', unit: 's', min: 0.1, max: 86400, step: 0.1 },
      { key: 'lower_limit_cm', kind: 'number', unit: 'cm', min: 0, max: 'level', step: 1 },
      { key: 'alert_min_cm', kind: 'number', unit: 'cm', min: 0, max: 'level', step: 1 },
      { key: 'alert_max_cm', kind: 'number', unit: 'cm', min: 0, max: 'level', step: 1, hint: true },
      { key: 'alert_period_sec', kind: 'number', unit: 's', min: 1, max: 86400, step: 1, int: true },
    ],
  },
];

export const ALL_FIELDS: SettingField[] = SETTING_SECTIONS.flatMap((s) => s.fields);
export const findField = (key: string) => ALL_FIELDS.find((f) => f.key === key);

/** ตรวจค่าก่อนส่ง (คืนข้อความผิดพลาด หรือ null) */
export function validateField(f: SettingField, value: unknown, levelMax: number, t: TFunction): string | null {
  if (f.kind !== 'number') return null;
  const v = Number(value);
  if (value === '' || !Number.isFinite(v)) return t(`${P}.validation.not_number`);
  const max = f.max === 'level' ? levelMax : f.max;
  if (v < f.min || v > max) return t(`${P}.validation.out_of_range`, { min: f.min, max });
  if (f.int && !Number.isInteger(v)) return t(`${P}.validation.integer`);
  return null;
}
