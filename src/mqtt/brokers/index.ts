import type { BrokerAdapter } from './broker-adapter.js';
import { emqxAdapter } from './emqx.adapter.js';
import { mosquittoAdapter } from './mosquitto.adapter.js';

const ADAPTERS: Record<string, BrokerAdapter> = {
  mosquitto: mosquittoAdapter,
  emqx: emqxAdapter,
};

export function brokerAdapter(name: string): BrokerAdapter {
  const adapter = ADAPTERS[name];
  if (!adapter) {
    throw new Error(
      `Unknown MQTT_BROKER "${name}". Supported: ${Object.keys(ADAPTERS).join(', ')}`,
    );
  }
  return adapter;
}

export type { BrokerAdapter } from './broker-adapter.js';
