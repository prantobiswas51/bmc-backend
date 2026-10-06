# bmc-backend — BongoMaker Control API

One API (REST `/api/v1` + Socket.IO) for the website and the mobile app to control any
kind of BongoMaker device. NestJS 12 · TypeORM · PostgreSQL 13+ · JWT (Passport) · MQTT.
Swagger UI: `/api/docs`.

## Model

```
organizations ─┬─ org_members (user, role: viewer < operator < admin < owner)
               ├─ locations  (office, room, home…)
               └─ devices ── device_types (stateSchema + commands as JSON Schema)
                     ├─ desiredState / reportedState (JSONB shadow) + stateVersion
                     ├─ commands  (one-shot actions with ack)
                     └─ telemetry (partitioned by month)
users ── refresh_tokens (rotating, reuse detection)
```

- **New device type = a row in `device_types`**, not a migration. Seeded: `fanled`, `rgb_bar`, `camera`.
- **Settings** (fan speed, colour…) go through `PATCH /devices/{id}/state` → validated against
  `stateSchema` → stored in `desiredState` → published retained, so a reconnecting device catches up.
- **One-shot actions** (snapshot, reboot, effect) go through `POST /devices/{id}/commands` →
  validated against `commands[action]` → acked by the device; never replayed.
- `online` and `syncing` are derived, never stored.

## Run

```bash
cp .env.example .env     # DATABASE_URL, JWT_SECRET, MQTT_*
npm install
npm run start:dev        # migrations run on boot
```

## First super admin

Register in the panel, then promote that account once (afterwards use **Admin → Users**):

```sql
UPDATE users SET "platformRole" = 'super_admin' WHERE email = 'you@example.com';
```

## Provision a device

Panel: **Platform → Provisioning** (super_admin). Or from the CLI:

```bash
npm run build && npm run device:create -- fanled BM_FANLED_0001
```

Prints the **device secret** (flash into firmware; MQTT username = hardware id) and the
**claim code** (label, single use). Only hashes are stored. Releasing a device returns a new code.

## MQTT

| Direction | Topic (`devices/{hardwareId}/…`) | Payload |
|---|---|---|
| → device | `state/desired` (retained) | `{"version": 3, "state": {"speed": 60}}` |
| → device | `cmd` | `{"id": "…", "action": "reboot", "payload": {}}` |
| device → | `state/reported` | `{"state": {"speed": 60}}` |
| device → | `cmd/ack` | `{"id": "…", "ok": true, "result": {…}}` |
| device → | `telemetry` | `{"rssi": -61, "rpm": 1200}` |
| device → | `status` (+ LWT) | `{"online": true, "firmware": "1.2.0"}` / LWT `{"online": false}` |

Devices should send something (status or telemetry) at least every `DEVICE_OFFLINE_AFTER` seconds.

### Broker auth (no passwd file)

MQTT accounts live in Postgres (`mqtt_users`) and are managed in the panel under
**Admin → MQTT users**:

- **device**: created when a device is provisioned (username = hardware ID). Fixed ACL:
  its own `devices/{id}/…` topics only.
- **client**: anything else (dashboards, Node-RED, test tools), with its own ACL rules
  (topic filters with `+`/`#`, `%u` = username, `%c` = client id; read / write / readwrite).
- The backend's own account comes from `MQTT_USERNAME`/`MQTT_PASSWORD` and is a superuser.

The broker asks the API on every connect/subscribe/publish (cached broker-side):
`POST /api/v1/mqtt/auth`, `/superuser`, `/acl`. Request/response formats are handled by an
adapter in `src/mqtt/brokers/` picked by `MQTT_BROKER`:

| `MQTT_BROKER` | Broker setup |
|---|---|
| `mosquitto` | Mosquitto 2 + mosquitto-go-auth, HTTP backend — see `deploy/mosquitto/bongomaker.conf` |
| `emqx` | EMQX 5 HTTP authentication + authorization, header `x-hook-secret` |

All other MQTT settings (URL, TLS CA, credentials, client id, topic prefix, QoS) are env
vars read in `src/mqtt/mqtt.config.ts`. Supporting another broker = one adapter file.

### TLS

`deploy/mosquitto/bongomaker.conf` opens **8883 (TLS)** to the world and **1883 on
127.0.0.1 only**. Firewall: allow 8883, keep 1883 closed.

```bash
sudo certbot certonly --nginx -d mqtt.bongomaker.com     # A record → this VPS
sudo install -d -o mosquitto -m 700 /etc/mosquitto/certs
# /etc/letsencrypt/renewal-hooks/deploy/mosquitto.sh  (chmod +x), runs on every renewal:
#   install -o mosquitto -m 600 /etc/letsencrypt/live/mqtt.bongomaker.com/{fullchain,privkey}.pem /etc/mosquitto/certs/
#   systemctl reload mosquitto
sudo /etc/letsencrypt/renewal-hooks/deploy/mosquitto.sh  # first copy
```

- **ESP32**: `mqtts://mqtt.bongomaker.com:8883`, its own hardware ID + device secret,
  verify with the ISRG Root X1 CA (or the ESP-IDF cert bundle). Never skip verification.
- **Backend**: `MQTT_URL=mqtts://mqtt.bongomaker.com:8883` (Let's Encrypt is trusted by
  Node, `MQTT_CA_FILE` stays empty). If the backend runs on the same VPS as Mosquitto,
  `mqtt://127.0.0.1:1883` is equally safe — loopback traffic never leaves the machine.
- The broker → API auth hooks stay on `http://127.0.0.1:4000` (loopback).

## Realtime

Socket.IO namespace `/realtime`, `auth: { token: <access token> }`, then
`emit('subscribe', { orgId })`. Events: `device.desired`, `device.reported`, `device.online`,
`device.telemetry`, `device.removed`, `command.updated`.

## Tests

```bash
npm run test:e2e   # needs Postgres; TEST_DATABASE_URL or postgres://bm:bm@localhost:5432/bm_central_test
```

## Production: control.bongomaker.com

One domain, nginx in front. The panel (Next.js, :3000) calls the API server-side over
loopback; `/api` is also public for the mobile app, Socket.IO and the broker hooks.

```nginx
server {
    server_name control.bongomaker.com;

    location /api/      { proxy_pass http://127.0.0.1:4000; include proxy_params; }
    location /socket.io/ {                       # realtime (namespace /realtime)
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        include proxy_params;
    }
    location /          { proxy_pass http://127.0.0.1:3000; include proxy_params; }
}
```

- backend `.env`: `CORS_ORIGINS=https://control.bongomaker.com`, `TRUST_PROXY=loopback`
- frontend `.env.local`: `API_URL=http://127.0.0.1:4000`
- Mobile app base URL: `https://control.bongomaker.com/api/v1`
