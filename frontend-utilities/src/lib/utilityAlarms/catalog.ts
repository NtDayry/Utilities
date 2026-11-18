/**
 * รายการกลุ่มเซนเซอร์ + เซนเซอร์ที่ตั้งการแจ้งเตือนได้ ของแต่ละระบบ
 *
 * อ้างอิงจุดเดียวกับหน้า dashboard/แผนผังโรงงาน:
 *   ประปา      → lib/waterTanks (TANK_SITES) + บ่อประปา/ปั๊ม
 *   ไฟฟ้า      → lib/electricalPoints (ELECTRICAL_POINTS, readingAt)
 *   น้ำเสีย     → lib/wastewaterUnits (WW_UNITS — ค่า normal/limit ของแต่ละพารามิเตอร์เป็นค่าตั้งต้น)
 *
 * ⚠️ MOCKUP: ฟังก์ชัน read() เป็นค่าจำลอง — เมื่อมีข้อมูลจริงให้แทนด้วยค่าจาก MQTT/API
 * การเพิ่มเซนเซอร์ใหม่ = เพิ่ม AlarmSensorDef 1 รายการในกลุ่มที่ต้องการ (หน้าเว็บแสดงตามรายการนี้อัตโนมัติ)
 */
import { locEn, locTh } from '@/lib/locText';
import { TANK_SITES } from '@/lib/waterTanks';
import { ELECTRICAL_POINTS, readingAt, type ElectricalPoint } from '@/lib/electricalPoints';
import { WW_UNITS, type WwUnitKey } from '@/lib/wastewaterUnits';
import type { AlarmGroupDef, AlarmRule, AlarmSensorDef, UtilitySystem } from './types';

type Vars = Record<string, string | number>;
const L = (k: string, v?: Vars) => ({ th: locTh(`data.utility_alarms.${k}`, v), en: locEn(`data.utility_alarms.${k}`, v) });

const TAU = 2 * Math.PI;
const BKK_H = 7;
const hourOfDay = (ms: number) => (((ms / 3_600_000 + BKK_H) % 24) + 24) % 24;
const wob = (ms: number, seed: number) => {
  const h = ms / 3_600_000;
  return 0.5 * Math.sin(h * 1.1 + seed) + 0.3 * Math.sin(h * 3.3 + seed * 1.7) + 0.2 * Math.sin(h * 8.9 + seed * 0.5);
};

