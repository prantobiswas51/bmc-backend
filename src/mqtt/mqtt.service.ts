import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import mqtt, { MqttClient } from 'mqtt';
import { clientOptions, mqttConfig, safeBrokerUrl } from './mqtt.config.js';

/**
 * Topic layout (prefix defaults to `devices`, {hw} = device hardwareId):
 *   backend → device   {hw}/state/desired  {"version": n, "state": {...}}   retained
 *                      {hw}/cmd            {"id", "action", "payload"}
 *   device → backend   {hw}/state/reported {"state": {...}}
 *                      {hw}/cmd/ack        {"id", "ok": bool, "result"?, "error"?}
 *                      {hw}/telemetry      {"rssi": -61, "rpm": 1200, ...}
 *                      {hw}/status         {"online": true, "firmware": "1.2.0"}  (LWT: {"online": false})
 */
export const INBOUND_CHANNELS = [
  'state/reported',
  'cmd/ack',
  'telemetry',
  'status',
] as const;
export type InboundChannel = (typeof INBOUND_CHANNELS)[number];
// 'status' only to clear a deleted device's retained status.
type OutboundChannel = 'state/desired' | 'cmd' | 'status';
type Handler = (hardwareId: string, payload: Buffer) => Promise<unknown>;

@Injectable()
export class MqttService implements OnApplicationBootstrap, OnModuleDestroy {
  readonly prefix = mqttConfig.topicPrefix;
  private readonly logger = new Logger(MqttService.name);
  private readonly handlers = new Map<string, Handler>();
  private client?: MqttClient;

  /** Called by feature services in their constructors. One handler per channel. */
  on(channel: InboundChannel, handler: Handler): void {
    this.handlers.set(channel, handler);
  }

  onApplicationBootstrap(): void {
    if (!mqttConfig.url) {
      this.logger.warn('MQTT_URL is not set; devices will not be reached');
      return;
    }
    this.client = mqtt.connect(mqttConfig.url, clientOptions());
    this.client.on('connect', () => {
      this.logger.log(`Connected to ${safeBrokerUrl()} (${mqttConfig.broker})`);
      this.client!.subscribe(
        INBOUND_CHANNELS.map((channel) => `${this.prefix}/+/${channel}`),
        { qos: mqttConfig.qos },
      );
    });
    this.client.on('error', (error) => this.logger.error(error.message));
    this.client.on(
      'message',
      (topic, payload) => void this.dispatch(topic, payload),
    );
  }

  get connected(): boolean {
    return !!this.client?.connected;
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.endAsync();
  }

  /** Publish to `{prefix}/{hw}/{channel}`. `null` with retain clears the retained message. */
  async publish(
    hardwareId: string,
    channel: OutboundChannel,
    message: object | null,
    retain = false,
  ): Promise<void> {
    await this.client?.publishAsync(
      `${this.prefix}/${hardwareId}/${channel}`,
      message === null ? '' : JSON.stringify(message),
      { qos: mqttConfig.qos, retain },
    );
  }

  /** Routes an inbound message to its handler. Public so tests can inject device messages. */
  async dispatch(topic: string, payload: Buffer): Promise<void> {
    const [prefix, hardwareId, ...rest] = topic.split('/');
    const handler = this.handlers.get(rest.join('/'));
    if (prefix !== this.prefix || !hardwareId || !handler) {
      return;
    }
    try {
      await handler(hardwareId, payload);
    } catch (error) {
      this.logger.error(
        `Failed to handle ${topic}: ${(error as Error).message}`,
      );
    }
  }
}
