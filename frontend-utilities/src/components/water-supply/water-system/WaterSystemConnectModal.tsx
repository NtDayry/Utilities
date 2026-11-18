import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Container, Database, Loader2, PlugZap, XCircle } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import Button from '@/components/ui/button/Button';
import { Field, NumInput, PathPicker, Section, errorCls, inputCls, smallCls } from '@/components/water-supply/water-system/WaterSystemFormParts';
import { useFeeds, useNow } from '@/hooks/useWaterSystemTopics';
import { useWaterSystems } from '@/store/waterSystems';
import { DEFAULT_BROKER, feedKey, type Feed, type FeedSnapshot } from '@/lib/waterSystems/mqttTopics';
import { probeMqtt } from '@/api/utilities/utilitiesApi';
import { LEVEL_UNITS, guessLevelPath, isValidBrokerUrl, isValidPath, isValidTopic, newSystem, readPath, scanPayload, slugify, toNum, uniqueId } from '@/lib/waterSystems/model';
import type { BrokerConfig, LevelUnit, WaterSystemConfig, WaterSystemKind } from '@/types/waterSystem.types';

/**
 * หน้าต่างเชื่อมต่อ (ปุ่ม "เพิ่มระบบ" ในหน้าภาพรวมระบบน้ำ)
 *  1) ชนิด (ถังน้ำ / บ่อเก็บน้ำ) + ชื่อ
 *  2) MQTT Broker (เริ่มจากค่าพื้นฐาน แก้ได้) + Topic ของคอนโทรลเลอร์ → กด "เชื่อมต่อ"
 *  3) เชื่อมต่อสำเร็จ → สแกนข้อความที่เข้ามา → เลือกตำแหน่งค่าระดับน้ำ, หน่วย, เกณฑ์ต่ำ–สูง → "สร้าง"
 * เซ็นเซอร์อื่น ปั๊ม และขนาดถัง/บ่อ ตั้งต่อได้ในหน้าของระบบหลังสร้าง
 */

const SLOW_CONNECT_MS = 8_000;
const KIND_ICON: Record<WaterSystemKind, React.ReactNode> = { tank: <Container className="h-5 w-5" />, pond: <Database className="h-5 w-5" /> };

interface Props {
  onClose: () => void;
  onCreated: (system: WaterSystemConfig) => void;
}