/* ====================================================================== */
/* ประปา                                                                   */
/* ====================================================================== */
function waterCatalog() {
  const groups: AlarmGroupDef[] = [
    { id: 'ws_station', system: 'water', icon: 'pond', ...pair('water.station') },
    { id: 'ws_pumps', system: 'water', icon: 'pump', ...pair('water.pumps') },
    { id: 'ws_tanks', system: 'water', icon: 'tank', ...pair('water.tanks') },
    { id: 'ws_meter', system: 'water', icon: 'meter', ...pair('water.meter') },
  ];
  const station = L('water.dev.station');
  const meter = L('water.dev.main_meter');
  const sensors: AlarmSensorDef[] = [
    analog('ws_station', 'ws.pond1.level', 'water-system', 'pond1_level', station, L('water.m.pond1_level'), '%', 1,
      (ms) => 58 + 22 * Math.sin((TAU * (hourOfDay(ms) - 4)) / 24) + 4 * wob(ms, 1), { ll: 10, l: 25, h: 95, hh: 98, deadband: 1 }, 0.1),
    analog('ws_station', 'ws.pond2.level', 'water-system', 'pond2_level', station, L('water.m.pond2_level'), '%', 1,
      (ms) => 62 + 20 * Math.sin((TAU * (hourOfDay(ms) - 5)) / 24) + 4 * wob(ms, 2), { ll: 10, l: 25, h: 95, hh: 98, deadband: 1 }, 0.08),
    analog('ws_station', 'ws.line.pressure', 'water-system', 'line_pressure', station, L('water.m.line_pressure'), 'bar', 2,
      (ms) => 3.1 + 0.35 * wob(ms, 3), { ll: 1.5, l: 2.2, h: 4.5, hh: 5.5, deadband: 0.1, delaySec: 30 }, 0.12),
    digital('ws_station', 'ws.valve.fault', 'water-system', 'inlet_valve_fault', station, L('water.m.valve_fault'), L('state.fault'), 'warning', 0.03),
    digital('ws_station', 'ws.controller.comm', 'water-system', 'controller_comm', station, L('water.m.controller_comm'), L('state.offline'), 'warning', 0.05, true),

    digital('ws_pumps', 'ws.pump1.trip', 'water-system', 'pump1_trip', L('water.dev.pump1'), L('water.m.pump_trip'), L('state.trip'), 'critical', 0.04),
    analog('ws_pumps', 'ws.pump1.current', 'water-system', 'pump1_current', L('water.dev.pump1'), L('water.m.pump_current'), 'A', 1,
      (ms) => (hourOfDay(ms) > 6 && hourOfDay(ms) < 19 ? 7.8 + 0.4 * wob(ms, 4) : 0), { h: 10, hh: 12, deadband: 0.2, delaySec: 10 }, 0.04),
    digital('ws_pumps', 'ws.pump2.trip', 'water-system', 'pump2_trip', L('water.dev.pump2'), L('water.m.pump_trip'), L('state.trip'), 'critical', 0.03),
    analog('ws_pumps', 'ws.pump2.current', 'water-system', 'pump2_current', L('water.dev.pump2'), L('water.m.pump_current'), 'A', 1,
      (ms) => (hourOfDay(ms) > 8 && hourOfDay(ms) < 17 ? 7.6 + 0.4 * wob(ms, 5) : 0), { h: 10, hh: 12, deadband: 0.2, delaySec: 10 }, 0.03),
    digital('ws_pumps', 'ws.pump.dryrun', 'water-system', 'dry_run', L('water.dev.pumps'), L('water.m.dry_run'), L('state.active'), 'critical', 0.02),
  ];

  TANK_SITES.filter((t) => t.group !== 'effluent' && t.key !== 'pump').forEach((t, i) => {
    sensors.push(
      analog('ws_tanks', `ws.${t.key}.level`, t.key, 'water_level', { th: t.th, en: t.en }, L('water.m.level'), '%', 1,
        (ms) => 60 + 22 * Math.sin((TAU * (hourOfDay(ms) - 3 - i)) / 24) + 5 * wob(ms, 10 + i),
        { ll: Math.max(5, t.lowPct - 10), l: t.lowPct, h: t.highPct, hh: Math.min(99, t.highPct + 3), deadband: 1 }, 0.07),
    );
  });

  sensors.push(
    analog('ws_meter', 'ws.meter.flow', 'water-meter', 'flow_rate', meter, L('water.m.flow'), 'm³/h', 2,
      (ms) => Math.max(0.2, 6 + 5 * Math.sin((TAU * (hourOfDay(ms) - 8)) / 24) + 0.6 * wob(ms, 20)), { h: 14, hh: 18, deadband: 0.5 }, 0.05),
    analog('ws_meter', 'ws.meter.night_flow', 'water-meter', 'night_flow', meter, L('water.m.night_flow'), 'm³/h', 2,
      (ms) => Math.max(0, 0.45 + 0.25 * wob(ms, 21)), { h: 1.5, hh: 3, deadband: 0.1, delaySec: 1800 }, 0.04),
    analog('ws_meter', 'ws.meter.daily', 'water-meter', 'daily_usage', meter, L('water.m.daily'), 'm³', 1,
      (ms) => 92 + 14 * wob(ms, 22), { h: 150, hh: 200, delaySec: 0 }, 0.03),
  );
  return { groups, sensors };
}

