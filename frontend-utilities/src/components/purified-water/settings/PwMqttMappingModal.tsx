import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/modal';
import useSwalAlert from '@/hooks/useSwalAlert';
import type { SensorConfig } from '@/api';
import {
  previewPwMqtt,
  probePwMqtt,
  putPwMqttMappings,
  pwSensorKey,
  readPayloadPath as readPath,
  apiErrorDetail,
  type PwMqttField,
  type PwMqttMapping,
  type PwMqttPreview,
  type PwMqttStatus,
} from '@/api/purifiedWater/pwMqttApi';
import { BTN_OUTLINE, BTN_SAVE, INPUT_CLS, INPUT_SM_CLS } from '@/components/purified-water/settings/pwMqttStyles';

interface Row {
  config: SensorConfig;
  label: string;
  topic: string;
  field: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  groupName: string;
  /** เซนเซอร์ทุกตัวของอุปกรณ์นี้ (ตั้ง topic/field ทีละอุปกรณ์ เพราะอุปกรณ์มักส่งหลายค่าใน topic เดียว) */
  configs: SensorConfig[];
  labels: Record<string, string>;
  focusMetric?: string;
  mappings: PwMqttMapping[];
  status: PwMqttStatus | null;
  brokerReady: boolean;
  onSaved: () => void;
}

const fmt = (v: unknown) => (v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v));

