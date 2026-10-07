import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  PreconditionFailedException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { isDeepStrictEqual } from 'node:util';
import { DataSource, Repository } from 'typeorm';
import { mergePatch, parseJsonObject } from '../common/merge-patch.js';
import {
  claimCode,
  hashSecret,
  normalizeClaimCode,
  verifySecret,
} from '../common/secrets.js';
import { DeviceTypesService } from '../device-types/device-types.service.js';
import { MqttService } from '../mqtt/mqtt.service.js';
import type { OrgRole } from '../orgs/org.entities.js';
import { OrgsService } from '../orgs/orgs.service.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';
import { Device, type DeviceState } from './device.entity.js';
import {
  ClaimDeviceDto,
  ListDevicesQuery,
  UpdateDeviceDto,
} from './devices.dto.js';

export interface DeviceView {
  id: string;
  hardwareId: string;
  typeKey: string;
  orgId: string | null;
  locationId: string | null;
  location: { id: string; name: string } | null;
  name: string | null;
  desiredState: DeviceState;
  reportedState: DeviceState;
  stateVersion: number;
  /** Some desired value isn't reported back yet. */
  syncing: boolean;
  /** Derived from lastSeenAt; never stored. */
  online: boolean;
  lastSeenAt: Date | null;
  firmwareVersion: string | null;
  claimedAt: Date | null;
}

/** Resolved device for inbound MQTT handlers. */
export type SeenDevice = Pick<Device, 'id' | 'orgId' | 'typeKey'>;

const OFFLINE_AFTER_MS = Number(process.env.DEVICE_OFFLINE_AFTER ?? 90) * 1000;

@Injectable()
export class DevicesService {
  private readonly logger = new Logger(DevicesService.name);

  constructor(
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly orgs: OrgsService,
    private readonly types: DeviceTypesService,
    private readonly mqtt: MqttService,
    private readonly realtime: RealtimeGateway,
  ) {
    mqtt.on('state/reported', (hw, payload) => this.onReported(hw, payload));
    mqtt.on('status', (hw, payload) => this.onStatus(hw, payload));
  }

  /** The device-route access check: 404 unless claimed into an org the user belongs to. */
  async access(id: string, userId: string, min: OrgRole): Promise<Device> {
    const device = await this.devices.findOneBy({ id });
    if (!device?.orgId) {
      throw new NotFoundException('Device not found');
    }
    await this.orgs.requireRole(device.orgId, userId, min).catch((error) => {
      throw error instanceof NotFoundException
        ? new NotFoundException('Device not found')
        : error;
    });
    return device;
  }

  async list(
    orgId: string,
    userId: string,
    filters: ListDevicesQuery,
  ): Promise<DeviceView[]> {
    await this.orgs.requireRole(orgId, userId, 'viewer');
    const devices = await this.devices.find({
      where: {
        orgId,
        ...(filters.locationId && { locationId: filters.locationId }),
        ...(filters.type && { typeKey: filters.type }),
      },
      relations: { location: true },
      order: { name: 'ASC' },
    });
    return devices.map((device) => this.view(device));
  }

  async get(id: string, userId: string): Promise<DeviceView> {
    await this.access(id, userId, 'viewer');
    return this.view(
      await this.devices.findOneOrFail({
        where: { id },
        relations: { location: true },
      }),
    );
  }

  /** Single-use: the claim code is cleared in the same conditional update. */
  async claim(
    orgId: string,
    userId: string,
    dto: ClaimDeviceDto,
  ): Promise<DeviceView> {
    await this.orgs.requireRole(orgId, userId, 'owner');
    const device = await this.devices.findOne({
      where: { hardwareId: dto.hardwareId },
      select: { id: true, claimCodeHash: true },
    });
    const valid =
      !!device?.claimCodeHash &&
      (await verifySecret(
        normalizeClaimCode(dto.claimCode),
        device.claimCodeHash,
      ));
    if (!device || !valid) {
      throw new BadRequestException('Invalid hardware id or claim code');
    }
    if (dto.locationId) {
      await this.orgs.assertLocationInOrg(dto.locationId, orgId);
    }
    const { affected } = await this.devices.update(
      { id: device.id, claimCodeHash: device.claimCodeHash! },
      {
        orgId,
        locationId: dto.locationId ?? null,
        name: dto.name,
        claimCodeHash: null,
        claimedAt: new Date(),
      },
    );
    if (!affected) {
      throw new ConflictException('Device was just claimed');
    }
    return this.get(device.id, userId);
  }