/* ====================================================================== */
/* ไฟฟ้า                                                                   */
/* ====================================================================== */
function electricalCatalog() {
  const groups: AlarmGroupDef[] = [
    { id: 'el_main', system: 'electrical', icon: 'bolt', ...pair('electrical.main') },
    { id: 'el_tr', system: 'electrical', icon: 'transformer', ...pair('electrical.transformer') },
    { id: 'el_chiller', system: 'electrical', icon: 'chiller', ...pair('electrical.chiller') },
    { id: 'el_utility', system: 'electrical', icon: 'air', ...pair('electrical.utility') },
  ];
  const groupOf: Record<ElectricalPoint['type'], string> = { main: 'el_main', transformer: 'el_tr', chiller: 'el_chiller', utility: 'el_utility' };
  const sensors: AlarmSensorDef[] = [];
  for (const p of ELECTRICAL_POINTS) {
    const g = groupOf[p.type];
    const dev = { th: p.th, en: p.en };
    const dn = `meter.${p.key}`;
    const r = (ms: number) => readingAt(p, ms);
    sensors.push(
      analog(g, `${p.key}.vll`, dn, 'voltage_ll', dev, L('electrical.m.voltage'), 'V', 1, (ms) => r(ms).vLL,
        { ll: 360, l: 380, h: 420, hh: 440, deadband: 2, delaySec: 10 }, 0.05),
    );
    if (p.type === 'transformer') {
      sensors.push(
        analog(g, `${p.key}.load`, dn, 'load_pct', dev, L('electrical.m.load'), '%', 1, (ms) => r(ms).loadPct ?? 0,
          { h: 80, hh: 95, deadband: 2, delaySec: 300 }, 0.06),
      );
    } else {
      const hi = Math.round(p.baseKw * 1.35);
      sensors.push(
        analog(g, `${p.key}.kw`, dn, 'demand_kw', dev, L('electrical.m.demand'), 'kW', 1, (ms) => r(ms).kw,
          { h: hi, hh: Math.round(p.baseKw * 1.6), deadband: Math.max(1, Math.round(p.baseKw * 0.02)), delaySec: 900 }, 0.05),
      );
    }
    sensors.push(
      analog(g, `${p.key}.unbal`, dn, 'current_unbalance', dev, L('electrical.m.unbalance'), '%', 1, (ms) => r(ms).unbalancePct,
        { h: 10, hh: 20, deadband: 1, delaySec: 300 }, 0.04),
      analog(g, `${p.key}.pf`, dn, 'power_factor', dev, L('electrical.m.pf'), '', 2, (ms) => r(ms).pf,
        { ll: 0.8, l: 0.85, deadband: 0.01, delaySec: 900 }, 0.05),
    );
    if (p.type === 'main') {
      sensors.push(
        analog(g, `${p.key}.hz`, dn, 'frequency', dev, L('electrical.m.freq'), 'Hz', 2, (ms) => r(ms).hz,
          { ll: 49, l: 49.5, h: 50.5, hh: 51, deadband: 0.05, delaySec: 5 }, 0.02),
        digital(g, `${p.key}.phase_loss`, dn, 'phase_loss', dev, L('electrical.m.phase_loss'), L('state.active'), 'critical', 0.01),
      );
    }
    sensors.push(digital(g, `${p.key}.comm`, dn, 'comm', dev, L('electrical.m.comm'), L('state.offline'), 'warning', 0.03, true));
  }
  return { groups, sensors };
}

/* ====================================================================== */
/* บำบัดน้ำเสีย                                                            */
/* ====================================================================== */
const WW_ICON: Record<WwUnitKey, AlarmGroupDef['icon']> = {
  eq: 'pond', eqpump: 'pump', aer: 'process', anae: 'process', sand: 'process', pool: 'quality', panel: 'panel',
};
/** พารามิเตอร์ on/off ที่เป็นอุปกรณ์ → มี alarm ขัดข้อง (Trip) */
const WW_TRIP = new Set(['eqpump.p1', 'eqpump.p2', 'aer.blower']);

