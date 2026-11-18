import { useMemo, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, FlaskConical, MapPin, PlugZap, Radio } from 'lucide-react';
import PageMeta from '@/components/common/page/PageMeta';
import BackNav from '@/components/common/navigation/BackNav';
import TankLevel3D from '@/components/common/3d/TankLevel3D';
import TrendCard from '@/components/common/charts/TrendCard';
import type { TrendPoint } from '@/components/common/charts/LiveTrendChart';
import { card } from '@/components/common/widgets/SystemPageParts';
import PwSensorTile from '@/components/purified-water/dashboard/PwSensorTile';
import { useNow } from '@/hooks/useWaterSystemTopics';
import { usePwTankLevel } from '@/hooks/usePwTankLevel';
import { PW_STALE_MS } from '@/hooks/usePwSensors';
import { PW_GROUPS, PW_LEVEL, fmtNum } from '@/lib/purifiedWater';
import { calcSystem, newSystem } from '@/lib/waterSystems/model';
import { URL } from '@/api';

const HISTORY_POINTS = 120;
const WATER_COLOR = '#0ea5e9';
/** ขนาดถัง PW ในภาพ 3 มิติ (ประมาณ — ใช้วาดอย่างเดียว ไม่แสดงตัวเลข) : กว้าง ⌀ 3 ม. × สูง 2 ม. */
const TANK_H = 2;
const TANK_D = 3;

/**
 * หน้า Purified Water (route: /purified-water/dashboard) — รูปแบบเดียวกับหน้าถังน้ำ/บ่อเก็บน้ำ (/water-supply/systems/:id)
 * แถบหัว · การ์ด PW Tank (ภาพ 3 มิติ + ปริมาณ + มิเตอร์) ซ้าย · การ์ด Distribution Loop / RO System ขวา · แนวโน้ม
 * ข้อมูลและกลุ่มเซ็นเซอร์เหมือนเดิม (MQTT ผ่าน lib/purifiedWater/pwMqttLive + sensor configs / alert rules จาก backend)
 * โหมด HMI เต็มจอ (hmi): หน้าเดียวกันแต่ซ่อนแถบหัว
 */