export default function WaterSystemConnectModal({ onClose, onCreated }: Props) {
  const { t } = useTranslation();
  const systems = useWaterSystems((s) => s.systems);
  const save = useWaterSystems((s) => s.save);

  const [kind, setKind] = useState<WaterSystemKind>('tank');
  const [name, setName] = useState('');
  const [broker, setBroker] = useState<BrokerConfig>({ ...DEFAULT_BROKER });
  const [topic, setTopic] = useState('');
  // สิ่งที่กด "เชื่อมต่อ" ไว้ — แก้ broker/topic หลังจากนั้นต้องกดเชื่อมต่อใหม่
  const [target, setTarget] = useState<(Feed & { since: number }) | null>(null);
  const [levelPath, setLevelPath] = useState('');
  const [levelUnit, setLevelUnit] = useState<LevelUnit>('cm');
  const [lowPct, setLowPct] = useState(20);
  const [highPct, setHighPct] = useState(95);
  const [tried, setTried] = useState<'connect' | 'create' | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const isDefaultBroker = broker.url === DEFAULT_BROKER.url && broker.username === DEFAULT_BROKER.username && broker.password === DEFAULT_BROKER.password;
  const brokerOk = isDefaultBroker || isValidBrokerUrl(broker.url);
  const topicOk = isValidTopic(topic);

  // broker ที่กำหนดเอง (โหมด backend): ระบบยังไม่ได้บันทึก backend จึงยังไม่รู้จัก broker นี้
  // → ให้ backend ทดลองเชื่อมต่อและรอข้อความแรก (probe) แทนการรับข้อมูลสด
  const viaProbe = target !== null && target.broker !== null;
  const [probe, setProbe] = useState<FeedSnapshot | null>(null);
  useEffect(() => {
    if (!viaProbe || !target) {
      setProbe(null);
      return;
    }
    let alive = true;
    setProbe({ status: 'connecting', error: null, raw: undefined, at: null });
    probeMqtt({ broker: target.broker, topic: target.topic, timeout_sec: 15 })
      .then((r) => {
        if (!alive) return;
        if (r.ok) setProbe({ status: 'connected', error: null, raw: r.payload, at: Date.now() });
        else setProbe({ status: 'offline', error: r.stage === 'message' ? 'probe_no_message' : `probe_failed:${r.error}`, raw: undefined, at: null });
      })
      .catch((e) => {
        if (!alive) return;
        const code = e?.response?.status;
        setProbe({ status: 'offline', error: code === 401 ? 'unauthorized' : code === 403 ? 'forbidden' : `probe_failed:${e?.message ?? ''}`, raw: undefined, at: null });
      });
    return () => {
      alive = false;
    };
  }, [target, viaProbe]);
  const liveSnap = useFeeds(target && !viaProbe ? [target] : [])[target ? feedKey(target) : ''];
  const snap = viaProbe ? (probe ?? undefined) : liveSnap;
  const now = useNow();
  const points = useMemo(() => scanPayload(snap?.raw), [snap?.raw]);
  const connected = snap?.status === 'connected';
  const hasData = snap?.raw !== undefined;

  // ได้ข้อความแรก → เสนอตำแหน่งค่าระดับน้ำให้ (ถ้ายังไม่ได้เลือก)
  useEffect(() => {
    if (points.length > 0) setLevelPath((cur) => cur || guessLevelPath(points));
  }, [points]);

  const changeConnection = (fn: () => void) => {
    fn();
    setTarget(null);
    setLevelPath('');
  };

  const connect = () => {
    setTried('connect');
    if (!brokerOk || !topicOk) return;
    setTarget({ broker: isDefaultBroker ? null : { ...broker }, topic, since: Date.now() });
  };

  const levelValue = hasData && isValidPath(levelPath) ? toNum(readPath(snap?.raw, levelPath)) : null;
  const limitsOk = lowPct >= 0 && highPct <= 100 && lowPct < highPct;
  const canCreate = Boolean(target) && connected && name.trim() !== '' && isValidPath(levelPath) && limitsOk;

  const create = async () => {
    setTried('create');
    if (!canCreate || !target) return;
    setSaving(true);
    setSaveError('');
    try {
      const base = newSystem(kind);
      const system: WaterSystemConfig = {
        ...base,
        id: uniqueId(slugify(name) || kind, systems.map((s) => s.id)),
        name: name.trim(),
        broker: target.broker,
        topic: target.topic,
        sensors: { ...base.sensors, level: { ...base.sensors.level, enabled: true, path: levelPath } },
        levelUnit,
        lowPct,
        highPct,
      };
      await save(system);
      onCreated(system);
    } catch (e) {
      console.error('[water-systems] create failed:', e);
      setSaveError(t('water_systems.error.save_failed'));
      setSaving(false);
    }
  };

  const slow = target !== null && !connected && now - target.since > SLOW_CONNECT_MS;
  const errorText = (() => {
    const err = snap?.error;
    if (!err) return err;
    if (err === 'unsupported_url') return t('water_systems.connect.err_unsupported_url');
    if (err === 'bridge_not_connected') return t('water_systems.connect.err_bridge');
    if (err.startsWith('probe_failed')) return `${t('water_systems.error.probe_failed')}${err.length > 13 ? ` (${err.slice(13)})` : ''}`;
    if (['probe_no_message', 'broker_offline', 'unauthorized', 'unsaved_broker'].includes(err)) return t(`water_systems.error.${err}`);
    return err;
  })();

  return (
    <Modal isOpen onClose={onClose} size="2xl" animation="zoom">
      <div className="max-h-[88vh] space-y-4 overflow-y-auto p-5 sm:p-7">
        <div className="pr-12">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">{t('water_systems.connect.title')}</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('water_systems.connect.intro')}</p>
        </div>

        {/* 1) ชนิด + ชื่อ */}
        <Section title={t('water_systems.connect.step_what')}>
          <div className="grid gap-3 sm:grid-cols-2">
            {(['tank', 'pond'] as WaterSystemKind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                aria-pressed={kind === k}
                className={`flex items-center gap-3 rounded-xl border p-3 text-left ${kind === k ? 'border-sky-500 bg-sky-50 dark:bg-sky-500/10' : 'border-gray-200 hover:border-sky-300 dark:border-gray-700'}`}
              >
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${kind === k ? 'bg-sky-500 text-white' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'}`}>{KIND_ICON[k]}</span>
                <span>
                  <span className="block text-sm font-bold text-gray-900 dark:text-white">{t(`water_systems.kind.${k}.name`)}</span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400">{t(`water_systems.kind.${k}.desc`)}</span>
                </span>
              </button>
            ))}
          </div>
          <Field label={`${t('water_systems.name')} *`} error={tried === 'create' && !name.trim() ? t('water_systems.error.name_required') : undefined} className="mt-3">
            <input className={`${inputCls} ${tried === 'create' && !name.trim() ? errorCls : ''}`} value={name} onChange={(e) => setName(e.target.value)} placeholder={t(`water_systems.kind.${kind}.name_ph`)} autoFocus />
          </Field>
        </Section>

        {/* 2) การเชื่อมต่อ */}
        <Section title={t('water_systems.connect.step_connect')} hint={t('water_systems.connect.broker_hint')}>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="MQTT Broker" error={tried && !brokerOk ? t('water_systems.error.broker_invalid') : undefined} className="sm:col-span-4">
              <input className={`${smallCls} font-mono ${tried && !brokerOk ? errorCls : ''}`} value={broker.url} onChange={(e) => changeConnection(() => setBroker({ ...broker, url: e.target.value.trim() }))} placeholder="wss://192.168.1.10:1884" spellCheck={false} />
            </Field>
            <Field label={t('water_systems.connect.username')} className="sm:col-span-2">
              <input className={smallCls} value={broker.username} autoComplete="off" onChange={(e) => changeConnection(() => setBroker({ ...broker, username: e.target.value }))} />
            </Field>
            <Field label={t('water_systems.connect.password')} className="sm:col-span-2">
              <input className={smallCls} type="password" value={broker.password} autoComplete="new-password" onChange={(e) => changeConnection(() => setBroker({ ...broker, password: e.target.value }))} />
            </Field>
            <Field label={`${t('water_systems.topic')} *`} error={tried && !topicOk ? t(topic ? 'water_systems.error.topic_invalid' : 'water_systems.error.topic_required') : undefined} className="sm:col-span-3">
              <input
                className={`${smallCls} font-mono ${tried && !topicOk ? errorCls : ''}`}
                value={topic}
                onChange={(e) => changeConnection(() => setTopic(e.target.value.trim()))}
                onKeyDown={(e) => e.key === 'Enter' && connect()}
                placeholder="water-tank-building-5"
                spellCheck={false}
              />
            </Field>
            <div className="flex items-end">
              <Button variant="primary" className="h-9 w-full justify-center text-sm" startIcon={<PlugZap className="h-4 w-4" />} onClick={connect}>
                {t('water_systems.connect.connect_btn')}
              </Button>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
            <span>{isDefaultBroker ? t('water_systems.connect.using_default') : t('water_systems.connect.using_custom')}</span>
            {!isDefaultBroker && (
              <button type="button" className="font-semibold text-sky-600 hover:underline dark:text-sky-400" onClick={() => changeConnection(() => setBroker({ ...DEFAULT_BROKER }))}>
                {t('water_systems.connect.reset_default')}
              </button>
            )}
          </div>

          {/* สถานะการเชื่อมต่อ */}
          {target && (
            <div
              className={`mt-3 flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm ${
                hasData
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                  : snap?.status === 'offline'
                    ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-500/10 dark:text-red-300'
                    : 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-500/10 dark:text-amber-300'
              }`}
            >
              {hasData ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : snap?.status === 'offline' ? <XCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />}
              <span>
                {hasData
                  ? t('water_systems.connect.st_data', { n: points.filter((p) => p.type !== 'object').length })
                  : connected
                    ? t('water_systems.connect.st_waiting')
                    : snap?.status === 'offline'
                      ? t('water_systems.connect.st_failed')
                      : t('water_systems.connect.st_connecting')}
                {!hasData && errorText && <span className="block font-mono text-xs opacity-80">{errorText}</span>}
                {slow && snap?.status !== 'offline' && <span className="block text-xs opacity-80">{t('water_systems.connect.st_slow')}</span>}
              </span>
            </div>
          )}
        </Section>

        {/* 3) ค่าระดับน้ำ — หลังเชื่อมต่อสำเร็จ */}
        {target && connected && (
          <Section title={t('water_systems.connect.step_level')} hint={hasData ? t('water_systems.connect.level_hint') : t('water_systems.connect.level_hint_no_data')}>
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label={`${t('water_systems.level_path')} *`} error={tried === 'create' && !isValidPath(levelPath) ? t('water_systems.error.sensor_path_required') : undefined} className="sm:col-span-2">
                <PathPicker value={levelPath} onChange={setLevelPath} points={points} types={['number']} invalid={tried === 'create' && !isValidPath(levelPath)} placeholder="water_level.level_cm" />
              </Field>
              <Field label={t('water_systems.level_unit')}>
                <select className={smallCls} value={levelUnit} onChange={(e) => setLevelUnit(e.target.value as LevelUnit)}>
                  {LEVEL_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u === 'percent' ? '%' : u}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('water_systems.limits')} error={tried === 'create' && !limitsOk ? t('water_systems.error.limits_invalid') : undefined}>
                <div className="flex items-center gap-1">
                  <NumInput value={lowPct} min={0} onChange={setLowPct} />
                  <span className="text-gray-400">–</span>
                  <NumInput value={highPct} min={0} onChange={setHighPct} />
                </div>
              </Field>
            </div>
            {isValidPath(levelPath) && hasData && (
              <p className={`mt-2 text-xs ${levelValue === null ? 'text-amber-600 dark:text-amber-400' : 'text-gray-600 dark:text-gray-300'}`}>
                {levelValue === null ? t('water_systems.connect.level_not_number') : t('water_systems.connect.level_now', { value: levelValue, unit: levelUnit === 'percent' ? '%' : levelUnit })}
              </p>
            )}
          </Section>
        )}

        {saveError && <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-500/10 dark:text-red-400">{saveError}</div>}

        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400">{!target || !connected ? t('water_systems.connect.create_needs_connect') : t('water_systems.connect.create_note')}</span>
          <div className="flex shrink-0 gap-2">
            <Button variant={{ light: 'neutral-soft', dark: 'neutral-soft-outline' }} onClick={onClose} disabled={saving}>
              {t('water_systems.cancel')}
            </Button>
            <Button variant="primary" onClick={create} disabled={saving || !target || !connected}>
              {t('water_systems.connect.create_btn')}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
