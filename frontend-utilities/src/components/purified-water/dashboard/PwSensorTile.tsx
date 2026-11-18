import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Thermometer } from 'lucide-react';
import { Badge, type Tone } from '@/components/common/widgets/PumpStatusCards';
import { PW_STATUS_TONE, fmtNum, type PwSensorItem, type PwTileVariant } from '@/lib/purifiedWater';
import { SIREN_CARD } from '@/lib/sirenStyle';
import type { PwSensors } from '@/hooks/usePwSensors';

/** hex (#rrggbb) + ความโปร่ง → #rrggbbaa */
const tint = (hex: string, a: number) =>
  `${hex}${Math.round(a * 255)
    .toString(16)
    .padStart(2, '0')}`;

/**
 * การ์ดเซ็นเซอร์ 1 จุด — พื้นโทนสีประจำเซ็นเซอร์แบบอ่อน (แบบหน้า HMI เดิม แต่ soft กว่า)
 * default = ค่าหลัก + อุณหภูมิ (ถ้ามี) · compact = แถวเดียวเตี้ย (ค่าการไหล) · gauge = วงแหวน (UV Index)
 * big = โหมด HMI เต็มจอ: ตัวหนังสือใหญ่ และการ์ดยืดเต็มพื้นที่
 */
export default function PwSensorTile({ item, s, big = false }: { item: PwSensorItem; s: PwSensors; big?: boolean }) {
  const variant: PwTileVariant = item.tile ?? 'default';
  const { t } = useTranslation();
  const loaded = s.has(item.metric);
  const st = s.sensorStatus(item.device, item.metric);
  const tone: Tone = loaded ? PW_STATUS_TONE[st] : 'stop';
  const alarm = loaded && st === 'warning';
  const unit = s.unit(item.device, item.metric);
  const dec = s.decimals(item.device, item.metric, 2);
  const lim = s.limits(item.device, item.metric);
  const v = s.value(item.metric);
  const hasLim = lim.min !== null || lim.max !== null;
  const limText = hasLim
    ? `${lim.min !== null && lim.max !== null ? `${fmtNum(lim.min, dec)} – ${fmtNum(lim.max, dec)}` : lim.min !== null ? `≥ ${fmtNum(lim.min, dec)}` : `≤ ${fmtNum(lim.max, dec)}`}${unit ? ` ${unit}` : ''}`
    : '';

  // HMI: ตัวเลขค่าใหญ่ขึ้น (ยกเว้นวงแหวน UV ที่กำหนดขนาดแยก)
  const valueCls = big ? 'text-5xl' : 'text-3xl';
  const unitCls = big ? 'text-lg' : 'text-sm';
  const labelCls = big ? 'text-xs' : 'text-[11px]';
  const badge = <Badge tone={loaded ? tone : 'stop'}>{loaded ? t(`pw_dashboard.status.${st}`) : t('pw_dashboard.status.waiting')}</Badge>;
  // ช่องว่างแทนค่าที่ยังไม่มี (block: span แบบ inline กำหนดความสูง/กว้างไม่ได้ จึงเคยมองไม่เห็นนอกวงแหวน UV)
  const skeleton = <span className={`block ${big ? 'h-12 w-36' : 'h-8 w-28'} animate-pulse rounded-md bg-gray-200/80 dark:bg-gray-700/60`} />;
  const value = (val: number | null, d: number, u: string, color: string | undefined, cls = '') =>
    loaded ? (
      <span className={`flex items-baseline gap-1.5 ${cls}`}>
        <span className={`${valueCls} font-extrabold tabular-nums tracking-tight`} style={color ? { color } : undefined}>
          {fmtNum(val, d)}
        </span>
        {u && <span className={`${unitCls} font-semibold text-gray-500 dark:text-gray-400`}>{u}</span>}
      </span>
    ) : (
      skeleton
    );

  // พื้น/ขอบโทนสีประจำเซ็นเซอร์ (โปร่ง ใช้ได้ทั้งธีมสว่างและมืด) ; เกินเกณฑ์ = การ์ดไซเรน
  const frame = alarm ? SIREN_CARD : '';
  const style = alarm ? undefined : { background: tint(item.color, 0.07), borderColor: tint(item.color, 0.28) };
  const title = (
    <span className={`${big ? 'text-2xl' : 'text-lg'} font-extrabold`} style={{ color: item.color }}>
      {item.label}
    </span>
  );

  if (variant === 'compact') {
    return (
      <div className={`flex h-full items-center justify-between gap-4 rounded-2xl border px-5 ${big ? 'py-7' : 'py-4'} ${frame}`} style={style}>
        <div className="min-w-0">
          <div className={`${big ? 'text-lg' : 'text-xs'} font-extrabold tracking-wider uppercase`} style={{ color: item.color }}>
            {item.label}
          </div>
          {value(v, dec, unit, item.color, 'mt-0.5')}
        </div>
        {badge}
      </div>
    );
  }

  return (
    <div className={`flex h-full flex-col rounded-2xl border p-5 ${frame}`} style={style}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        {title}
        {badge}
      </div>

      {variant === 'gauge' ? (
        <div className="flex flex-1 flex-col items-center justify-center pt-1">
          <ArcGauge value={loaded ? v : null} max={gaugeMax(s, item)} color={item.color} size={big ? 'lg' : 'md'} decimals={dec}>
            {loaded ? (
              <>
                <span className={`${big ? 'text-4xl' : 'text-3xl'} font-extrabold tabular-nums tracking-tight`} style={{ color: item.color }}>
                  {fmtNum(v, dec)}
                </span>
                {unit && <span className={`${unitCls} font-semibold text-gray-500 dark:text-gray-400`}>{unit}</span>}
              </>
            ) : (
              skeleton
            )}
          </ArcGauge>
        </div>
      ) : (
        <div className="flex flex-1 flex-col justify-around gap-2 pt-1">
          <div>
            <div className={`${labelCls} font-bold tracking-wider text-gray-500 uppercase dark:text-gray-400`}>{item.label}</div>
            {value(v, dec, unit, item.color)}
          </div>
          {item.temp && (
            <div>
              <div className={`${labelCls} inline-flex items-center gap-1 font-bold tracking-wider text-gray-500 uppercase dark:text-gray-400`}>
                <Thermometer className={big ? 'h-4 w-4' : 'h-3 w-3'} />
                {t('pw_dashboard.temperature')}
              </div>
              {s.has(item.temp) ? (
                <span className="flex items-baseline gap-1.5">
                  <span className={`${valueCls} font-extrabold tabular-nums tracking-tight text-orange-500 dark:text-orange-400`}>
                    {fmtNum(s.value(item.temp), s.decimals(item.device, item.temp, 1))}
                  </span>
                  <span className={`${unitCls} font-semibold text-gray-500 dark:text-gray-400`}>{s.unit(item.device, item.temp, '°C')}</span>
                </span>
              ) : (
                skeleton
              )}
            </div>
          )}
        </div>
      )}

      {/* เกณฑ์เตือน: ชิดล่างของการ์ดเสมอ ให้ทุกใบในแถวเดียวกันอยู่ระดับเท่ากัน */}
      {hasLim && (
        <div className={`${labelCls} mt-auto pt-3 text-gray-500 dark:text-gray-400`}>
          {t('pw_dashboard.limits')} {limText}
        </div>
      )}
    </div>
  );
}

