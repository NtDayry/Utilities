import { useEffect, useRef } from 'react';
import ApexCharts from 'apexcharts';
import type { ApexOptions } from 'apexcharts';

export interface TrendPoint {
  x: number; // epoch ms
  y: number;
}

interface Props {
  name: string;
  points: TrendPoint[];
  color: string;
  height?: number;
  decimals?: number;
  /** เส้นเกณฑ์คงที่ (เช่น ต่ำ/สูง) — เปลี่ยนไม่บ่อย */
  limits?: { y: number; label: string; color: string }[];
  /** ค่าเฉลี่ย — อัปเดตทุกครั้งที่มีข้อมูลใหม่ (ไม่สร้างกราฟใหม่) */
  avg?: number | null;
  noDataText?: string;
}

const AVG_ID = 'live-avg';
let seq = 0;

/** เรียงตามเวลา + รวมจุดที่เวลาซ้ำ/ห่างกันน้อยกว่า 250 ms (เก็บค่าล่าสุด) — จุด x ซ้ำทำให้พื้นที่กราฟแบบ smooth เป็นรู */
function normalize(points: TrendPoint[]): TrendPoint[] {
  const out: TrendPoint[] = [];
  for (const p of [...points].sort((a, b) => a.x - b.x)) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const last = out[out.length - 1];
    if (last && p.x - last.x < 250) out[out.length - 1] = { x: last.x, y: p.y };
    else out.push(p);
  }
  return out;
}

/**
 * กราฟพื้นที่แบบสด: สร้าง ApexCharts ครั้งเดียวตอน mount แล้วอัปเดตเฉพาะ series (updateSeries)
 * — ไม่ส่ง options ใหม่ทุก render จึงไม่ redraw ทั้งกราฟ เส้นเลื่อนต่อเนื่องแบบ realtime
 */
export default function LiveTrendChart({ name, points, color, height = 280, decimals = 1, limits = [], avg = null, noDataText = '' }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<ApexCharts | null>(null);
  const chartId = useRef(`live-trend-${++seq}`);
  const ready = useRef(false);
  const init = useRef({ color, limitsKey: JSON.stringify(limits) });
  // ค่าที่ฟังก์ชันสเกลแกน Y อ่าน (อัปเดตทุก render โดยไม่ต้อง updateOptions)
  const scale = useRef({ limits, decimals });
  scale.current = { limits, decimals };
  const latest = useRef({ name, points, avg });
  latest.current = { name, points, avg };

  // สร้างครั้งเดียว
  useEffect(() => {
    if (!host.current) return;
    const opts: ApexOptions = {
      chart: {
        id: chartId.current,
        type: 'area',
        height,
        fontFamily: 'Outfit, sans-serif',
        toolbar: { show: false },
        zoom: { enabled: false },
        background: 'transparent',
        // ปิด morph ระหว่างอัปเดต: จำนวนจุดเปลี่ยนทุกครั้ง (หน้าต่างเลื่อน) ทำให้พื้นที่กราฟเพี้ยนระหว่าง animate
        animations: { enabled: false },
        redrawOnParentResize: true,
      },
      series: [{ name, data: normalize(points) }],
      colors: [color],
      stroke: { curve: 'smooth', width: 2 },
      fill: { type: 'gradient', gradient: { opacityFrom: 0.55, opacityTo: 0 } },
      dataLabels: { enabled: false },
      markers: { size: 0, hover: { size: 5 } },
      legend: { show: false },
      noData: { text: noDataText, style: { color: '#93969e' } },
      grid: {
        borderColor: 'rgba(148,163,184,0.18)',
        xaxis: { lines: { show: true } },
        yaxis: { lines: { show: true } },
        padding: { left: 8, right: 12 },
      },
      xaxis: {
        type: 'datetime',
        labels: { datetimeUTC: false, format: 'HH:mm:ss', style: { fontSize: '12px', colors: '#93969e' } },
        axisTicks: { show: false },
        tooltip: { enabled: false },
      },
      yaxis: {
        // ให้เส้นเกณฑ์อยู่ในกรอบเสมอ — คำนวณใหม่อัตโนมัติทุก updateSeries
        min: (min: number) => {
          const lo = Math.min(min, ...scale.current.limits.map((l) => l.y));
          return lo >= 0 ? 0 : lo;
        },
        max: (max: number) => {
          const hi = Math.max(max, ...scale.current.limits.map((l) => l.y));
          return hi + Math.max(Math.abs(hi) * 0.08, 10 ** -scale.current.decimals);
        },
        forceNiceScale: true,
        labels: { style: { fontSize: '12px', colors: '#7f838b' }, formatter: (v: number) => v.toFixed(scale.current.decimals) },
      },
      tooltip: { x: { format: 'HH:mm:ss' }, y: { formatter: (v: number) => v.toFixed(scale.current.decimals) } },
      annotations: {
        yaxis: limits.map((l) => ({
          y: l.y,
          borderColor: l.color,
          strokeDashArray: 4,
          label: { text: l.label, position: 'right', style: { color: l.color, background: 'transparent', fontSize: '10px', fontWeight: 500 } },
        })),
      },
    };
    const c = new ApexCharts(host.current, opts);
    chart.current = c;
    c.render().then(() => {
      if (chart.current !== c) return;
      ready.current = true;
      const { name: n, points: p } = latest.current;
      c.updateSeries([{ name: n, data: normalize(p) }], false);
    });
    return () => {
      ready.current = false;
      chart.current = null;
      c.destroy();
    };
    // สร้างครั้งเดียว — ค่าที่เปลี่ยนจัดการด้วย effect ด้านล่าง
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ข้อมูลใหม่ → อัปเดตเฉพาะ series + เส้นค่าเฉลี่ย
  useEffect(() => {
    const c = chart.current;
    if (!c || !ready.current) return;
    c.updateSeries([{ name, data: normalize(points) }], false);
    c.removeAnnotation(AVG_ID);
    if (avg !== null && Number.isFinite(avg) && points.length > 1) {
      c.addYaxisAnnotation({
        id: AVG_ID,
        y: avg,
        borderColor: '#3B82F6',
        strokeDashArray: 5,
        label: {
          text: `AVG ${avg.toFixed(decimals)}`,
          position: 'left',
          textAnchor: 'start',
          offsetX: 6,
          style: { color: '#3B82F6', background: 'transparent', fontSize: '10px', fontWeight: 600 },
        },
      });
    }
  }, [name, points, avg, decimals]);

  // สี / เส้นเกณฑ์เปลี่ยน (นาน ๆ ครั้ง)
  const limitsKey = JSON.stringify(limits);
  useEffect(() => {
    if (!ready.current || color === init.current.color) return;
    init.current.color = color;
    chart.current?.updateOptions({ colors: [color] }, false, false);
  }, [color]);
  useEffect(() => {
    const c = chart.current;
    if (!c || !ready.current || limitsKey === init.current.limitsKey) return;
    init.current.limitsKey = limitsKey;
    c.updateOptions(
      {
        annotations: {
          yaxis: limits.map((l) => ({
            y: l.y,
            borderColor: l.color,
            strokeDashArray: 4,
            label: { text: l.label, position: 'right', style: { color: l.color, background: 'transparent', fontSize: '10px', fontWeight: 500 } },
          })),
        },
      },
      false,
      false
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limitsKey]);

  return <div ref={host} className="min-w-[180px]" style={{ minHeight: height }} />;
}
