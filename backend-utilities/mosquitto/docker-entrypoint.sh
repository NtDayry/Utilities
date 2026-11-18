#!/bin/sh
# สร้างไฟล์ตั้งค่าของ Mosquitto จาก environment (.env) แล้วเริ่ม broker
#   MQTT_USERNAME / MQTT_PASSWORD       ผู้ใช้ของ broker นี้ (ว่าง = ไม่ต้อง login — ไม่แนะนำ)
#   MQTT_BRIDGE_ADDRESS                  host:port ของ broker เดิม (ว่าง = ไม่ทำ bridge)
#   MQTT_BRIDGE_USERNAME / _PASSWORD     ผู้ใช้ของ broker เดิม
#   MQTT_BRIDGE_TOPICS                   topic หลักที่ดึงมา (คั่นด้วย ,) — แต่ละ topic T:
#                                          รับ T, T/settings, T/configs จาก broker เดิม
#                                          ส่ง T/set (คำสั่งจากหน้าเว็บ) กลับไป broker เดิม
set -eu

GEN=/mosquitto/data/generated
mkdir -p "$GEN" /mosquitto/log
rm -f "$GEN"/*.conf "$GEN"/passwd

# ---------- authentication ----------
if [ -n "${MQTT_USERNAME:-}" ]; then
  touch "$GEN/passwd"
  chmod 0700 "$GEN/passwd"
  mosquitto_passwd -b "$GEN/passwd" "$MQTT_USERNAME" "${MQTT_PASSWORD:-}"
  printf 'allow_anonymous false\npassword_file %s/passwd\n' "$GEN" > "$GEN/10-auth.conf"
else
  echo "WARNING: MQTT_USERNAME is empty — broker accepts anonymous clients" >&2
  printf 'allow_anonymous true\n' > "$GEN/10-auth.conf"
fi

# ---------- bridge ไป broker เดิม ----------
if [ -n "${MQTT_BRIDGE_ADDRESS:-}" ]; then
  B="$GEN/20-bridge.conf"
  {
    echo "connection upstream"
    echo "address ${MQTT_BRIDGE_ADDRESS}"
    echo "remote_clientid utilities-bridge-$(hostname)"
    [ -n "${MQTT_BRIDGE_USERNAME:-}" ] && echo "remote_username ${MQTT_BRIDGE_USERNAME}"
    [ -n "${MQTT_BRIDGE_PASSWORD:-}" ] && echo "remote_password ${MQTT_BRIDGE_PASSWORD}"
    echo "bridge_protocol_version mqttv311"
    echo "try_private false"
    echo "cleansession true"
    echo "notifications false"
    echo "restart_timeout 5 60"
    echo "start_type automatic"
  } > "$B"
  OLD_IFS=$IFS
  IFS=','
  for t in ${MQTT_BRIDGE_TOPICS:-}; do
    t=$(echo "$t" | tr -d ' ')
    [ -z "$t" ] && continue
    {
      echo "topic $t in 1"
      echo "topic $t/settings in 1"
      echo "topic $t/configs in 1"
      echo "topic $t/set out 1"
    } >> "$B"
  done
  IFS=$OLD_IFS
  chmod 0600 "$B"
  echo "bridge → ${MQTT_BRIDGE_ADDRESS} topics: ${MQTT_BRIDGE_TOPICS:-<none>}"
fi

chown -R mosquitto:mosquitto /mosquitto/data /mosquitto/log 2>/dev/null || true
exec /usr/sbin/mosquitto -c /mosquitto/config/mosquitto.conf
