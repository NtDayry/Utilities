import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '@/components/ui/button/Button';
import { CountPicker, Field, NumInput, PathPicker, Section, errorCls, inputCls, smallCls } from '@/components/water-supply/water-system/WaterSystemFormParts';
import TankLevel3D from '@/components/common/3d/TankLevel3D';
import { useWaterSystems } from '@/store/waterSystems';
import { DEFAULT_BROKER } from '@/lib/waterSystems/mqttTopics';
import { DEFAULT_WATER_COLOR, LEVEL_UNITS, MAX_PUMPS, MAX_TANKS, SENSOR_KEYS, calcSystem, capacityM3, defaultPump, defaultTank, isValidPath, shapeForKind, levelToCm, validateSystem, type ScannedPoint } from '@/lib/waterSystems/model';
import type { LevelUnit, PumpDrive, SensorKey, SensorRef, WaterSystemConfig, WaterSystemKind, WaterSystemPump, WaterSystemTank } from '@/types/waterSystem.types';

/** สีน้ำที่เลือกได้เร็ว (ตัวแรก = ค่าเริ่มต้น) — เลือกสีอื่นได้จากช่องเลือกสี */
const WATER_COLOR_PRESETS = [DEFAULT_WATER_COLOR, '#38bdf8', '#14b8a6', '#22c55e', '#a16207', '#64748b'];

/** ชนิดของจุดข้อมูลที่เลือกได้สำหรับเซ็นเซอร์แต่ละแบบ */
const SENSOR_TYPES: Record<SensorKey, ScannedPoint['type'][]> = {
  level: ['number'],
  meterTotal: ['number'],
  flowRate: ['number'],
  inletValve: ['boolean', 'number'],
};

interface Props {
  system: WaterSystemConfig;
  /** ผลสแกนข้อความล่าสุดของระบบนี้ (ตัวเลือกตำแหน่งของข้อมูล) */
  points: ScannedPoint[];
  /** ค่าระดับล่าสุดจากเซ็นเซอร์ (หน่วยตามที่ตั้ง) — ใช้วาดตัวอย่าง 3 มิติขณะปรับขนาด */
  levelRaw: number | null;
  onClose: () => void;
}

/**
 * แผงตั้งค่าในหน้าของระบบ (เฉพาะ admin): ถัง/บ่อ (จำนวน ขนาด — รูปทรงตามชนิด) · เซ็นเซอร์ที่เปิดใช้ + ตำแหน่งของข้อมูล · ปั๊ม (inverter / magnetic + ตำแหน่งของข้อมูล)
 * ตัวอย่าง 3 มิติด้านบนเปลี่ยนตามค่าที่ปรับทันที ก่อนกดบันทึก
 */
