import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { hashSecret } from '../src/common/secrets.js';
import { dataSourceOptions } from '../src/data-source.js';
import { Device } from '../src/devices/device.entity.js';
import { MqttService } from '../src/mqtt/mqtt.service.js';
import { MqttUser } from '../src/mqtt/mqtt-user.entity.js';
import { User } from '../src/users/user.entity.js';

const FAN = {
  hardwareId: 'BM_FANLED_T1',
  secret: 'fan-secret',
  code: 'ABCD-EFGH',
};
const CAM = {
  hardwareId: 'BM_CAM_T1',
  secret: 'cam-secret',
  code: 'JKMN-PQRS',
};

describe('BongoMaker Control API v1 (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let mqtt: MqttService;
  let published: Array<{
    hw: string;
    channel: string;
    message: unknown;
    retain: boolean;
  }>;
  const tokens: Record<
    string,
    { access: string; refresh: string; id: string }
  > = {};
  let orgId: string;
  let locationId: string;
  let fanId: string;
  let camId: string;

  const as = (user: string) => ({
    Authorization: `Bearer ${tokens[user].access}`,
  });
  const device = (hw: string, channel: string, body: unknown) =>
    mqtt.dispatch(
      `devices/${hw}/${channel}`,
      Buffer.from(JSON.stringify(body)),
    );

  beforeAll(async () => {
    // Fresh schema through the real migration.
    const reset = new DataSource({
      ...dataSourceOptions,
      migrationsRun: false,
    });
    await reset.initialize();
    await reset.dropDatabase();
    await reset.destroy();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.listen(0);
    http = request(app.getHttpServer());

    mqtt = app.get(MqttService);
    published = [];
    vi.spyOn(mqtt, 'publish').mockImplementation(
      async (hw, channel, message, retain = false) => {
        published.push({ hw, channel, message, retain });
      },
    );

    const db = app.get(DataSource);
    for (const [hw, typeKey, d] of [
      [FAN.hardwareId, 'fanled', FAN],
      [CAM.hardwareId, 'camera', CAM],
    ] as const) {
      const { identifiers } = await db.getRepository(Device).insert({
        hardwareId: hw,
        typeKey,
        claimCodeHash: await hashSecret(d.code),
      });
      await db.getRepository(MqttUser).insert({
        username: hw,
        passwordHash: await hashSecret(d.secret),
        kind: 'device',
        deviceId: identifiers[0].id as string,
      });
    }

    for (const name of ['owner', 'member', 'viewer', 'outsider']) {
      const res = await http
        .post('/api/v1/auth/register')
        .send({ name, email: `${name}@Example.com`, password: 'password1' })
        .expect(201);
      tokens[name] = {
        access: res.body.accessToken,
        refresh: res.body.refreshToken,
        id: res.body.user.id,
      };
    }
  });

  afterAll(() => app.close());

  describe('auth', () => {
    it('logs in case-insensitively and rotates refresh tokens with reuse detection', async () => {
      const login = await http
        .post('/api/v1/auth/login')
        .send({ email: 'OWNER@example.com', password: 'password1' })
        .expect(200);
      await http
        .post('/api/v1/auth/login')
        .send({ email: 'owner@example.com', password: 'nope' })
        .expect(401);

      const first = login.body.refreshToken;
      const rotated = await http
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: first })
        .expect(200);
      expect(rotated.body.refreshToken).not.toBe(first);

      // A parallel refresh within the grace window gets its own pair...
      const parallel = await http
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: first })
        .expect(200);
      // ...but reuse after the window kills the whole family, including the new ones.
      await app
        .get(DataSource)
        .query(
          `UPDATE "refresh_tokens" SET "rotatedAt" = now() - interval '1 minute' WHERE "rotatedAt" IS NOT NULL`,
        );
      await http
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: first })
        .expect(401);
      await http
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: rotated.body.refreshToken })
        .expect(401);
      await http
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: parallel.body.refreshToken })
        .expect(401);

      const me = await http.get('/api/v1/me').set(as('owner')).expect(200);
      expect(me.body).toMatchObject({
        name: 'owner',
        email: 'owner@example.com',
      });
      expect(me.body.passwordHash).toBeUndefined();

      await http
        .post('/api/v1/auth/logout')
        .send({ refreshToken: tokens.member.refresh })
        .expect(204);
      await http
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: tokens.member.refresh })
        .expect(401);
    });
  });

  describe('organizations, members, locations', () => {
    it('makes the creator owner and enforces roles', async () => {
      const org = await http
        .post('/api/v1/orgs')
        .set(as('owner'))
        .send({ name: 'Acme' })
        .expect(201);
      expect(org.body.role).toBe('owner');
      orgId = org.body.id;

      for (const [user, role] of [
        ['member', 'member'],
        ['viewer', 'viewer'],
      ]) {
        await http
          .post(`/api/v1/orgs/${orgId}/members`)
          .set(as('owner'))
          .send({ email: `${user}@example.com`, role })
          .expect(201);
      }
      await http
        .post(`/api/v1/orgs/${orgId}/members`)
        .set(as('owner'))
        .send({ email: 'ghost@example.com', role: 'viewer' })
        .expect(404);
      await http
        .post(`/api/v1/orgs/${orgId}/members`)
        .set(as('member'))
        .send({ email: 'outsider@example.com', role: 'viewer' })
        .expect(403);

      // Outsiders get 404, not 403, so org ids aren't confirmed.
      await http
        .get(`/api/v1/orgs/${orgId}/members`)
        .set(as('outsider'))
        .expect(404);
      const members = await http
        .get(`/api/v1/orgs/${orgId}/members`)
        .set(as('viewer'))
        .expect(200);
      expect(members.body.map((m: { role: string }) => m.role).sort()).toEqual([
        'member',
        'owner',
        'viewer',
      ]);

      // The last owner can't leave or be demoted.
      await http
        .delete(`/api/v1/orgs/${orgId}/members/${tokens.owner.id}`)
        .set(as('owner'))
        .expect(400);
      await http
        .patch(`/api/v1/orgs/${orgId}/members/${tokens.owner.id}`)
        .set(as('owner'))
        .send({ role: 'member' })
        .expect(400);
      await http
        .patch(`/api/v1/orgs/${orgId}/members/${tokens.viewer.id}`)
        .set(as('owner'))
        .send({ role: 'superuser' })
        .expect(400);

      expect(
        (await http.get('/api/v1/orgs').set(as('outsider')).expect(200)).body,
      ).toEqual([]);
    });

    it('scopes locations to the organization', async () => {
      locationId = (
        await http
          .post(`/api/v1/orgs/${orgId}/locations`)
          .set(as('owner'))
          .send({ name: 'Dhaka office' })
          .expect(201)
      ).body.id;
      await http
        .post(`/api/v1/orgs/${orgId}/locations`)
        .set(as('owner'))
        .send({ name: 'Dhaka office' })
        .expect(409);
      await http
        .post(`/api/v1/orgs/${orgId}/locations`)
        .set(as('member'))
        .send({ name: 'Nope' })
        .expect(403);
      await http
        .patch(`/api/v1/locations/${locationId}`)
        .set(as('outsider'))
        .send({ name: 'x' })
        .expect(404);
      const list = await http
        .get(`/api/v1/orgs/${orgId}/locations`)
        .set(as('viewer'))
        .expect(200);
      expect(list.body).toEqual([
        expect.objectContaining({ id: locationId, name: 'Dhaka office' }),
      ]);
    });
  });

  describe('devices', () => {
    it('lists device types with their schemas', async () => {
      const types = await http
        .get('/api/v1/device-types')
        .set(as('viewer'))
        .expect(200);
      expect(types.body.map((t: { key: string }) => t.key)).toEqual([
        'camera',
        'fanled',
        'rgb_bar',
      ]);
      expect(types.body[1].stateSchema.properties.speed).toMatchObject({
        type: 'integer',
        maximum: 100,
      });
    });

    it('claims with a single-use code', async () => {
      const claim = {
        hardwareId: FAN.hardwareId,
        claimCode: 'abcd efgh',
        name: 'Desk fan',
        locationId,
      };
      await http
        .post(`/api/v1/orgs/${orgId}/devices/claim`)
        .set(as('owner'))
        .send({ ...claim, claimCode: 'ZZZZ-ZZZZ' })
        .expect(400);
      await http
        .post(`/api/v1/orgs/${orgId}/devices/claim`)
        .set(as('member'))
        .send(claim)
        .expect(403);

      const res = await http
        .post(`/api/v1/orgs/${orgId}/devices/claim`)
        .set(as('owner'))
        .send(claim)
        .expect(201);
      fanId = res.body.id;
      expect(res.body).toMatchObject({
        name: 'Desk fan',
        typeKey: 'fanled',
        location: { id: locationId, name: 'Dhaka office' },
        desiredState: {},
        online: false,
      });
      expect(res.body.secretHash).toBeUndefined();

      // Same code again (even by the same org) fails: it's single use.
      await http
        .post(`/api/v1/orgs/${orgId}/devices/claim`)
        .set(as('owner'))
        .send(claim)
        .expect(400);

      camId = (
        await http
          .post(`/api/v1/orgs/${orgId}/devices/claim`)
          .set(as('owner'))
          .send({
            hardwareId: CAM.hardwareId,
            claimCode: CAM.code,
            name: 'Gate cam',
          })
          .expect(201)
      ).body.id;

      const list = await http
        .get(`/api/v1/orgs/${orgId}/devices?locationId=${locationId}`)
        .set(as('viewer'))
        .expect(200);
      expect(list.body.map((d: { id: string }) => d.id)).toEqual([fanId]);
      await http
        .get(`/api/v1/devices/${fanId}`)
        .set(as('outsider'))
        .expect(404);
    });

    it('validates desired state against the type schema and publishes it retained', async () => {
      await http
        .patch(`/api/v1/devices/${fanId}/state`)
        .set(as('viewer'))
        .send({ state: { speed: 10 } })
        .expect(403);
      const bad = await http
        .patch(`/api/v1/devices/${fanId}/state`)
        .set(as('member'))
        .send({ state: { speed: 150 } })
        .expect(422);
      expect(bad.body.errors[0]).toMatchObject({ path: '/speed' });
      await http
        .patch(`/api/v1/devices/${fanId}/state`)
        .set(as('member'))
        .send({ state: { colour: 'red' } })
        .expect(422);

      const ok = await http
        .patch(`/api/v1/devices/${fanId}/state`)
        .set(as('member'))
        .send({ state: { speed: 60, light: true } })
        .expect(202);
      expect(ok.body).toEqual({
        stateVersion: 1,
        desiredState: { speed: 60, light: true },
      });
      expect(published.at(-1)).toEqual({
        hw: FAN.hardwareId,
        channel: 'state/desired',
        message: { version: 1, state: { speed: 60, light: true } },
        retain: true,
      });

      // If-Match: stale version → 412; current → OK. null removes a key (merge patch).
      await http
        .patch(`/api/v1/devices/${fanId}/state`)
        .set(as('member'))
        .set('If-Match', '"0"')
        .send({ state: { speed: 1 } })
        .expect(412);
      const merged = await http
        .patch(`/api/v1/devices/${fanId}/state`)
        .set(as('member'))
        .set('If-Match', '"1"')
        .send({ state: { light: null } })
        .expect(202);
      expect(merged.body).toEqual({
        stateVersion: 2,
        desiredState: { speed: 60 },
      });
    });

    it('applies reported state from the device and derives online/syncing', async () => {
      let fan = (await http.get(`/api/v1/devices/${fanId}`).set(as('viewer')))
        .body;
      expect(fan).toMatchObject({ syncing: true, online: false });

      await device(FAN.hardwareId, 'status', {
        online: true,
        firmware: '2.0.1',
      });
      await device(FAN.hardwareId, 'state/reported', {
        state: { speed: 60, light: false },
      });
      await device(FAN.hardwareId, 'state/reported', { state: { speed: 999 } }); // invalid → ignored

      fan = (await http.get(`/api/v1/devices/${fanId}`).set(as('viewer'))).body;
      expect(fan).toMatchObject({
        reportedState: { speed: 60, light: false },
        syncing: false,
        online: true,
        firmwareVersion: '2.0.1',
      });
    });

    it('adopts changes made on the device (local: true) as the desired state', async () => {
      const before = (
        await http.get(`/api/v1/devices/${fanId}`).set(as('viewer'))
      ).body;
      await device(FAN.hardwareId, 'state/reported', {
        state: { speed: 35, light: true },
        local: true,
      });
      const fan = (await http.get(`/api/v1/devices/${fanId}`).set(as('viewer')))
        .body;
      expect(fan).toMatchObject({
        desiredState: { speed: 35, light: true },
        reportedState: { speed: 35, light: true },
        stateVersion: before.stateVersion + 1,
        syncing: false,
      });
      // Retained, so a reconnecting device doesn't get the old value back.
      expect(published.at(-1)).toEqual({
        hw: FAN.hardwareId,
        channel: 'state/desired',
        message: {
          version: before.stateVersion + 1,
          state: { speed: 35, light: true },
        },
        retain: true,
      });

      // Same state again: no new version. Without `local`, desired is untouched.
      const count = published.length;
      await device(FAN.hardwareId, 'state/reported', {
        state: { speed: 35, light: true },
        local: true,
      });
      await device(FAN.hardwareId, 'state/reported', { state: { speed: 20 } });
      expect(published.length).toBe(count);
      expect(
        (await http.get(`/api/v1/devices/${fanId}`).set(as('viewer'))).body,
      ).toMatchObject({
        desiredState: { speed: 35 },
        stateVersion: before.stateVersion + 1,
        syncing: true,
      });
    });

    it('validates and acks commands per device type', async () => {
      await http
        .post(`/api/v1/devices/${fanId}/commands`)
        .set(as('member'))
        .send({ action: 'snapshot' })
        .expect(422);
      await http
        .post(`/api/v1/devices/${camId}/commands`)
        .set(as('member'))
        .send({ action: 'snapshot', payload: { quality: 5 } })
        .expect(422);
      await http
        .post(`/api/v1/devices/${camId}/commands`)
        .set(as('viewer'))
        .send({ action: 'reboot' })
        .expect(403);

      const cmd = await http
        .post(`/api/v1/devices/${camId}/commands`)
        .set(as('member'))
        .send({ action: 'snapshot', payload: { quality: 12 } })
        .expect(202);
      await vi.waitFor(() =>
        expect(published.at(-1)).toMatchObject({
          hw: CAM.hardwareId,
          channel: 'cmd',
          message: { id: cmd.body.id, action: 'snapshot' },
        }),
      );

      // Another device can't ack it.
      await device(FAN.hardwareId, 'cmd/ack', { id: cmd.body.id, ok: true });
      expect(
        (await http.get(`/api/v1/commands/${cmd.body.id}`).set(as('viewer')))
          .body.status,
      ).toBe('sent');

      await device(CAM.hardwareId, 'cmd/ack', {
        id: cmd.body.id,
        ok: true,
        result: { bytes: 2048 },
      });
      const done = await http
        .get(`/api/v1/commands/${cmd.body.id}`)
        .set(as('viewer'))
        .expect(200);
      expect(done.body).toMatchObject({
        status: 'succeeded',
        result: { bytes: 2048 },
      });
      await http
        .get(`/api/v1/commands/${cmd.body.id}`)
        .set(as('outsider'))
        .expect(404);

      // Never acked → expired after COMMAND_TTL (1s in tests).
      const stale = await http
        .post(`/api/v1/devices/${camId}/commands`)
        .set(as('member'))
        .send({ action: 'reboot' })
        .expect(202);
      await new Promise((resolve) => setTimeout(resolve, 1100));
      const history = await http
        .get(`/api/v1/devices/${camId}/commands`)
        .set(as('viewer'))
        .expect(200);
      expect(history.body[0]).toMatchObject({
        id: stale.body.id,
        status: 'expired',
      });
    });

    it('stores telemetry in monthly partitions and aggregates it', async () => {
      await device(FAN.hardwareId, 'telemetry', { rssi: -60, rpm: 1000 });
      await new Promise((resolve) => setTimeout(resolve, 5));
      await device(FAN.hardwareId, 'telemetry', { rssi: -70, rpm: 1200 });
      await device(FAN.hardwareId, 'telemetry', { rssi: 'bad' }); // ignored

      const partitions = await app
        .get(DataSource)
        .query(
          `SELECT count(*)::int AS n FROM pg_inherits WHERE inhparent = 'telemetry'::regclass`,
        );
      expect(partitions[0].n).toBe(3); // default + this month + next month

      const res = await http
        .get(`/api/v1/devices/${fanId}/telemetry?bucket=1h`)
        .set(as('viewer'))
        .expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].metrics).toEqual({
        rpm: { avg: 1100, min: 1000, max: 1200 },
        rssi: { avg: -65, min: -70, max: -60 },
      });
      await http
        .get(`/api/v1/devices/${fanId}/telemetry?bucket=7h`)
        .set(as('viewer'))
        .expect(400);
    });

    it('pushes realtime events only to subscribed members', async () => {
      const port = (app.getHttpServer().address() as { port: number }).port;
      const connect = (user: string) =>
        io(`http://localhost:${port}/realtime`, {
          auth: { token: tokens[user].access },
          transports: ['websocket'],
        });

      const viewer: Socket = connect('viewer');
      const outsider: Socket = connect('outsider');
      try {
        expect(await viewer.emitWithAck('subscribe', { orgId })).toEqual({
          ok: true,
        });
        expect(
          await outsider.emitWithAck('subscribe', { orgId }),
        ).toMatchObject({ ok: false });

        const leaked = vi.fn();
        outsider.on('device.desired', leaked);
        const received = new Promise((resolve) =>
          viewer.once('device.desired', resolve),
        );
        await http
          .patch(`/api/v1/devices/${fanId}/state`)
          .set(as('member'))
          .send({ state: { speed: 80 } })
          .expect(202);
        expect(await received).toMatchObject({
          deviceId: fanId,
          desiredState: { speed: 80 },
          syncing: true,
        });
        expect(leaked).not.toHaveBeenCalled();
      } finally {
        viewer.close();
        outsider.close();
      }
    });

    it('releases a device with a fresh claim code', async () => {
      await http
        .delete(`/api/v1/devices/${camId}`)
        .set(as('member'))
        .expect(403);
      const released = await http
        .delete(`/api/v1/devices/${camId}`)
        .set(as('owner'))
        .expect(200);
      expect(released.body.claimCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      await http.get(`/api/v1/devices/${camId}`).set(as('owner')).expect(404);
      await http
        .post(`/api/v1/orgs/${orgId}/devices/claim`)
        .set(as('owner'))
        .send({
          hardwareId: CAM.hardwareId,
          claimCode: released.body.claimCode,
          name: 'Gate cam again',
        })
        .expect(201);
    });
  });

  describe('platform roles', () => {
    const staff: Record<string, string> = {};
    let rgbId: string;

    beforeAll(async () => {
      const users = app.get(DataSource).getRepository(User);
      for (const role of ['super_admin', 'developer'] as const) {
        const res = await http
          .post('/api/v1/auth/register')
          .send({
            name: role,
            email: `${role}@bongomaker.com`,
            password: 'password1',
          })
          .expect(201);
        await users.update({ id: res.body.user.id }, { platformRole: role });
        staff[role] = res.body.accessToken;
        tokens[role] = {
          access: res.body.accessToken,
          refresh: res.body.refreshToken,
          id: res.body.user.id,
        };
      }
    });

    it('lets staff see every organization; super_admin acts as owner, developer as viewer', async () => {
      const orgs = await http
        .get('/api/v1/orgs')
        .set(as('super_admin'))
        .expect(200);
      expect(orgs.body).toEqual([
        expect.objectContaining({ id: orgId, role: 'owner' }),
      ]);
      expect(
        (await http.get('/api/v1/orgs').set(as('developer'))).body[0].role,
      ).toBe('viewer');

      await http
        .get(`/api/v1/devices/${fanId}`)
        .set(as('developer'))
        .expect(200);
      await http
        .patch(`/api/v1/devices/${fanId}/state`)
        .set(as('developer'))
        .send({ state: { speed: 5 } })
        .expect(403);
      await http
        .patch(`/api/v1/devices/${fanId}/state`)
        .set(as('super_admin'))
        .send({ state: { speed: 5 } })
        .expect(202);
      await http
        .post(`/api/v1/orgs/${orgId}/locations`)
        .set(as('super_admin'))
        .send({ name: 'Staff room' })
        .expect(201);
    });

    it('restricts admin endpoints by platform role', async () => {
      await http.get('/api/v1/admin/stats').set(as('owner')).expect(403);
      const stats = await http
        .get('/api/v1/admin/stats')
        .set(as('developer'))
        .expect(200);
      expect(stats.body).toMatchObject({
        users: 6,
        staff: 2,
        organizations: 1,
      });

      await http.get('/api/v1/admin/users').set(as('developer')).expect(403);
      const users = await http
        .get('/api/v1/admin/users?search=example')
        .set(as('super_admin'))
        .expect(200);
      expect(users.body).toHaveLength(4);
      expect(users.body[0].passwordHash).toBeUndefined();

      // Promote/demote, and the last super admin can't be removed.
      await http
        .patch(`/api/v1/admin/users/${tokens.viewer.id}`)
        .set(as('super_admin'))
        .send({ platformRole: 'developer' })
        .expect(200);
      await http
        .patch(`/api/v1/admin/users/${tokens.viewer.id}`)
        .set(as('super_admin'))
        .send({ platformRole: null })
        .expect(200);
      await http
        .patch(`/api/v1/admin/users/${tokens.viewer.id}`)
        .set(as('super_admin'))
        .send({ platformRole: 'root' })
        .expect(400);
      await http
        .patch(`/api/v1/admin/users/${tokens.super_admin.id}`)
        .set(as('super_admin'))
        .send({ platformRole: null })
        .expect(400);
    });

    it('provisions devices (staff only) and shows them unclaimed', async () => {
      await http
        .post('/api/v1/admin/devices')
        .set(as('owner'))
        .send({ typeKey: 'rgb_bar', hardwareId: 'BM_RGB_T1' })
        .expect(403);
      await http
        .post('/api/v1/admin/devices')
        .set(as('developer'))
        .send({ typeKey: 'toaster', hardwareId: 'X_1' })
        .expect(400);
      await http
        .post('/api/v1/admin/devices')
        .set(as('developer'))
        .send({ typeKey: 'rgb_bar', hardwareId: 'bad/topic' })
        .expect(400);
      const made = await http
        .post('/api/v1/admin/devices')
        .set(as('developer'))
        .send({ typeKey: 'rgb_bar', hardwareId: 'BM_RGB_T1' })
        .expect(201);
      expect(made.body).toMatchObject({
        hardwareId: 'BM_RGB_T1',
        typeKey: 'rgb_bar',
        deviceSecret: expect.any(String),
        claimCode: expect.stringMatching(/^.{4}-.{4}$/),
      });
      await http
        .post('/api/v1/admin/devices')
        .set(as('developer'))
        .send({ typeKey: 'rgb_bar', hardwareId: 'BM_RGB_T1' })
        .expect(409);

      const unclaimed = await http
        .get('/api/v1/admin/devices?status=unclaimed')
        .set(as('developer'))
        .expect(200);
      expect(
        unclaimed.body.map((d: { hardwareId: string }) => d.hardwareId),
      ).toContain('BM_RGB_T1');

      rgbId = (
        await http
          .post(`/api/v1/orgs/${orgId}/devices/claim`)
          .set(as('owner'))
          .send({
            hardwareId: 'BM_RGB_T1',
            claimCode: made.body.claimCode,
            name: 'Monitor bar',
          })
          .expect(201)
      ).body.id;
    });

    it('deletes devices with their MQTT account (super_admin only)', async () => {
      const made = (
        await http
          .post('/api/v1/admin/devices')
          .set(as('developer'))
          .send({ typeKey: 'fanled', hardwareId: 'BM_DEL_1' })
          .expect(201)
      ).body;
      const claimed = (
        await http
          .post(`/api/v1/orgs/${orgId}/devices/claim`)
          .set(as('owner'))
          .send({
            hardwareId: 'BM_DEL_1',
            claimCode: made.claimCode,
            name: 'To delete',
          })
          .expect(201)
      ).body;

      for (const role of ['owner', 'developer']) {
        await http
          .delete(`/api/v1/admin/devices/${made.id}`)
          .set(as(role))
          .expect(403);
      }
      await http
        .delete('/api/v1/admin/devices/00000000-0000-4000-8000-000000000000')
        .set(as('super_admin'))
        .expect(404);
      await http
        .delete(`/api/v1/admin/devices/${made.id}`)
        .set(as('super_admin'))
        .expect(204);

      await http
        .get(`/api/v1/devices/${claimed.id}`)
        .set(as('owner'))
        .expect(404);
      const accounts = await http
        .get('/api/v1/admin/mqtt-users?search=BM_DEL_1')
        .set(as('super_admin'))
        .expect(200);
      expect(accounts.body).toEqual([]);
      expect(published.slice(-2)).toEqual([
        {
          hw: 'BM_DEL_1',
          channel: 'state/desired',
          message: null,
          retain: true,
        },
        { hw: 'BM_DEL_1', channel: 'status', message: null, retain: true },
      ]);
      // The hardware ID is free again.
      await http
        .post('/api/v1/admin/devices')
        .set(as('developer'))
        .send({ typeKey: 'fanled', hardwareId: 'BM_DEL_1' })
        .expect(201);
    });

    it('suggests the next hardware ID per type prefix', async () => {
      const next = (typeKey: string) =>
        http
          .get(`/api/v1/admin/devices/next-id?typeKey=${typeKey}`)
          .set(as('developer'));
      await http
        .get('/api/v1/admin/devices/next-id?typeKey=rgb_bar')
        .set(as('owner'))
        .expect(403);
      await next('toaster').expect(400);
      await next('').expect(400);

      expect((await next('camera').expect(200)).body).toEqual({
        hardwareId: 'BM_CAM_00001',
      });
      // Gaps and non-matching IDs (BM_MBL_X, BM_MBLX_9) are ignored; the highest number wins.
      for (const hardwareId of ['BM_MBL_00001', 'BM_MBL_00041', 'BM_MBL_X']) {
        await http
          .post('/api/v1/admin/devices')
          .set(as('developer'))
          .send({ typeKey: 'rgb_bar', hardwareId })
          .expect(201);
      }
      const { hardwareId } = (await next('rgb_bar').expect(200)).body;
      expect(hardwareId).toBe('BM_MBL_00042');
      await http
        .post('/api/v1/admin/devices')
        .set(as('developer'))
        .send({ typeKey: 'rgb_bar', hardwareId })
        .expect(201);
      expect((await next('rgb_bar').expect(200)).body.hardwareId).toBe(
        'BM_MBL_00043',
      );
    });

    it('validates monitor bar light state, including colour temperature', async () => {
      await http
        .patch(`/api/v1/devices/${rgbId}/state`)
        .set(as('member'))
        .send({ state: { colorTemp: 9000 } })
        .expect(422);
      await http
        .patch(`/api/v1/devices/${rgbId}/state`)
        .set(as('member'))
        .send({ state: { color: 'red' } })
        .expect(422);
      const ok = await http
        .patch(`/api/v1/devices/${rgbId}/state`)
        .set(as('member'))
        .send({
          state: { on: true, mode: 'white', colorTemp: 4000, brightness: 70 },
        })
        .expect(202);
      expect(ok.body.desiredState).toEqual({
        on: true,
        mode: 'white',
        colorTemp: 4000,
        brightness: 70,
      });
      await http
        .post(`/api/v1/devices/${rgbId}/commands`)
        .set(as('member'))
        .send({
          action: 'play_effect',
          payload: { effect: 'rainbow', durationSec: 30 },
        })
        .expect(202);
    });

    it('reports command activity per day for the dashboard', async () => {
      const res = await http
        .get(`/api/v1/orgs/${orgId}/activity?days=7`)
        .set(as('viewer'))
        .expect(200);
      expect(res.body).toHaveLength(7);
      expect(res.body.at(-1)).toMatchObject({ commands: 3, failed: 1 }); // snapshot, expired reboot, effect
      await http
        .get(`/api/v1/orgs/${orgId}/activity`)
        .set(as('outsider'))
        .expect(404);
    });
  });

  describe('broker hooks (mosquitto-go-auth format)', () => {
    const hook = (path: string, body: object, secret = 'hook-secret') =>
      http.post(`/api/v1/mqtt/${path}?secret=${secret}`).send(body);
    const own = `devices/${FAN.hardwareId}`;

    it('authenticates devices with their own secret from Postgres', async () => {
      await hook('auth', {
        username: FAN.hardwareId,
        password: FAN.secret,
        clientid: 'fan',
      }).expect(200);
      await hook('auth', {
        username: FAN.hardwareId,
        password: 'wrong',
        clientid: 'fan',
      }).expect(403);
      await hook('auth', {
        username: 'nobody',
        password: 'x',
        clientid: 'x',
      }).expect(403);
      await hook('auth', {
        username: 'bm-central',
        password: 'service-pass',
        clientid: 'svc',
      }).expect(200);
      await hook(
        'auth',
        { username: FAN.hardwareId, password: FAN.secret },
        'wrong-hook',
      ).expect(403);
      // Header works too (EMQX style).
      await http
        .post('/api/v1/mqtt/auth')
        .set('x-hook-secret', 'hook-secret')
        .send({ username: FAN.hardwareId, password: FAN.secret })
        .expect(200);

      await hook('superuser', { username: 'bm-central' }).expect(200);
      await hook('superuser', { username: FAN.hardwareId }).expect(403);
    });

    it('limits devices to their own topics (acc 1 read, 2 write, 3 rw, 4 subscribe)', async () => {
      const acl = (topic: string, acc: number) =>
        hook('acl', { username: FAN.hardwareId, clientid: 'fan', topic, acc });
      await acl(`${own}/state/reported`, 2).expect(200);
      await acl(`${own}/telemetry`, 2).expect(200);
      await acl(`${own}/state/desired`, 4).expect(200);
      await acl(`${own}/state/desired`, 1).expect(200);
      await acl(`${own}/state/desired`, 2).expect(403);
      await acl(`${own}/state/desired`, 3).expect(403);
      await acl(`devices/${CAM.hardwareId}/cmd`, 4).expect(403);
      await acl('devices/#', 4).expect(403);
      await acl(`${own}/#`, 4).expect(403);
      await acl(`${own}/state/desired`, 9).expect(403);
      await hook('acl', {
        username: 'bm-central',
        clientid: 'svc',
        topic: 'devices/#',
        acc: 4,
      }).expect(200);
    });
  });

  describe('admin: MQTT users', () => {
    const own = `devices/${FAN.hardwareId}`;
    let clientId: string;
    let clientPassword: string;
    const hook = (path: string, body: object) =>
      http.post(`/api/v1/mqtt/${path}?secret=hook-secret`).send(body);

    it('shows broker info and lists device accounts without secrets', async () => {
      const broker = await http
        .get('/api/v1/admin/mqtt')
        .set(as('developer'))
        .expect(200);
      expect(broker.body).toMatchObject({
        broker: 'mosquitto',
        connected: false,
        topicPrefix: 'devices',
      });
      expect(JSON.stringify(broker.body)).not.toContain('service-pass');
      await http.get('/api/v1/admin/mqtt').set(as('owner')).expect(403);

      const users = await http
        .get('/api/v1/admin/mqtt-users?kind=device')
        .set(as('developer'))
        .expect(200);
      const fan = users.body.find(
        (u: { username: string }) => u.username === FAN.hardwareId,
      );
      expect(fan).toMatchObject({
        kind: 'device',
        enabled: true,
        device: { hardwareId: FAN.hardwareId, orgName: 'Acme' },
      });
      expect(fan.passwordHash).toBeUndefined();
      expect(fan.lastAuthAt).not.toBeNull(); // set by the auth hook above
    });

    it('creates client accounts with ACL rules (super_admin only)', async () => {
      const body = {
        username: 'nodered',
        acl: [
          { topic: 'devices/+/telemetry', access: 'read' },
          { topic: 'clients/%u/#', access: 'readwrite' },
        ],
      };
      await http
        .post('/api/v1/admin/mqtt-users')
        .set(as('developer'))
        .send(body)
        .expect(403);
      await http
        .post('/api/v1/admin/mqtt-users')
        .set(as('super_admin'))
        .send({ ...body, username: 'bad name' })
        .expect(400);
      await http
        .post('/api/v1/admin/mqtt-users')
        .set(as('super_admin'))
        .send({ ...body, acl: [{ topic: 'a/#/b', access: 'read' }] })
        .expect(400);
      await http
        .post('/api/v1/admin/mqtt-users')
        .set(as('super_admin'))
        .send({ ...body, username: 'bm-central' })
        .expect(409);
      await http
        .post('/api/v1/admin/mqtt-users')
        .set(as('super_admin'))
        .send({ ...body, username: FAN.hardwareId })
        .expect(409);

      const created = await http
        .post('/api/v1/admin/mqtt-users')
        .set(as('super_admin'))
        .send(body)
        .expect(201);
      clientId = created.body.user.id;
      clientPassword = created.body.password;
      expect(created.body.user).toMatchObject({
        username: 'nodered',
        kind: 'client',
        superuser: false,
      });

      const acl = (topic: string, acc: number, clientid = 'nr') =>
        hook('acl', { username: 'nodered', clientid, topic, acc });
      await hook('auth', {
        username: 'nodered',
        password: clientPassword,
        clientid: 'nr',
      }).expect(200);
      await acl(`${own}/telemetry`, 4).expect(200);
      await acl('devices/+/telemetry', 4).expect(200);
      await acl('devices/#', 4).expect(403); // broader than the rule
      await acl(`${own}/telemetry`, 2).expect(403); // read-only rule
      await acl('clients/nodered/flows', 3).expect(200); // %u expanded, readwrite
      await acl('clients/other/flows', 2).expect(403);
    });

    it('disables, resets passwords and deletes', async () => {
      await http
        .patch(`/api/v1/admin/mqtt-users/${clientId}`)
        .set(as('super_admin'))
        .send({ enabled: false })
        .expect(200);
      await hook('auth', {
        username: 'nodered',
        password: clientPassword,
      }).expect(403);
      await http
        .patch(`/api/v1/admin/mqtt-users/${clientId}`)
        .set(as('super_admin'))
        .send({ enabled: true, superuser: true })
        .expect(200);
      await hook('superuser', { username: 'nodered' }).expect(200);

      const reset = await http
        .post(`/api/v1/admin/mqtt-users/${clientId}/password`)
        .set(as('super_admin'))
        .expect(201);
      await hook('auth', {
        username: 'nodered',
        password: clientPassword,
      }).expect(403);
      await hook('auth', {
        username: 'nodered',
        password: reset.body.password,
      }).expect(200);

      // Device accounts: no custom ACL, no delete; resetting gives a new device secret.
      const fan = (
        await http
          .get('/api/v1/admin/mqtt-users?search=FANLED_T1')
          .set(as('super_admin'))
      ).body[0];
      await http
        .patch(`/api/v1/admin/mqtt-users/${fan.id}`)
        .set(as('super_admin'))
        .send({ superuser: true })
        .expect(400);
      await http
        .delete(`/api/v1/admin/mqtt-users/${fan.id}`)
        .set(as('super_admin'))
        .expect(400);
      const newSecret = (
        await http
          .post(`/api/v1/admin/mqtt-users/${fan.id}/password`)
          .set(as('super_admin'))
          .expect(201)
      ).body.password;
      await hook('auth', {
        username: FAN.hardwareId,
        password: FAN.secret,
      }).expect(403);
      await hook('auth', {
        username: FAN.hardwareId,
        password: newSecret,
      }).expect(200);

      await http
        .delete(`/api/v1/admin/mqtt-users/${clientId}`)
        .set(as('super_admin'))
        .expect(204);
      await hook('auth', {
        username: 'nodered',
        password: reset.body.password,
      }).expect(403);
    });

    it('creates the device account when provisioning', async () => {
      const made = await http
        .post('/api/v1/admin/devices')
        .set(as('developer'))
        .send({ typeKey: 'fanled', hardwareId: 'BM_FANLED_T9' })
        .expect(201);
      await hook('auth', {
        username: 'BM_FANLED_T9',
        password: made.body.deviceSecret,
      }).expect(200);
      await http
        .post('/api/v1/admin/devices')
        .set(as('developer'))
        .send({ typeKey: 'fanled', hardwareId: 'bm-central' })
        .expect(409);
    });
  });
});