export default function PurifiedWaterDashboard({ hmi = false }: { hmi?: boolean }) {
  const { t } = useTranslation();
  const now = useNow();
  const pw = usePwTankLevel();
  const s = pw.sensors;

  const hasData = pw.lastUpdate !== null;
  const live = s.status === 'connected' && hasData && now - (pw.lastUpdate ?? 0) <= PW_STALE_MS;
  const levelLoaded = s.has(PW_LEVEL.metric);

  // ถัง PW ในภาพ 3 มิติ: ทรงกระบอกมีฝา ; ระดับน้ำตาม % ที่คำนวณจากค่าเซ็นเซอร์ (ลิตร) เทียบช่วงสูงสุด
  const sys = useMemo(() => {
    const cfg = newSystem('tank');
    cfg.tanks = [{ ...cfg.tanks[0], name: 'PW Tank', diameter_m: TANK_D, height_m: TANK_H }];
    return cfg;
  }, []);
  const calc = pw.percent === null ? null : calcSystem(sys, (pw.percent / 100) * TANK_H * 100);
  // ป้ายในภาพ: ปริมาณน้ำตามที่เซ็นเซอร์ส่งมา (ลิตร) แทนระดับ cm
  const labelSub = [pw.level === null ? '' : `${fmtNum(pw.level, 0)} ${pw.unit}`];

  // ประวัติ (ในหน่วยความจำตั้งแต่เปิดหน้า) — เพิ่มจุดเมื่อมีข้อมูลใหม่เท่านั้น
  const hist = useRef<{ at: number | null; level: TrendPoint[]; conduct: TrendPoint[] }>({ at: null, level: [], conduct: [] });
  if (pw.lastUpdate !== null && hist.current.at !== pw.lastUpdate) {
    const at = pw.lastUpdate;
    hist.current.at = at;
    if (pw.percent !== null) hist.current.level = [...hist.current.level, { x: at, y: Number(pw.percent.toFixed(1)) }].slice(-HISTORY_POINTS);
    const c = s.value('dis_loop_conduct');
    if (c !== null) hist.current.conduct = [...hist.current.conduct, { x: at, y: c }].slice(-HISTORY_POINTS);
  }

  // สรุปสถานะทุกเซ็นเซอร์ (ไม่นับที่ยังไม่มีข้อมูล)
  const all = PW_GROUPS.flatMap((g) => g.items).filter((x) => s.has(x.metric));
  const issues = all.filter((x) => s.sensorStatus(x.device, x.metric) !== 'normal');
  const critical = issues.some((x) => s.sensorStatus(x.device, x.metric) === 'warning');
  const levelLow = pw.percent !== null && pw.lowPct !== null && pw.percent < pw.lowPct;
  const overall = !hasData
    ? { cls: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300', text: t('pw_dashboard.status.waiting') }
    : issues.length || levelLow
      ? {
          cls: critical || levelLow ? 'bg-error-600 text-white' : 'bg-warning-100 text-warning-700 dark:bg-warning-500/15 dark:text-warning-300',
          text: t('pw_dashboard.overall_attention', { n: issues.length + (levelLow ? 1 : 0) }),
        }
      : { cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300', text: t('pw_dashboard.overall_normal') };

  const location = t('data.water_tanks.tank_sites.pwtank.location');
  const updatedText = pw.lastUpdate ? new Date(pw.lastUpdate).toLocaleTimeString() : t('water_systems.detail.never');
  const tankGroup = PW_GROUPS[0];

  return (
    // โหมด HMI: ไม่มีแถบหัว/กราฟ การ์ดยืดเต็มจอ ตัวหนังสือใหญ่
    <div className={hmi ? 'flex h-[calc(100vh-6.5rem)] min-h-[640px] flex-col gap-6' : 'space-y-8 pb-12'}>
      <PageMeta title="Purified Water" description="Purified water system — PW tank, distribution loop and RO" />

      {/* ============ หัวหน้า: ชื่อ + สถานะ + ปุ่มกลับ (ซ่อนในโหมด HMI) ============ */}
      {!hmi && (
        <section className={`${card} p-5 sm:p-6`}>
          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-emerald-500 text-white shadow-lg">
                <FlaskConical className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">{t('pw_dashboard.eyebrow')}</div>
                <h1 className="truncate text-2xl font-extrabold tracking-tight text-gray-900 dark:text-white">Purified Water</h1>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
                  <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 dark:bg-gray-700">
                    <MapPin className="h-3 w-3" />
                    {location}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 dark:bg-gray-700">
                    <Radio className="h-3 w-3" />
                    MQTT
                  </span>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${overall.cls}`}>
                {(critical || levelLow) && <AlertTriangle className="h-3.5 w-3.5" />}
                {overall.text}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white/80 px-3 py-1 text-xs font-semibold text-gray-600 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-300">
                <span className="relative flex h-2 w-2">
                  {live && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />}
                  <span
                    className={`relative inline-flex h-2 w-2 rounded-full ${live ? 'bg-emerald-500' : hasData ? 'bg-gray-400' : s.status === 'offline' ? 'bg-red-500' : 'bg-amber-400'}`}
                  />
                </span>
                {live
                  ? t('water_supply.live')
                  : hasData
                    ? t('water_supply.stale_data')
                    : s.status === 'offline'
                      ? t('water_supply.offline')
                      : t('water_supply.connecting')}
                <span className="text-gray-400">· {updatedText}</span>
              </span>
            </div>
          </div>
          <div className="mt-4">
            <BackNav
              to={URL.WATER_SUPPLY_DASHBOARD}
              label={t('water_supply.overview.back_to_overview')}
              crumbs={[{ label: t('navbar.water_supply_dashboard'), to: URL.WATER_SUPPLY_DASHBOARD }, { label: 'Purified Water' }]}
              className=""
            />
          </div>
        </section>
      )}

      {/* ยังไม่มีข้อมูลเข้า */}
      {!hasData && (
        <div className="flex items-start gap-3 rounded-2xl border border-dashed border-amber-300 bg-amber-50/60 p-4 dark:border-amber-800/60 dark:bg-amber-500/5">
          <PlugZap className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div>
            <div className="text-sm font-bold text-gray-800 dark:text-gray-100">{t('pw_dashboard.no_data_title')}</div>
            <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">{t('pw_dashboard.no_data_desc')}</p>
          </div>
        </div>
      )}

      {/* ============ PW Tank (ซ้าย) | Distribution Loop + RO System (ขวา) — ตำแหน่งการ์ดตามหน้า HMI เดิม ============ */}
      <div className={`grid xl:grid-cols-12 ${hmi ? 'min-h-0 flex-1 gap-6' : 'gap-8'}`}>
        {/* PW Tank: ภาพ 3 มิติ + ปริมาณ/ความจุ + แถบระดับ + มิเตอร์น้ำ */}
        <section className={`${card} flex flex-col p-6 xl:col-span-4 ${hmi ? 'min-h-0' : ''}`}>
          <GroupTitle title={tankGroup.title} subtitle={tankGroup.subtitle} accent={tankGroup.accent} big={hmi} />
          <div className={`mt-4 flex-1 ${hmi ? 'min-h-[300px]' : 'min-h-[420px]'}`}>
            <TankLevel3D
              kind="tank"
              tanks={sys.tanks}
              calc={calc}
              waterColor={WATER_COLOR}
              offline={hasData && !live}
              labelSub={labelSub}
              viewElevation={0.2}
              className="h-[420px] xl:h-full"
            />
          </div>

          <div className="mt-5 text-center">
            <div className={`${hmi ? 'text-4xl' : 'text-2xl'} font-extrabold tabular-nums tracking-tight`} style={{ color: WATER_COLOR }}>
              {levelLoaded && pw.level !== null ? fmtNum(pw.level, 0) : <Blank className={`mr-1 ${hmi ? 'h-9 w-24' : 'h-6 w-16'}`} />}
              <span className="text-teal-400 dark:text-teal-500">/{pw.maxRange.toLocaleString()}</span>
              <span className="ml-1.5 text-base font-semibold text-gray-500 dark:text-gray-400">{pw.unit}</span>
            </div>
          </div>
          <div className="mt-3">
            <div className="relative h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-700"
                style={{ width: `${pw.percent ?? 0}%` }}
              />
              {pw.lowPct !== null && <span className="absolute inset-y-0 w-0.5 bg-red-500" style={{ left: `${pw.lowPct}%` }} />}
              {pw.highPct !== null && <span className="absolute inset-y-0 w-0.5 bg-amber-500" style={{ left: `${pw.highPct}%` }} />}
            </div>
            <div className={`mt-1.5 flex justify-between text-gray-500 dark:text-gray-400 ${hmi ? 'text-sm' : 'text-[11px]'}`}>
              <span>Empty</span>
              <span className="tabular-nums">
                {pw.lowPct !== null && <span className="text-red-500">MIN {pw.lowPct.toFixed(0)}%</span>}
                {pw.lowPct !== null && pw.highPct !== null && ' · '}
                {pw.highPct !== null && <span className="text-amber-500">MAX {pw.highPct.toFixed(0)}%</span>}
              </span>
              <span>Full</span>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-4 border-t border-gray-100 pt-4 dark:border-gray-700">
            {tankGroup.items.map((it) => (
              <div key={it.id} className={it.id === tankGroup.items[1]?.id ? 'text-right' : ''}>
                <div className={`${hmi ? 'text-sm' : 'text-[11px]'} font-bold tracking-wider text-gray-500 uppercase dark:text-gray-400`}>
                  {it.label}
                </div>
                <div className={`mt-0.5 flex items-baseline gap-1.5 ${it.id === tankGroup.items[1]?.id ? 'justify-end' : ''}`}>
                  <span className={`${hmi ? 'text-4xl' : 'text-2xl'} font-extrabold tabular-nums tracking-tight`} style={{ color: it.color }}>
                    {s.has(it.metric) ? fmtNum(s.value(it.metric), s.decimals(it.device, it.metric, 2)) : <Blank className={hmi ? 'h-9 w-24' : 'h-6 w-16'} />}
                  </span>
                  <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">{s.unit(it.device, it.metric)}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Distribution Loop + RO System: การ์ดกลุ่ม มีการ์ดเซ็นเซอร์อยู่ภายใน */}
        <div className={`flex flex-col xl:col-span-8 ${hmi ? 'min-h-0 gap-6' : 'gap-8'}`}>
          {PW_GROUPS.slice(1).map((g) => {
            // กลุ่มที่มีมากกว่า 3 จุด แบ่งเป็นแถวละ 3 + ที่เหลือเต็มแถว (คุณภาพน้ำ 3 จุด / การไหล 2 จุด)
            const rows = g.items.length > 3 ? [g.items.slice(0, 3), g.items.slice(3)] : [g.items];
            return (
              // สัดส่วนความสูงคอลัมน์ขวา: Distribution Loop 6 ส่วน : RO System 4 ส่วน
              <section key={g.id} className={`${card} flex flex-col gap-5 p-6 ${g.id === 'loop' ? 'flex-[6]' : 'flex-[4]'}`}>
                <GroupTitle title={g.title} subtitle={g.subtitle} accent={g.accent} big={hmi} />
                {rows.map((row, i) => (
                  <div
                    key={i}
                    className={`grid grid-cols-1 gap-5 sm:grid-cols-2 ${row.length === 3 ? 'lg:grid-cols-3' : ''} ${row.length === 3 ? 'flex-1' : ''}`}
                  >
                    {row.map((it) => (
                      <PwSensorTile key={it.id} item={it} s={s} big={hmi} />
                    ))}
                  </div>
                ))}
              </section>
            );
          })}
        </div>
      </div>

      {/* ============ แนวโน้ม (ตั้งแต่เปิดหน้า) — ซ่อนในโหมด HMI ============ */}
      {!hmi && (
        <section className="space-y-4">
          <h2 className="px-1 text-sm font-bold text-gray-900 dark:text-white">{t('water_systems.detail.trends')}</h2>
          <div className="grid gap-6 lg:grid-cols-2">
            <TrendCard
              title={t('pw_dashboard.trend_level')}
              unit="%"
              points={hist.current.level}
              current={pw.percent}
              currentSuffix={pw.level === null ? undefined : `(${fmtNum(pw.level, 0)} ${pw.unit})`}
              defaultColor={WATER_COLOR}
              decimals={1}
              height={260}
              limits={[
                ...(pw.lowPct !== null ? [{ y: Number(pw.lowPct.toFixed(1)), label: `LOW ${pw.lowPct.toFixed(0)}%`, color: '#F59E0B' }] : []),
                ...(pw.highPct !== null ? [{ y: Number(pw.highPct.toFixed(1)), label: `HIGH ${pw.highPct.toFixed(0)}%`, color: '#EF4444' }] : []),
              ]}
              boxClassName={card}
            />
            <TrendCard
              title={t('pw_dashboard.trend_conduct')}
              unit={s.unit('distribution_loop', 'dis_loop_conduct')}
              points={hist.current.conduct}
              current={s.value('dis_loop_conduct')}
              defaultColor="#06b6d4"
              decimals={s.decimals('distribution_loop', 'dis_loop_conduct', 2)}
              height={260}
              limits={(() => {
                const l = s.limits('distribution_loop', 'dis_loop_conduct');
                return [
                  ...(l.min !== null ? [{ y: l.min, label: `MIN ${l.min}`, color: '#F59E0B' }] : []),
                  ...(l.max !== null ? [{ y: l.max, label: `MAX ${l.max}`, color: '#EF4444' }] : []),
                ];
              })()}
              alarm={s.has('dis_loop_conduct') && s.sensorStatus('distribution_loop', 'dis_loop_conduct') === 'warning'}
              alarmLabel={t('pw_dashboard.status.warning')}
              boxClassName={card}
            />
          </div>
        </section>
      )}
    </div>
  );
}

/** หัวข้อกลุ่มเซ็นเซอร์: แถบสีประจำกลุ่ม + ชื่อ + คำอธิบาย */
function GroupTitle({
  title,
  subtitle,
  accent,
  icon,
  big = false,
}: {
  title: string;
  subtitle: string;
  accent: string;
  icon?: ReactNode;
  big?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 px-1">
      <span className={`${big ? 'h-7' : 'h-5'} w-1 rounded-full`} style={{ background: accent }} />
      {icon && <span className="text-gray-400 dark:text-gray-500">{icon}</span>}
      <h2 className={`${big ? 'text-xl' : 'text-base'} font-bold uppercase tracking-wider text-gray-900 dark:text-white`}>{title}</h2>
      <span className={`${big ? 'text-base' : 'text-sm'} text-gray-500 dark:text-gray-400`}>{subtitle}</span>
    </div>
  );
}

/** ช่องว่างแทนค่าที่ยังไม่มี (แบบเดียวกับการ์ดเซ็นเซอร์ / วงแหวน UV) */
function Blank({ className }: { className: string }) {
  return <span className={`inline-block align-middle animate-pulse rounded-md bg-gray-200/80 dark:bg-gray-700/60 ${className}`} />;
}
