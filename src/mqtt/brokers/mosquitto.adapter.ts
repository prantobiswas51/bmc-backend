import { type AclRequest, type BrokerAdapter, str } from './broker-adapter.js';

/**
 * Mosquitto + mosquitto-go-auth, HTTP backend in its default modes
 * (auth_opt_http_params_mode json, auth_opt_http_response_mode status).
 * See deploy/mosquitto/go-auth.conf.
 *
 * acc: 1 = read (deliver to subscriber), 2 = write (publish), 3 = readwrite, 4 = subscribe.
 */
const ACC: Record<number, AclRequest['access']> = {
  1: 'read',
  2: 'write',
  3: 'readwrite',
  4: 'subscribe',
};

export const mosquittoAdapter: BrokerAdapter = {
  name: 'mosquitto',
  integration: 'Mosquitto + mosquitto-go-auth (HTTP backend)',
  parseAuth: (body) => ({
    username: str(body.username),
    password: str(body.password),
    clientId: str(body.clientid),
  }),
  parseAcl: (body) => {
    const access = ACC[Number(body.acc)];
    return access
      ? {
          username: str(body.username),
          clientId: str(body.clientid),
          topic: str(body.topic),
          access,
        }
      : null;
  },
  parseSuperuser: (body) => ({ username: str(body.username) }),
  // Status mode only looks at the code; the body helps when reading logs.
  allow: () => ({ status: 200, body: { ok: true } }),
  deny: () => ({ status: 403, body: { ok: false } }),
};