function wastewaterCatalog() {
  const units = [...WW_UNITS].sort((a, b) => (a.stage || 99) - (b.stage || 99));
  const groups: AlarmGroupDef[] = units.map((u) => {
    const d = u.stage > 0 ? L('wastewater.stage_desc', { n: u.stage }) : L('wastewater.panel_desc');
    return { id: `ww_${u.key}`, system: 'wastewater', icon: WW_ICON[u.key], th: u.th, en: u.en, descTh: d.th, descEn: d.en };
  });
  const sensors: AlarmSensorDef[] = [];
  units.forEach((u, ui) => {
    const g = `ww_${u.key}`;
    const dev = { th: u.th, en: u.en };
    const dn = `wwtp.${u.key}`;
    u.params.forEach((p, pi) => {
      const name = { th: p.th, en: p.en };
      if (p.kind === 'onoff') {
        if (WW_TRIP.has(`${u.key}.${p.id}`)) {
          sensors.push(digital(g, `${u.key}.${p.id}.trip`, dn, `${p.id}_trip`, dev,
            { th: locTh('data.utility_alarms.wastewater.trip_of', { name: p.th }), en: locEn('data.utility_alarms.wastewater.trip_of', { name: p.en }) },
            L('state.trip'), 'critical', 0.03));
        }
        return;
      }
      const n = p.normal ?? {};
      const lim = p.limit ?? {};
      const hh = lim.max ?? null;
      let h = n.max ?? null;
      // ความเข้มข้นที่มีแต่ค่ามาตรฐาน → เตือนล่วงหน้าที่ 80% ของค่ามาตรฐาน (เกณฑ์เดียวกับ paramTone)
      if (h === null && hh !== null && p.unit === 'mg/L') h = Math.round(hh * 0.8 * 10) / 10;
      const hasAny = [lim.min, n.min, h, hh].some((x) => x !== undefined && x !== null);
      const step = 10 ** -p.dp;
      sensors.push(
        analog(g, `${u.key}.${p.id}`, dn, p.id, dev, name, p.unit, p.dp, p.fn,
          {
            ll: lim.min ?? null, l: n.min ?? null, h, hh,
            enabled: hasAny,
            deadband: Math.max(step, Math.round((p.unit === 'mg/L' ? 2 : p.unit === '%' ? 1 : step * 5) / step) * step),
            delaySec: p.unit === 'mg/L' ? 600 : 60,
          },
          hasAny ? 0.04 + ((ui + pi) % 3) * 0.02 : 0),
      );
    });
    if (u.key === 'panel') sensors.push(digital(g, 'panel.comm', dn, 'comm', dev, L('wastewater.comm'), L('state.offline'), 'warning', 0.04, true));
  });
  return { groups, sensors };
}

/* ====================================================================== */
/* helpers                                                                 */
/* ====================================================================== */
function pair(k: string) {
  return {
    th: locTh(`data.utility_alarms.groups.${k}.name`),
    en: locEn(`data.utility_alarms.groups.${k}.name`),
    descTh: locTh(`data.utility_alarms.groups.${k}.desc`),
    descEn: locEn(`data.utility_alarms.groups.${k}.desc`),
  };
}

type Name = { th: string; en: string };

function analog(
  groupId: string, key: string, deviceName: string, metricName: string, dev: Name, name: Name,
  unit: string, dp: number, read: (ms: number) => number, defaults: AlarmSensorDef['defaults'], mockRate = 0.05,
): AlarmSensorDef {
  return { key, groupId, deviceName, metricName, deviceTh: dev.th, deviceEn: dev.en, th: name.th, en: name.en, unit, dp, kind: 'analog', read, defaults, mockRate };
}

function digital(
  groupId: string, key: string, deviceName: string, metricName: string, dev: Name, name: Name, state: Name,
  severity: AlarmRule['stateSeverity'], mockRate = 0.03, comm = false,
): AlarmSensorDef {
  return {
    key, groupId, deviceName, metricName, deviceTh: dev.th, deviceEn: dev.en, th: name.th, en: name.en, unit: '', dp: 0,
    kind: 'digital', stateTh: state.th, stateEn: state.en, comm, read: () => 0,
    defaults: { stateSeverity: severity, delaySec: comm ? 60 : 3, notifyLine: severity === 'critical' }, mockRate,
  };
}

export interface SystemCatalog {
  system: UtilitySystem;
  groups: AlarmGroupDef[];
  sensors: AlarmSensorDef[];
}

const cache = new Map<UtilitySystem, SystemCatalog>();
export function getCatalog(system: UtilitySystem): SystemCatalog {
  let c = cache.get(system);
  if (!c) {
    const b = system === 'water' ? waterCatalog() : system === 'electrical' ? electricalCatalog() : wastewaterCatalog();
    c = { system, ...b };
    cache.set(system, c);
  }
  return c;
}

/** กฎตั้งต้นของเซนเซอร์ (ค่าที่ใช้เมื่อยังไม่เคยบันทึก / กดคืนค่าเริ่มต้น) */
export function defaultRule(s: AlarmSensorDef): AlarmRule {
  return {
    sensorKey: s.key,
    enabled: true,
    ll: null, l: null, h: null, hh: null,
    deadband: 0,
    delaySec: 60,
    triggerOn: 1,
    stateSeverity: 'critical',
    notifyWeb: true,
    notifyLine: false,
    notifyEmail: false,
    saveAlarm: true,
    repeatMin: 0,
    ...s.defaults,
  };
}
