import { readFileSync } from 'node:fs';
import type { IClientOptions } from 'mqtt';

const qos = (n: number) => n as 0 | 1 | 2;

/**
 * Every broker-specific setting lives in env, read once here. The rest of the code only
 * speaks plain MQTT, so switching brokers (Mosquitto → EMQX, HiveMQ, …) is a config change.
 */
export const mqttConfig = {
  /** Which adapter formats the broker's auth/ACL hook calls (see ./brokers). */
  broker: (process.env.MQTT_BROKER ?? 'mosquitto').toLowerCase(),
  /** mqtt://, mqtts://, ws:// or wss://. Empty disables MQTT (tests, local UI work). */
  url: process.env.MQTT_URL ?? '',
  /** The backend's own broker account (superuser in the auth hook). */
  username: process.env.MQTT_USERNAME ?? '',
  password: process.env.MQTT_PASSWORD ?? '',
  clientId: process.env.MQTT_CLIENT_ID || `bmc-backend-${process.pid}`,
  topicPrefix: process.env.MQTT_TOPIC_PREFIX ?? 'devices',
  qos: qos(
    [0, 1, 2].includes(Number(process.env.MQTT_QOS))
      ? Number(process.env.MQTT_QOS)
      : 1,
  ),
  /** PEM CA bundle for mqtts:// with a private CA. */
  caFile: process.env.MQTT_CA_FILE ?? '',
  /** Shared secret the broker sends to the hook endpoints (header x-hook-secret or ?secret=). */
  hookSecret: process.env.MQTT_HOOK_SECRET ?? '',
};

export function clientOptions(): IClientOptions {
  return {
    clientId: mqttConfig.clientId,
    username: mqttConfig.username || undefined,
    password: mqttConfig.password || undefined,
    keepalive: 30,
    reconnectPeriod: 2_000,
    ...(mqttConfig.caFile && { ca: readFileSync(mqttConfig.caFile) }),
  };
}

/** For the admin page: the URL without any credentials in it. */
export function safeBrokerUrl(): string {
  if (!mqttConfig.url) return '';
  try {
    const url = new URL(mqttConfig.url);
    url.username = '';
    url.password = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return '(invalid MQTT_URL)';
  }
}