/** สเกลเต็มของวงแหวน: ช่วงของเซ็นเซอร์ (range_max / max_range) → เกณฑ์สูง → ค่าปัจจุบัน × 1.5 */
function gaugeMax(s: PwSensors, item: PwSensorItem) {
  const c = s.configs[item.device]?.[item.metric];
  const r = Number(c?.max_range ?? c?.range_max);
  if (Number.isFinite(r) && r > 0) return r;
  const lim = s.limits(item.device, item.metric).max;
  if (lim !== null && lim > 0) return lim * 1.25;
  const v = s.value(item.metric);
  return v && v > 0 ? v * 1.5 : 1;
}

/**
 * มาตรวัดวงแหวน 270° แบบทันสมัย: แทร็กโปร่ง + ขีดสเกล 10 ช่อง + ส่วนค่าไล่เฉดสี + เรืองแสง + จุดปลายเข็ม
 * ป้าย 0 / ค่าเต็มสเกลที่ปลายสองด้าน
 */
function ArcGauge({
  value,
  max,
  color,
  size,
  decimals,
  children,
}: {
  value: number | null;
  max: number;
  color: string;
  size: 'md' | 'lg';
  decimals: number;
  children: ReactNode;
}) {
  const gid = useId().replace(/:/g, '');
  const R = 64;
  const C = 2 * Math.PI * R;
  const arc = C * 0.75;
  const pct = value === null ? 0 : Math.max(0, Math.min(1, value / max));
  // มุมของจุดบนวง (เริ่ม 135° ไปทางขวา 270°)
  const pt = (p: number, r: number) => {
    const a = ((135 + 270 * p) * Math.PI) / 180;
    return { x: 80 + Math.cos(a) * r, y: 80 + Math.sin(a) * r };
  };
  const tip = pt(pct, R);
  const ticks = Array.from({ length: 11 }, (_, i) => i / 10);
  const lo = pt(0, R + 15);
  const hi = pt(1, R + 15);
  return (
    <div className={`relative ${size === 'lg' ? 'h-60 w-60' : 'h-48 w-48'}`}>
      <svg viewBox="-4 -4 168 168" className="h-full w-full overflow-visible">
        <defs>
          <linearGradient id={`g${gid}`} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor={tint(color, 0.45)} />
            <stop offset="100%" stopColor={color} />
          </linearGradient>
          <radialGradient id={`r${gid}`} cx="50%" cy="50%" r="50%">
            <stop offset="60%" stopColor={tint(color, 0)} />
            <stop offset="100%" stopColor={tint(color, 0.1)} />
          </radialGradient>
        </defs>
        {/* พื้นวงในจาง ๆ */}
        <circle cx="80" cy="80" r={R - 12} fill={`url(#r${gid})`} />
        {/* ขีดสเกล */}
        {ticks.map((p) => {
          const a = pt(p, R - 13);
          const major = Math.round(p * 10) % 5 === 0;
          const inner = pt(p, major ? R - 21 : R - 17);
          return (
            <line
              key={p}
              x1={a.x}
              y1={a.y}
              x2={inner.x}
              y2={inner.y}
              stroke={tint(color, major ? 0.55 : 0.3)}
              strokeWidth={major ? 1.6 : 1}
              strokeLinecap="round"
            />
          );
        })}
        {/* แทร็ก */}
        <circle
          cx="80"
          cy="80"
          r={R}
          fill="none"
          strokeWidth="10"
          strokeLinecap="round"
          stroke={tint(color, 0.14)}
          strokeDasharray={`${arc} ${C}`}
          transform="rotate(135 80 80)"
        />
        {/* ค่า */}
        <circle
          cx="80"
          cy="80"
          r={R}
          fill="none"
          strokeWidth="10"
          strokeLinecap="round"
          stroke={`url(#g${gid})`}
          strokeDasharray={`${arc * pct} ${C}`}
          transform="rotate(135 80 80)"
          style={{ transition: 'stroke-dasharray .8s ease', filter: `drop-shadow(0 0 8px ${tint(color, 0.45)})` }}
        />
        {/* จุดปลาย */}
        {value !== null && (
          <circle
            cx={tip.x}
            cy={tip.y}
            r="7"
            fill="#fff"
            stroke={color}
            strokeWidth="3"
            style={{ filter: `drop-shadow(0 0 6px ${tint(color, 0.6)})` }}
          />
        )}
        <text
          x={lo.x}
          y={lo.y + 4}
          textAnchor="middle"
          fontSize="9"
          fontWeight="600"
          fill="currentColor"
          className="text-gray-400 dark:text-gray-500"
        >
          0
        </text>
        <text
          x={hi.x}
          y={hi.y + 4}
          textAnchor="middle"
          fontSize="9"
          fontWeight="600"
          fill="currentColor"
          className="text-gray-400 dark:text-gray-500"
        >
          {fmtNum(max, max >= 100 ? 0 : decimals)}
        </text>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}