export default function WaterSystemSettings({ system, points, levelRaw, onClose }: Props) {
  const { t } = useTranslation();
  const save = useWaterSystems((s) => s.save);
  const [cfg, setCfg] = useState<WaterSystemConfig>(system);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const patch = (p: Partial<WaterSystemConfig>) => setCfg((c) => ({ ...c, ...p }));
  const patchTank = (i: number, p: Partial<WaterSystemTank>) => patch({ tanks: cfg.tanks.map((x, n) => (n === i ? { ...x, ...p } : x)) });
  const patchSensor = (key: SensorKey, p: Partial<SensorRef>) => patch({ sensors: { ...cfg.sensors, [key]: { ...cfg.sensors[key], ...p } } });
  const patchPump = (i: number, p: Partial<WaterSystemPump>) => patch({ pumps: cfg.pumps.map((x, n) => (n === i ? { ...x, ...p } : x)) });

  // เปลี่ยนชนิด → รูปทรงทุกถัง/บ่อเปลี่ยนตาม (ถังน้ำ = ทรงกระบอก, บ่อเก็บน้ำ = สี่เหลี่ยม)
  // ชื่อที่ยังเป็นค่าตั้งต้น (ถัง n / บ่อ n) เปลี่ยนตามชนิดด้วย — ชื่อที่ตั้งเองไม่แตะ
  const setKind = (kind: WaterSystemConfig['kind']) =>
    patch({
      kind,
      tanks: cfg.tanks.map((x, i) => ({
        ...x,
        shape: shapeForKind(kind),
        name: x.name === defaultTank(cfg.kind, i).name ? defaultTank(kind, i).name : x.name,
      })),
    });

  const setTankCount = (n: number) => {
    const tanks = cfg.tanks.slice(0, n);
    while (tanks.length < n) tanks.push(defaultTank(cfg.kind, tanks.length));
    patch({ tanks, sensorTank: cfg.sensorTank < n ? cfg.sensorTank : 0 });
  };
  const setPumpCount = (n: number) => {
    const pumps = cfg.pumps.slice(0, n);
    // ปั๊มที่เพิ่มใช้ชนิดเดียวกับตัวก่อนหน้า (ส่วนใหญ่ทั้งชุดเป็นชนิดเดียวกัน)
    while (pumps.length < n) pumps.push(defaultPump(pumps.length, pumps[pumps.length - 1]?.drive ?? 'inverter'));
    patch({ pumps });
  };
  // เปลี่ยนชนิดปั๊ม: ถ้าตำแหน่งยังเป็นค่าที่เสนอไว้ของชนิดเดิม ให้เปลี่ยนเป็นค่าที่เสนอของชนิดใหม่ (ที่ผู้ใช้เลือก/พิมพ์เองไม่แตะ)
  const setDrive = (i: number, drive: PumpDrive) => {
    const pump = cfg.pumps[i];
    patchPump(i, { drive, path: pump.path === defaultPump(i, pump.drive).path ? defaultPump(i, drive).path : pump.path });
  };

  const errors = validateSystem(cfg);
  const err = (field: keyof typeof errors) => (submitted && errors[field] ? t(`water_systems.error.${errors[field]}`) : undefined);
  const customBroker = cfg.broker !== null;
  const capacity = capacityM3(cfg);
  const unitWord = t(`water_systems.kind.${cfg.kind}.unit`);
  const dimsOk = !validateSystem({ ...cfg, name: 'x', topic: 'x', broker: null }).tanks;
  const previewCalc = dimsOk && cfg.sensors.level.enabled && levelRaw !== null ? calcSystem(cfg, levelToCm(cfg, levelRaw)) : null;

  const submit = async () => {
    setSubmitted(true);
    if (Object.keys(errors).length > 0) return;
    setSaving(true);
    setSaveError('');
    try {
      await save({
        ...cfg,
        name: cfg.name.trim(),
        location: cfg.location.trim(),
        tanks: cfg.tanks.map((x, i) => ({ ...x, name: x.name.trim(), offset_cm: i === 0 ? 0 : x.offset_cm })),
        pumps: cfg.pumps.map((p) => ({ ...p, name: p.name.trim() })),
      });
      onClose();
    } catch (e) {
      console.error('[water-systems] save failed:', e);
      setSaveError(t('water_systems.error.save_failed'));
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 rounded-2xl border-2 border-sky-300 bg-white p-5 shadow-sm dark:border-sky-800 dark:bg-gray-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-gray-900 dark:text-white">{t('water_systems.settings.title')}</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">{t('water_systems.settings.intro')}</p>
        </div>
        <div className="flex gap-2">
          <Button variant={{ light: 'neutral-soft', dark: 'neutral-soft-outline' }} onClick={onClose} disabled={saving}>
            {t('water_systems.cancel')}
          </Button>
          <Button variant="primary" onClick={submit} disabled={saving}>
            {t('water_systems.save')}
          </Button>
        </div>
      </div>
      {submitted && Object.keys(errors).length > 0 && <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-500/10 dark:text-red-400">{t('water_systems.settings.has_errors')}</div>}
      {saveError && <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-500/10 dark:text-red-400">{saveError}</div>}

      {/* ถัง / บ่อ + ตัวอย่าง 3 มิติ */}
      <Section title={t('water_systems.settings.tanks', { unit: unitWord })} hint={cfg.tanks.length > 1 ? t('water_systems.tanks_connected_note') : undefined}>
        <div className="grid gap-4 xl:grid-cols-5">
          <div className="xl:col-span-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex rounded-lg border border-gray-300 bg-gray-100 p-0.5 dark:border-gray-700 dark:bg-gray-800">
                {(['tank', 'pond'] as WaterSystemKind[]).map((k) => (
                  <button key={k} type="button" aria-pressed={cfg.kind === k} onClick={() => setKind(k)} className={`h-8 rounded-md px-3 text-sm font-semibold ${cfg.kind === k ? 'bg-sky-500 text-white shadow-sm' : 'text-gray-600 dark:text-gray-300'}`}>
                    {t(`water_systems.kind.${k}.name`)}
                  </button>
                ))}
              </div>
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('water_systems.tank_count', { unit: unitWord })}</span>
              <CountPicker value={cfg.tanks.length} min={1} max={MAX_TANKS} onChange={setTankCount} />
              <span className="text-xs text-gray-500 dark:text-gray-400">{t('water_systems.total_capacity', { m3: Number.isFinite(capacity) ? capacity.toFixed(1) : '—' })}</span>
            </div>
            <div className="mt-3 space-y-2">
              {cfg.tanks.map((tank, i) => (
                <div key={`${cfg.tanks.length}-${i}`} className="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-2.5 sm:grid-cols-12 dark:bg-gray-900/50">
                  <label className="col-span-2 sm:col-span-4">
                    <span className="mb-0.5 block text-[11px] text-gray-500 dark:text-gray-400">{t('water_systems.tank_name')}</span>
                    <input className={smallCls} value={tank.name} onChange={(e) => patchTank(i, { name: e.target.value })} />
                  </label>
                  {tank.shape === 'rect' ? (
                    <>
                      <label className="sm:col-span-2">
                        <span className="mb-0.5 block text-[11px] text-gray-500 dark:text-gray-400">{t('water_systems.width_m')}</span>
                        <NumInput value={tank.width_m} min={0} onChange={(n) => patchTank(i, { width_m: n })} />
                      </label>
                      <label className="sm:col-span-2">
                        <span className="mb-0.5 block text-[11px] text-gray-500 dark:text-gray-400">{t('water_systems.length_m')}</span>
                        <NumInput value={tank.length_m} min={0} onChange={(n) => patchTank(i, { length_m: n })} />
                      </label>
                    </>
                  ) : (
                    <label className="sm:col-span-4">
                      <span className="mb-0.5 block text-[11px] text-gray-500 dark:text-gray-400">{t('water_systems.diameter_m')}</span>
                      <NumInput key="d" value={tank.diameter_m} min={0} onChange={(n) => patchTank(i, { diameter_m: n })} />
                    </label>
                  )}
                  <label className={i === 0 ? 'sm:col-span-4' : 'sm:col-span-2'}>
                    <span className="mb-0.5 block text-[11px] text-gray-500 dark:text-gray-400">{t('water_systems.height_m')}</span>
                    <NumInput value={tank.height_m} min={0} onChange={(n) => patchTank(i, { height_m: n })} />
                  </label>
                  {i > 0 && (
                    <label className="sm:col-span-2" title={t('water_systems.offset_hint')}>
                      <span className="mb-0.5 block text-[11px] text-gray-500 dark:text-gray-400">{t('water_systems.offset_cm')}</span>
                      <NumInput value={tank.offset_cm} onChange={(n) => patchTank(i, { offset_cm: n })} />
                    </label>
                  )}
                </div>
              ))}
            </div>
            {err('tanks') && <div className="mt-1 text-xs text-red-600 dark:text-red-400">{err('tanks')}</div>}
            {/* สีของน้ำ (ค่าเริ่มต้น = น้ำเงิน) */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('water_systems.water_color')}</span>
              <input type="color" className="h-8 w-12 cursor-pointer rounded border border-gray-300 bg-white p-0.5 dark:border-gray-700 dark:bg-gray-900" value={cfg.waterColor} onChange={(e) => patch({ waterColor: e.target.value })} aria-label={t('water_systems.water_color')} />
              {WATER_COLOR_PRESETS.map((c) => (
                <button key={c} type="button" onClick={() => patch({ waterColor: c })} aria-pressed={cfg.waterColor === c} aria-label={c} title={c} className={`h-6 w-6 rounded-full border-2 ${cfg.waterColor === c ? 'border-gray-900 dark:border-white' : 'border-transparent'}`} style={{ background: c }} />
              ))}
              <span className="font-mono text-xs text-gray-500 dark:text-gray-400">{cfg.waterColor}</span>
              {cfg.waterColor !== DEFAULT_WATER_COLOR && (
                <button type="button" className="text-xs font-semibold text-sky-600 hover:underline dark:text-sky-400" onClick={() => patch({ waterColor: DEFAULT_WATER_COLOR })}>
                  {t('water_systems.water_color_reset')}
                </button>
              )}
            </div>
          </div>
          <div className="xl:col-span-2">
            {dimsOk ? (
              <TankLevel3D kind={cfg.kind} tanks={cfg.tanks} calc={previewCalc} waterColor={cfg.waterColor} valve={cfg.sensors.inletValve.enabled ? null : undefined} className="h-64 xl:h-full xl:min-h-64" />
            ) : (
              <div className="flex h-64 items-center justify-center rounded-xl bg-gray-100 p-4 text-center text-sm text-gray-500 dark:bg-gray-800 dark:text-gray-400">{t('water_systems.settings.preview_needs_dims')}</div>
            )}
          </div>
        </div>
      </Section>

      {/* เซ็นเซอร์ */}
      <Section title={t('water_systems.settings.sensors')} hint={points.length > 0 ? t('water_systems.settings.sensors_hint') : t('water_systems.settings.sensors_hint_no_data')}>
        <div className="space-y-2">
          {SENSOR_KEYS.map((key) => {
            const s = cfg.sensors[key];
            const bad = submitted && s.enabled && !isValidPath(s.path);
            return (
              <div key={key} className={`rounded-lg border p-3 ${s.enabled ? 'border-sky-400 bg-sky-50/40 dark:border-sky-700 dark:bg-sky-500/5' : 'border-gray-200 dark:border-gray-700'}`}>
                <label className="flex cursor-pointer items-start gap-2.5">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-sky-500" checked={s.enabled} onChange={(e) => patchSensor(key, { enabled: e.target.checked })} />
                  <span>
                    <span className="block text-sm font-semibold text-gray-800 dark:text-white/90">{t(`water_systems.sensor.${key}`)}</span>
                    <span className="block text-xs text-gray-500 dark:text-gray-400">{t(`water_systems.sensor_desc.${key}`)}</span>
                  </span>
                </label>
                {s.enabled && (
                  <div className="mt-2.5 grid gap-3 pl-6 sm:grid-cols-12">
                    <Field label={`${t('water_systems.path.label')} *`} error={bad ? t('water_systems.error.sensor_path_required') : undefined} className="sm:col-span-6">
                      <PathPicker value={s.path} onChange={(path) => patchSensor(key, { path })} points={points} types={SENSOR_TYPES[key]} invalid={bad} />
                    </Field>
                    {key === 'level' ? (
                      <>
                        <Field label={t('water_systems.level_unit')} className="sm:col-span-2">
                          <select className={smallCls} value={cfg.levelUnit} onChange={(e) => patch({ levelUnit: e.target.value as LevelUnit })}>
                            {LEVEL_UNITS.map((u) => (
                              <option key={u} value={u}>
                                {u === 'percent' ? '%' : u}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label={t('water_systems.limits')} error={err('limits')} className="sm:col-span-4">
                          <div className="flex items-center gap-1">
                            <NumInput value={cfg.lowPct} min={0} onChange={(n) => patch({ lowPct: n })} />
                            <span className="text-gray-400">–</span>
                            <NumInput value={cfg.highPct} min={0} onChange={(n) => patch({ highPct: n })} />
                          </div>
                        </Field>
                        {cfg.tanks.length > 1 && (
                          <Field label={t('water_systems.sensor_tank')} className="sm:col-span-6">
                            <select className={smallCls} value={cfg.sensorTank} onChange={(e) => patch({ sensorTank: Number(e.target.value) })}>
                              {cfg.tanks.map((x, i) => (
                                <option key={i} value={i}>
                                  {x.name || `${unitWord} ${i + 1}`}
                                </option>
                              ))}
                            </select>
                          </Field>
                        )}
                      </>
                    ) : key !== 'inletValve' ? (
                      <Field label={t('water_systems.unit')} className="sm:col-span-3">
                        <input className={smallCls} value={s.unit} onChange={(e) => patchSensor(key, { unit: e.target.value })} />
                      </Field>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      {/* ปั๊ม */}
      <Section title={t('water_systems.settings.pumps')} hint={t('water_systems.settings.pumps_hint')}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('water_systems.pump_count')}</span>
          <CountPicker value={cfg.pumps.length} min={0} max={MAX_PUMPS} onChange={setPumpCount} />
        </div>
        <div className="mt-3 space-y-2">
          {cfg.pumps.map((pump, i) => {
            const badPath = submitted && !isValidPath(pump.path);
            const badFault = submitted && pump.faultPath !== '' && !isValidPath(pump.faultPath);
            return (
              <div key={`${cfg.pumps.length}-${i}`} className="grid gap-3 rounded-lg bg-gray-50 p-3 sm:grid-cols-12 dark:bg-gray-900/50">
                <Field label={t('water_systems.pump_name')} className="sm:col-span-3">
                  <input className={`${smallCls} ${submitted && !pump.name.trim() ? errorCls : ''}`} value={pump.name} onChange={(e) => patchPump(i, { name: e.target.value })} />
                </Field>
                <div className="sm:col-span-3">
                  <span className="mb-1 block text-xs font-semibold text-gray-600 dark:text-gray-300">{t('water_systems.pump_drive')}</span>
                  <div className="inline-flex rounded-lg border border-gray-300 bg-white p-0.5 dark:border-gray-700 dark:bg-gray-900">
                    {(['inverter', 'magnetic'] as PumpDrive[]).map((drive) => (
                      <button key={drive} type="button" aria-pressed={pump.drive === drive} onClick={() => setDrive(i, drive)} className={`h-8 rounded-md px-2.5 text-xs font-semibold ${pump.drive === drive ? 'bg-sky-500 text-white' : 'text-gray-600 dark:text-gray-300'}`}>
                        {t(`water_systems.drive.${drive}`)}
                      </button>
                    ))}
                  </div>
                </div>
                <Field label={`${t('water_systems.path.label')} *`} error={badPath ? t('water_systems.error.pump_path_required') : undefined} hint={t(`water_systems.settings.pump_path_hint_${pump.drive}`)} className="sm:col-span-6">
                  <PathPicker value={pump.path} onChange={(path) => patchPump(i, { path })} points={points} types={pump.drive === 'inverter' ? ['object', 'boolean', 'number'] : ['boolean', 'number', 'object']} invalid={badPath} />
                </Field>
                <Field label={t('water_systems.pump_fault_path')} error={badFault ? t('water_systems.error.pump_path_required') : undefined} hint={t('water_systems.settings.pump_fault_hint')} className="sm:col-span-6 sm:col-start-7">
                  <PathPicker value={pump.faultPath} onChange={(faultPath) => patchPump(i, { faultPath })} points={points} types={['boolean', 'number']} invalid={badFault} />
                </Field>
              </div>
            );
          })}
        </div>
        {err('pumps') && <div className="mt-1 text-xs text-red-600 dark:text-red-400">{err('pumps')}</div>}
      </Section>

      {/* ข้อมูลทั่วไป + การเชื่อมต่อ */}
      <Section title={t('water_systems.settings.general')}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={`${t('water_systems.name')} *`} error={err('name')}>
            <input className={`${inputCls} ${err('name') ? errorCls : ''}`} value={cfg.name} onChange={(e) => patch({ name: e.target.value })} />
          </Field>
          <Field label={t('water_systems.location')}>
            <input className={inputCls} value={cfg.location} onChange={(e) => patch({ location: e.target.value })} />
          </Field>
          <Field label={`${t('water_systems.topic')} *`} error={err('topic')}>
            <input className={`${inputCls} font-mono ${err('topic') ? errorCls : ''}`} value={cfg.topic} onChange={(e) => patch({ topic: e.target.value.trim() })} spellCheck={false} />
          </Field>
          <div>
            <label className="flex items-center gap-2 text-xs font-semibold text-gray-600 dark:text-gray-300">
              <input type="checkbox" className="h-4 w-4 accent-sky-500" checked={customBroker} onChange={(e) => patch({ broker: e.target.checked ? { ...DEFAULT_BROKER } : null })} />
              {t('water_systems.settings.custom_broker')}
            </label>
            {customBroker && cfg.broker ? (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <input className={`${smallCls} font-mono sm:col-span-2 ${err('broker') ? errorCls : ''}`} value={cfg.broker.url} onChange={(e) => patch({ broker: { ...cfg.broker!, url: e.target.value.trim() } })} placeholder="wss://192.168.1.10:1884" spellCheck={false} aria-label="MQTT Broker" />
                <input className={smallCls} value={cfg.broker.username} autoComplete="off" onChange={(e) => patch({ broker: { ...cfg.broker!, username: e.target.value } })} placeholder={t('water_systems.connect.username')} aria-label={t('water_systems.connect.username')} />
                <input className={smallCls} type="password" value={cfg.broker.password} autoComplete="new-password" onChange={(e) => patch({ broker: { ...cfg.broker!, password: e.target.value } })} placeholder={t('water_systems.connect.password')} aria-label={t('water_systems.connect.password')} />
                {err('broker') && <span className="text-xs text-red-600 sm:col-span-2 dark:text-red-400">{err('broker')}</span>}
              </div>
            ) : (
              <p className="mt-1 font-mono text-xs text-gray-500 dark:text-gray-400">{DEFAULT_BROKER.url}</p>
            )}
          </div>
        </div>
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{t('water_systems.settings.connection_note')}</p>
      </Section>
    </div>
  );
}