export function PwMqttMappingModal({ isOpen, onClose, groupName, configs, labels, focusMetric, mappings, status, brokerReady, onSaved }: Props) {
  const { t } = useTranslation();
  const swal = useSwalAlert();
  const [rows, setRows] = useState<Row[]>([]);
  const [groupTopic, setGroupTopic] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scan, setScan] = useState<{ topic: string; payload: unknown; fields: PwMqttField[] } | null>(null);
  const [previews, setPreviews] = useState<Record<string, PwMqttPreview | null>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const byKey = new Map(mappings.map((m) => [pwSensorKey(m.device_name, m.metric_name), m]));
    const next = configs.map((c) => {
      const m = byKey.get(pwSensorKey(c.device_name, c.metric_name));
      return { config: c, label: labels[c.metric_name] ?? c.metric_name, topic: m?.topic ?? '', field: m?.field ?? '' };
    });
    setRows(next);
    const topics = [...new Set(next.map((r) => r.topic).filter(Boolean))];
    setGroupTopic(topics[0] ?? '');
    setScan(null);
    setScanError(null);
    setPreviews({});
    // โหลดค่าเริ่มต้นเฉพาะตอนเปิดหน้าต่าง / เปลี่ยนอุปกรณ์ — หน้าแม่ render ใหม่ทุกวินาที (ค่าสด) ห้ามล้างสิ่งที่กำลังแก้
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, configs[0]?.device_name]);

  const initial = useMemo(() => {
    const byKey = new Map(mappings.map((m) => [pwSensorKey(m.device_name, m.metric_name), m]));
    return JSON.stringify(configs.map((c) => {
      const m = byKey.get(pwSensorKey(c.device_name, c.metric_name));
      return [m?.topic ?? '', m?.field ?? ''];
    }));
  }, [configs, mappings]);
  const dirty = JSON.stringify(rows.map((r) => [r.topic.trim(), r.field.trim()])) !== initial;

  // ตัวอย่างค่าที่แปลงแล้ว จาก payload ที่สแกนได้ (ใช้สูตรของ sensor config จริงที่ backend)
  useEffect(() => {
    if (!scan) return;
    let alive = true;
    const timer = setTimeout(async () => {
      const out: Record<string, PwMqttPreview | null> = {};
      await Promise.all(
        rows.map(async (r) => {
          const key = r.config.metric_name;
          if (r.topic.trim() !== scan.topic) return;
          const raw = readPath(scan.payload, r.field.trim());
          if (raw === undefined) {
            out[key] = { ok: false, error: 'field_missing' };
            return;
          }
          try {
            out[key] = await previewPwMqtt(r.config.device_name, r.config.metric_name, raw);
          } catch {
            out[key] = null;
          }
        }),
      );
      if (alive) setPreviews(out);
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [scan, rows]);

  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const applyTopicToAll = () => setRows((rs) => rs.map((r) => ({ ...r, topic: groupTopic.trim() })));

  const handleScan = async () => {
    const topic = groupTopic.trim();
    if (!topic) return;
    setScanning(true);
    setScanError(null);
    try {
      const res = await probePwMqtt(topic, undefined, 10);
      if (res.ok) {
        setScan({ topic: res.topic, payload: res.payload, fields: res.fields });
        // เซนเซอร์ที่ยังไม่มี topic → ใช้ topic ที่สแกน
        setRows((rs) => rs.map((r) => (r.topic.trim() ? r : { ...r, topic })));
      } else {
        setScan(null);
        setScanError(res.stage === 'connect' ? t('page.settings_devices.mqtt.test_connect_failed', { error: res.error }) : t('page.settings_devices.mqtt.test_no_message'));
      }
    } catch {
      setScanError(t('page.settings_devices.mqtt.test_failed'));
    } finally {
      setScanning(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await putPwMqttMappings(
        rows.map((r) => ({ device_name: r.config.device_name, metric_name: r.config.metric_name, topic: r.topic.trim(), field: r.field.trim(), enabled: true })),
      );
      swal.Toast({ title: t('page.settings_devices.mqtt.saved'), icon: 'success' });
      onSaved();
      onClose();
    } catch (err) {
      const errors = apiErrorDetail(err)?.errors;
      swal.error({
        title: t('page.settings_devices.mqtt.save_failed'),
        message: errors ? t('page.settings_devices.mqtt.topic_invalid') : t('page.settings_devices.mqtt.save_failed'),
      });
    } finally {
      setSaving(false);
    }
  };

  const errorText = (code: string | null | undefined) =>
    code ? t(`page.settings_devices.mqtt.err_${code}`, { defaultValue: code }) : '';

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="3xl" animation="zoom">
      <div className="w-full rounded-2xl border border-gray-200 bg-white p-5 shadow-xl dark:border-gray-800 dark:bg-gray-900 lg:p-6 space-y-5" data-testid="pw-mqtt-modal">
        <div className="border-b border-gray-100 dark:border-gray-800 pb-4">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20">
            MQTT
          </span>
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mt-1">
            {t('page.settings_devices.mqtt.modal_title', { group: groupName })}
          </h3>
          <p className="text-xs text-gray-500 mt-1">{t('page.settings_devices.mqtt.modal_desc')}</p>
        </div>

        {!brokerReady && (
          <div className="text-xs rounded-lg px-3 py-2 bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20">
            {t('page.settings_devices.mqtt.broker_required')}
          </div>
        )}

        {/* topic ของอุปกรณ์ + สแกน */}
        <div className="space-y-2">
          <span className="text-xs font-semibold text-gray-700 dark:text-gray-200 block">{t('page.settings_devices.mqtt.topic')}</span>
          <div className="flex flex-wrap gap-2">
            <div className="flex-1 min-w-[220px]">
              <input
                className={INPUT_CLS}
                value={groupTopic}
                placeholder="purified-water/ro_system"
                onChange={(e) => setGroupTopic(e.target.value)}
                data-testid="pw-mqtt-group-topic"
              />
            </div>
            <button type="button" className={BTN_OUTLINE} disabled={!groupTopic.trim() || scanning || !brokerReady} onClick={handleScan} data-testid="pw-mqtt-scan">
              {scanning ? t('page.settings_devices.mqtt.scanning') : t('page.settings_devices.mqtt.scan')}
            </button>
            <button type="button" className={BTN_OUTLINE} disabled={!groupTopic.trim()} onClick={applyTopicToAll} data-testid="pw-mqtt-apply-topic">
              {t('page.settings_devices.mqtt.apply_topic')}
            </button>
          </div>
          {scanError && <div className="text-xs text-rose-600 dark:text-rose-400" data-testid="pw-mqtt-scan-error">{scanError}</div>}
          {scan && (
            <details className="text-xs" open>
              <summary className="cursor-pointer text-gray-500">{t('page.settings_devices.mqtt.payload', { topic: scan.topic })}</summary>
              <pre className="mt-1 max-h-36 overflow-auto rounded-lg bg-gray-50 dark:bg-gray-800/60 p-2 font-mono text-[11px] text-gray-700 dark:text-gray-200">
                {JSON.stringify(scan.payload, null, 2)}
              </pre>
            </details>
          )}
        </div>

        {/* field ของแต่ละเซนเซอร์ */}
        <div className="max-h-[45vh] overflow-auto rounded-xl border border-gray-100 dark:border-gray-800">
          <table className="w-full text-xs">
            <thead className="bg-gray-500/10 dark:bg-gray-800/80 text-gray-500 dark:text-white/70 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left font-medium">{t('page.settings_devices.mqtt.col_metric')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('page.settings_devices.mqtt.col_topic')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('page.settings_devices.mqtt.col_field')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('page.settings_devices.mqtt.col_value')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
              {rows.map((r, i) => {
                const key = r.config.metric_name;
                const pv = previews[key];
                const live = status?.sensors[pwSensorKey(r.config.device_name, r.config.metric_name)];
                const listId = `pw-mqtt-fields-${r.config.device_name}`;
                return (
                  <tr key={key} className={focusMetric === key ? 'bg-sky-500/5' : ''} data-testid={`pw-mqtt-row-${key}`}>
                    <td className="px-3 py-2 align-top">
                      <div className="font-semibold text-gray-800 dark:text-white/90">{r.label}</div>
                      <div className="text-[10px] text-gray-400 font-mono">
                        {key} · {r.config.decode_type}
                        {r.config.decode_type === 'analog_4_20ma' && ` · raw ${r.config.raw_min}–${r.config.raw_max} → ${r.config.range_min}–${r.config.range_max}`}
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top min-w-[160px]">
                      <input className={INPUT_SM_CLS} value={r.topic} onChange={(e) => setRow(i, { topic: e.target.value })} data-testid={`pw-mqtt-topic-${key}`} />
                    </td>
                    <td className="px-3 py-2 align-top min-w-[160px]">
                      <input
                        className={INPUT_SM_CLS}
                        list={scan ? listId : undefined}
                        value={r.field}
                        placeholder={t('page.settings_devices.mqtt.field_placeholder')}
                        onChange={(e) => setRow(i, { field: e.target.value })}
                        data-testid={`pw-mqtt-field-${key}`}
                      />
                    </td>
                    <td className="px-3 py-2 align-top font-mono min-w-[150px]" data-testid={`pw-mqtt-value-${key}`}>
                      {scan && r.topic.trim() === scan.topic ? (
                        pv === undefined ? (
                          <span className="text-gray-400">…</span>
                        ) : pv === null ? (
                          <span className="text-gray-400">—</span>
                        ) : pv.ok ? (
                          <span className="text-emerald-600 dark:text-emerald-400">
                            {fmt(pv.raw)} → {pv.value} {pv.unit ?? ''}
                            {pv.status !== 'OK' && <span className="ml-1 text-amber-600">({pv.status})</span>}
                          </span>
                        ) : (
                          <span className="text-rose-600 dark:text-rose-400">{errorText(pv.error)}</span>
                        )
                      ) : live ? (
                        live.error ? (
                          <span className="text-rose-600 dark:text-rose-400">{errorText(live.error)}</span>
                        ) : (
                          <span className="text-gray-600 dark:text-gray-300">
                            {fmt(live.raw)} → {live.value}
                          </span>
                        )
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {scan && (
            <datalist id={`pw-mqtt-fields-${configs[0]?.device_name ?? ''}`}>
              {scan.fields.map((f) => (
                <option key={f.path || '(value)'} value={f.path}>
                  {`${f.path || t('page.settings_devices.mqtt.whole_payload')} = ${fmt(f.preview)}`}
                </option>
              ))}
            </datalist>
          )}
        </div>
        <p className="text-[11px] text-gray-400">{t('page.settings_devices.mqtt.field_hint')}</p>

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100 dark:border-gray-800">
          <button type="button" className={BTN_OUTLINE} onClick={onClose}>
            {t('page.settings_devices.mqtt.cancel')}
          </button>
          <button type="button" className={BTN_SAVE} disabled={!dirty || saving} onClick={handleSave} data-testid="pw-mqtt-modal-save">
            {saving ? t('page.settings_devices.mqtt.saving') : t('page.settings_devices.mqtt.save')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
