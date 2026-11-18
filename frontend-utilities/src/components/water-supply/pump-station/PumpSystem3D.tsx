import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Expand, Minimize, Pause, RotateCcw, RotateCw, Tag, Tags, Loader2 } from 'lucide-react';
import type { DisplayUnit, TankCalculations, TankConfig, TankData } from '@/types/waterSupply.types';
import type { PumpScene3D } from '@/lib/pumpScene3d';

interface Props {
  conn?: { text: string; cls: string };
  data: TankData;
  hasData: boolean;
  percent: number;
  low: boolean;
  high: boolean;
  tankConfig?: TankConfig;
  displayUnit?: DisplayUnit;
  tankCalculations?: TankCalculations;
}

const LEGEND = [
  { key: 'run', color: 'bg-emerald-500' },
  { key: 'sleep', color: 'bg-amber-500' },
  { key: 'fault', color: 'bg-red-500' },
  { key: 'stop', color: 'bg-slate-500' },
  { key: 'flow', color: 'bg-cyan-400' },
] as const;

/**
 * ผังระบบบ่อน้ำประปา + บูสเตอร์ปั๊มแบบ 3 มิติ (three.js) — แสดงค่าจาก MQTT แบบเรียลไทม์
 * โค้ดฉากถูก import แบบแยกไฟล์ (lazy) เพื่อไม่ให้ three.js ถ่วงการโหลดหน้าแรก
 */
export default function PumpSystem3D({ data, hasData, percent, low, high, conn, tankConfig, displayUnit, tankCalculations }: Props) {
  const { t, i18n } = useTranslation();
  const hostRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLElement>(null);
  const sceneRef = useRef<PumpScene3D | null>(null);
  const latest = useRef({ data, percent, low, high, tankConfig, displayUnit, tankCalculations });
  latest.current = { data, percent, low, high, tankConfig, displayUnit, tankCalculations };
  const [ready, setReady] = useState(false);
  const [auto, setAuto] = useState(false);
  const [labels, setLabels] = useState(true);
  const [full, setFull] = useState(false);

  // สร้างฉากครั้งเดียว
  useEffect(() => {
    let disposed = false;
    import('@/lib/pumpScene3d').then(({ PumpScene3D }) => {
      if (disposed || !hostRef.current) return;
      const scene = new PumpScene3D(hostRef.current);
      scene.setLang(i18n.language);
      scene.update(latest.current);
      sceneRef.current = scene;
      setReady(true);
    });
    return () => {
      disposed = true;
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ตาม Theme Dark / Light
  useEffect(() => {
    const sync = () => sceneRef.current?.setTheme(document.documentElement.classList.contains('dark'));
    sync();
    const ob = new MutationObserver(sync);
    ob.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => ob.disconnect();
  }, [ready]);

  useEffect(() => {
    sceneRef.current?.setLang(i18n.language);
  }, [i18n.language, ready]);

  useEffect(() => {
    sceneRef.current?.update({ data, percent, low, high, tankConfig, displayUnit, tankCalculations });
  }, [data, percent, low, high, tankConfig, displayUnit, tankCalculations, ready]);

  useEffect(() => sceneRef.current?.setAutoRotate(auto), [auto, ready]);
  useEffect(() => sceneRef.current?.setLabelsVisible(labels), [labels, ready]);

  useEffect(() => {
    const onFs = () => setFull(document.fullscreenElement === frameRef.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else frameRef.current?.requestFullscreen?.();
  };

  const btn =
    'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold shadow-sm transition active:scale-95';
  const idle =
    'border-gray-300 bg-gray-50 text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700';
  const on =
    'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300';

  return (
    <section
      ref={frameRef}
      className={`rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-white/[0.03] ${full ? 'flex flex-col' : ''}`}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-800 dark:text-gray-200">
            {t('water_supply.diagram_3d_title')}
          </h2>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{t('water_supply.scene3d.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={`${btn} ${labels ? on : idle}`} onClick={() => setLabels((v) => !v)}>
            {labels ? <Tags className="h-3.5 w-3.5" /> : <Tag className="h-3.5 w-3.5" />}
            <span>{labels ? t('water_supply.scene3d.hide_labels') : t('water_supply.scene3d.show_labels')}</span>
          </button>
          <button type="button" className={`${btn} ${auto ? on : idle}`} onClick={() => setAuto((v) => !v)}>
            {auto ? <Pause className="h-3.5 w-3.5" /> : <RotateCw className="h-3.5 w-3.5" />}
            <span>{auto ? t('water_supply.auto_rotate_off') : t('water_supply.auto_rotate_on')}</span>
          </button>
          <button type="button" className={`${btn} ${idle}`} onClick={() => sceneRef.current?.resetView()}>
            <RotateCcw className="h-3.5 w-3.5" />
            <span>{t('water_supply.reset_view')}</span>
          </button>
          <button type="button" className={`${btn} ${idle}`} onClick={toggleFull} title={t('water_supply.scene3d.fullscreen')}>
            {full ? <Minimize className="h-3.5 w-3.5" /> : <Expand className="h-3.5 w-3.5" />}
          </button>
          {conn && <span className={`rounded-full px-3 py-1 text-xs font-semibold ${conn.cls}`}>● {conn.text}</span>}
        </div>
      </div>

      <div
        ref={hostRef}
        className={`relative w-full overflow-hidden rounded-xl border border-gray-200 bg-slate-200 shadow-inner dark:border-gray-800 dark:bg-slate-950 ${full ? 'flex-1' : ''}`}
        style={full ? undefined : { aspectRatio: '2.6 / 1', minHeight: 420 }}
      >
        {!ready && (
          <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('water_supply.scene3d.loading')}
          </div>
        )}
        {ready && !hasData && (
          <div className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full bg-amber-500/90 px-3 py-1 text-xs font-semibold text-white shadow">
            {t('water_supply.scene3d.waiting')}
          </div>
        )}
        {/* Legend + คำแนะนำการใช้งาน */}
        <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-white/80 px-3 py-1.5 text-[11px] font-medium text-gray-600 shadow backdrop-blur dark:bg-gray-900/75 dark:text-gray-300">
          {LEGEND.map((l) => (
            <span key={l.key} className="inline-flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${l.color}`} />
              {t(`water_supply.scene3d.legend_${l.key}`)}
            </span>
          ))}
        </div>
        <div className="pointer-events-none absolute bottom-3 right-3 z-10 hidden rounded-lg bg-white/80 px-3 py-1.5 text-[11px] text-gray-500 shadow backdrop-blur sm:block dark:bg-gray-900/75 dark:text-gray-400">
          {t('water_supply.scene3d.hint')}
        </div>
      </div>
    </section>
  );
}
