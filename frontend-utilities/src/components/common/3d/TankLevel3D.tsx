import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Pause, RotateCcw, RotateCw } from 'lucide-react';
import type { TankScene3D } from '@/lib/tankScene3d';
import type { SystemCalc } from '@/lib/waterSystems/model';
import type { WaterSystemKind, WaterSystemTank } from '@/types/waterSystem.types';

interface Props {
  kind: WaterSystemKind;
  tanks: WaterSystemTank[];
  /** null = ยังไม่มีค่าระดับน้ำ → วาดเฉพาะตัวถัง/บ่อ */
  calc: SystemCalc | null;
  /** สีของน้ำ (#rrggbb) */
  waterColor: string;
  /** ข้อมูลไม่สด → น้ำเป็นสีเทา */
  offline?: boolean;
  /** วาล์วเติมน้ำ: undefined = ไม่ได้เปิดใช้เซ็นเซอร์วาล์ว (ไม่วาดวาล์ว) ; null = ยังไม่มีค่า ; true = เปิด (มีสายน้ำไหล) */
  valve?: boolean | null;
  /** ข้อความบรรทัดล่างของป้ายแต่ละใบ (แทนค่าเริ่มต้น "ระดับ cm · ปริมาตร m³") เช่น ปริมาณน้ำที่เซ็นเซอร์ส่งมาเป็นลิตร */
  labelSub?: string[];
  /** ความสูงของมุมกล้องเริ่มต้น (ค่าเริ่มต้น 0.42 ; น้อยลง = มองต่ำลง) */
  viewElevation?: number;
  className?: string;
}

/**
 * ภาพ 3 มิติของถังน้ำ/บ่อเก็บน้ำ แสดงระดับน้ำ — วาดตามจำนวน รูปทรง ขนาด และสีน้ำที่ตั้งไว้
 * (ขีดสเกล 0–100% ฝั่งซ้าย ข้อความบอกระดับอยู่กลางใบ)
 * โค้ดฉากถูก import แบบ lazy เพื่อไม่ให้ three.js ถ่วงการโหลดหน้าแรก (แบบเดียวกับ PumpSystem3D)
 */
export default function TankLevel3D({
  kind,
  tanks,
  calc,
  waterColor,
  offline = false,
  valve,
  labelSub,
  viewElevation,
  className = 'h-[360px]',
}: Props) {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<TankScene3D | null>(null);
  const [ready, setReady] = useState(false);
  const [auto, setAuto] = useState(false);

  useEffect(() => {
    let disposed = false;
    import('@/lib/tankScene3d').then(({ TankScene3D }) => {
      if (disposed || !hostRef.current) return;
      sceneRef.current = new TankScene3D(hostRef.current);
      setReady(true);
    });
    return () => {
      disposed = true;
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (ready && viewElevation !== undefined) sceneRef.current?.setViewElevation(viewElevation);
  }, [ready, viewElevation]);

  // ขนาด/จำนวนเปลี่ยน → วาดใหม่ ; ค่าระดับเปลี่ยน → ขยับผิวน้ำ
  const hasValve = valve !== undefined;
  const layout = JSON.stringify([kind, hasValve, tanks.map((x) => [x.shape, x.width_m, x.length_m, x.diameter_m, x.height_m, x.offset_cm])]);
  useEffect(() => {
    const scene = sceneRef.current;
    if (!ready || !scene) return;
    scene.setLayout(
      kind,
      tanks.map((x) => ({
        name: x.name,
        shape: x.shape,
        width_m: x.width_m,
        length_m: x.length_m,
        diameter_m: x.diameter_m,
        height_m: x.height_m,
        offset_m: x.offset_cm / 100,
      })),
      hasValve
    );
    scene.setLevels(
      tanks.map((_, i) => (calc ? calc.tanks[i].level_cm / 100 : null)),
      tanks.map((x, i) => {
        const c = calc?.tanks[i];
        return {
          title: x.name,
          value: c ? `${c.percent.toFixed(1)}%` : '—',
          sub: labelSub?.[i] ?? (c ? `${c.level_cm.toFixed(0)} cm · ${(c.volume_l / 1000).toFixed(2)} m³` : ''),
        };
      }),
      waterColor,
      offline
    );
    scene.setValve(
      valve ?? null,
      valve == null ? t('water_supply.overview.valve') : valve ? t('water_supply.valve_open') : t('water_supply.valve_closed')
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- layout แทนเนื้อหาของ tanks
  }, [ready, layout, calc, waterColor, offline, valve, t, labelSub?.join('|')]);

  useEffect(() => {
    sceneRef.current?.setAutoRotate(auto);
  }, [auto, ready]);

  const btn =
    'flex h-8 w-8 items-center justify-center rounded-full border border-white/60 bg-white/70 text-gray-600 shadow-sm backdrop-blur-md transition hover:bg-white hover:text-gray-900 dark:border-white/10 dark:bg-gray-900/60 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white';
  return (
    <div
      className={`relative overflow-hidden rounded-2xl bg-[radial-gradient(ellipse_at_50%_30%,#ffffff_0%,#eef2f7_55%,#dfe5ee_100%)] dark:bg-[radial-gradient(ellipse_at_50%_0%,rgba(241,245,249,0.2)_0%,rgba(148,163,184,0.08)_34%,#111827_64%,#030712_100%)] ${className}`}
    >
      <div ref={hostRef} className="absolute inset-0" />
      {!ready && (
        <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('water_systems.scene.loading')}
        </div>
      )}
      <div className="absolute right-3 top-3 z-10 flex gap-1.5">
        <button
          type="button"
          className={btn}
          onClick={() => setAuto((v) => !v)}
          aria-pressed={auto}
          title={t('water_systems.scene.rotate')}
          aria-label={t('water_systems.scene.rotate')}
        >
          {auto ? <Pause className="h-3.5 w-3.5" /> : <RotateCw className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          className={btn}
          onClick={() => sceneRef.current?.resetView()}
          title={t('water_systems.scene.reset')}
          aria-label={t('water_systems.scene.reset')}
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      </div>
      {ready && !calc && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-gray-900/75 px-3 py-1 text-xs font-semibold text-white backdrop-blur">
          {t('water_systems.scene.no_level')}
        </div>
      )}
    </div>
  );
}