  async update(
    id: string,
    userId: string,
    dto: UpdateDeviceDto,
  ): Promise<DeviceView> {
    const device = await this.access(id, userId, 'owner');
    if (dto.locationId) {
      await this.orgs.assertLocationInOrg(dto.locationId, device.orgId!);
    }
    await this.devices.update(id, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.locationId !== undefined && { locationId: dto.locationId }),
    });
    return this.get(id, userId);
  }

  /**
   * Platform admin: deletes the device for good. Its commands, telemetry and MQTT
   * account go with it (ON DELETE CASCADE); retained broker messages are cleared so a
   * re-provisioned ID starts clean.
   */
  async remove(id: string): Promise<void> {
    const device = await this.devices.findOneBy({ id });
    if (!device) {
      throw new NotFoundException('Device not found');
    }
    await this.devices.delete({ id });
    await this.mqtt.publish(device.hardwareId, 'state/desired', null, true);
    await this.mqtt.publish(device.hardwareId, 'status', null, true);
    this.realtime.emit(device.orgId, 'device.removed', { deviceId: id });
  }

  /**
   * Removes the device from the organization and wipes its shadow. Returns a fresh
   * claim code so it can be handed over and claimed again.
   */
  async release(id: string, userId: string): Promise<{ claimCode: string }> {
    const device = await this.access(id, userId, 'owner');
    const code = claimCode();
    await this.devices.update(id, {
      orgId: null,
      locationId: null,
      name: null,
      claimCodeHash: await hashSecret(code),
      claimedAt: null,
      desiredState: {},
      reportedState: {},
      stateVersion: device.stateVersion + 1,
    });
    await this.mqtt.publish(device.hardwareId, 'state/desired', null, true);
    this.realtime.emit(device.orgId, 'device.removed', { deviceId: id });
    return { claimCode: code };
  }

  /**
   * Merge-patches desired state, validates it against the type's stateSchema,
   * bumps stateVersion and publishes it (retained, so a reconnecting device catches up).
   */
  async patchState(
    id: string,
    userId: string,
    patch: Record<string, unknown>,
    ifMatch?: string,
  ): Promise<{ stateVersion: number; desiredState: DeviceState }> {
    await this.access(id, userId, 'member');
    const device = await this.dataSource.transaction(async (manager) => {
      const current = await manager.findOneOrFail(Device, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      const expected = ifMatch?.replace(/^W\//, '').replace(/"/g, '').trim();
      if (expected && expected !== String(current.stateVersion)) {
        throw new PreconditionFailedException({
          message: 'State changed since you read it',
          stateVersion: current.stateVersion,
        });
      }
      const desiredState = mergePatch(
        current.desiredState,
        patch,
      ) as DeviceState;
      await this.types.validateState(current.typeKey, desiredState);
      current.desiredState = desiredState;
      current.stateVersion += 1;
      return manager.save(current);
    });

    await this.mqtt.publish(
      device.hardwareId,
      'state/desired',
      { version: device.stateVersion, state: device.desiredState },
      true,
    );
    this.realtime.emit(device.orgId, 'device.desired', {
      deviceId: id,
      desiredState: device.desiredState,
      stateVersion: device.stateVersion,
      syncing: this.isSyncing(device),
    });
    return {
      stateVersion: device.stateVersion,
      desiredState: device.desiredState,
    };
  }

  /**
   * Marks a device as seen and resolves it for inbound messages. Emits `device.online`
   * when it comes back after being offline. Returns null for unknown hardware ids.
   */
  async touch(hardwareId: string): Promise<SeenDevice | null> {
    const [rows] = (await this.dataSource.query(
      `UPDATE "devices" d SET "lastSeenAt" = now()
         FROM (SELECT "id", "lastSeenAt" AS "previous" FROM "devices"
               WHERE "hardwareId" = $1 FOR UPDATE) p
       WHERE d."id" = p."id"
       RETURNING d."id", d."orgId", d."typeKey", p."previous"`,
      [hardwareId],
    )) as [Array<SeenDevice & { previous: Date | null }>, number];
    const row = rows?.[0];
    if (!row) {
      return null;
    }
    if (!this.isOnline(row.previous)) {
      this.realtime.emit(row.orgId, 'device.online', {
        deviceId: row.id,
        online: true,
      });
    }
    return { id: row.id, orgId: row.orgId, typeKey: row.typeKey };
  }

  /**
   * `{"state": {...}}` from the device. With `"local": true` the change was made on the
   * device itself (knob, switch, local web page): it also becomes the desired state, so
   * the panel doesn't show it as pending and the retained desired state can't revert it.
   */
  private async onReported(hardwareId: string, payload: Buffer) {
    const message = parseJsonObject(payload);
    const state = message?.state;
    const seen = await this.touch(hardwareId);
    if (!seen || typeof state !== 'object' || state === null) {
      return;
    }
    const local = message?.local === true;
    let desiredChanged = false;
    let device: Device;
    try {
      device = await this.dataSource.transaction(async (manager) => {
        const current = await manager.findOneOrFail(Device, {
          where: { id: seen.id },
          lock: { mode: 'pessimistic_write' },
        });
        const reportedState = mergePatch(
          current.reportedState,
          state,
        ) as DeviceState;
        await this.types.validateState(current.typeKey, reportedState);
        current.reportedState = reportedState;
        if (local) {
          const desiredState = mergePatch(
            current.desiredState,
            state,
          ) as DeviceState;
          if (!isDeepStrictEqual(desiredState, current.desiredState)) {
            current.desiredState = desiredState;
            current.stateVersion += 1;
            desiredChanged = true;
          }
        }
        return manager.save(current);
      });
    } catch (error) {
      this.logger.warn(
        `Ignoring invalid state from ${hardwareId}: ${JSON.stringify((error as { response?: unknown }).response)}`,
      );
      return;
    }
    if (desiredChanged) {
      await this.mqtt.publish(
        hardwareId,
        'state/desired',
        { version: device.stateVersion, state: device.desiredState },
        true,
      );
      this.realtime.emit(device.orgId, 'device.desired', {
        deviceId: device.id,
        desiredState: device.desiredState,
        stateVersion: device.stateVersion,
        syncing: this.isSyncing(device),
      });
    }
    const reportedState = device.reportedState;
    this.realtime.emit(device.orgId, 'device.reported', {
      deviceId: device.id,
      reportedState,
      syncing: this.isSyncing(device),
      lastSeenAt: new Date(),
    });
  }

  /** `{"online": true, "firmware": "1.2.0"}` on connect; the broker sends `{"online": false}` (LWT). */
  private async onStatus(hardwareId: string, payload: Buffer) {
    const status = parseJsonObject(payload);
    if (status?.online === false) {
      const device = await this.devices.findOneBy({ hardwareId });
      this.realtime.emit(device?.orgId ?? null, 'device.online', {
        deviceId: device?.id,
        online: false,
      });
      return;
    }
    const seen = await this.touch(hardwareId);
    if (seen && typeof status?.firmware === 'string') {
      await this.devices.update(seen.id, {
        firmwareVersion: status.firmware.slice(0, 64),
      });
    }
  }

  view(device: Device): DeviceView {
    return {
      id: device.id,
      hardwareId: device.hardwareId,
      typeKey: device.typeKey,
      orgId: device.orgId,
      locationId: device.locationId,
      location: device.location
        ? { id: device.location.id, name: device.location.name }
        : null,
      name: device.name,
      desiredState: device.desiredState,
      reportedState: device.reportedState,
      stateVersion: device.stateVersion,
      syncing: this.isSyncing(device),
      online: this.isOnline(device.lastSeenAt),
      lastSeenAt: device.lastSeenAt,
      firmwareVersion: device.firmwareVersion,
      claimedAt: device.claimedAt,
    };
  }

  private isSyncing(device: Pick<Device, 'desiredState' | 'reportedState'>) {
    return Object.entries(device.desiredState).some(
      ([key, value]) => !isDeepStrictEqual(device.reportedState[key], value),
    );
  }

  private isOnline(lastSeenAt: Date | null): boolean {
    return (
      !!lastSeenAt &&
      Date.now() - new Date(lastSeenAt).getTime() <= OFFLINE_AFTER_MS
    );
  }
}
