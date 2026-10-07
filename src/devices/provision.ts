import { BadRequestException, ConflictException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { claimCode, hashSecret, randomToken } from '../common/secrets.js';
import { DeviceType } from '../device-types/device-type.entity.js';
import { MqttUser } from '../mqtt/mqtt-user.entity.js';
import { Device } from './device.entity.js';

/** Safe as an MQTT username and topic segment. */
export const HARDWARE_ID = /^[A-Za-z0-9_-]{3,64}$/;

export interface ProvisionedDevice {
  id: string;
  hardwareId: string;
  typeKey: string;
  /** Flash into the firmware; the MQTT username is the hardware id. Shown once. */
  deviceSecret: string;
  /** Print on the label; single use. Shown once. */
  claimCode: string;
}

/** Prefixes are stored per device type; keep them to A-Z 0-9 and _ (used inside a regex). */
const ID_PREFIX = /^[A-Z0-9]+(_[A-Z0-9]+)*$/;

/** Next free `{prefix}_{00001}` for a type, counting devices and MQTT usernames. */
export async function nextHardwareId(
  dataSource: DataSource,
  typeKey: string,
): Promise<string> {
  const type = await dataSource
    .getRepository(DeviceType)
    .findOneBy({ key: typeKey });
  if (!type) {
    throw new BadRequestException(`Unknown device type ${typeKey}`);
  }
  if (!type.idPrefix || !ID_PREFIX.test(type.idPrefix)) {
    throw new BadRequestException(`${type.name} has no hardware ID prefix`);
  }
  const [{ last }] = (await dataSource.query(
    `SELECT COALESCE(MAX(substring(id FROM $1)::bigint), 0)::text AS "last"
       FROM (SELECT "hardwareId" AS id FROM "devices"
             UNION ALL SELECT "username" FROM "mqtt_users") ids`,
    [`^${type.idPrefix}_(\\d{1,15})$`],
  )) as Array<{ last: string }>;
  return `${type.idPrefix}_${String(BigInt(last) + 1n).padStart(5, '0')}`;
}

/** Creates an unclaimed device and its MQTT account. Only hashes of the two secrets are stored. */
export async function provisionDevice(
  dataSource: DataSource,
  typeKey: string,
  hardwareId: string,
): Promise<ProvisionedDevice> {
  if (!HARDWARE_ID.test(hardwareId)) {
    throw new BadRequestException(
      'hardwareId must be 3-64 characters of A-Z a-z 0-9 _ -',
    );
  }
  if (
    !(await dataSource.getRepository(DeviceType).existsBy({ key: typeKey }))
  ) {
    throw new BadRequestException(`Unknown device type ${typeKey}`);
  }
  const taken =
    (await dataSource.getRepository(Device).existsBy({ hardwareId })) ||
    (await dataSource
      .getRepository(MqttUser)
      .existsBy({ username: hardwareId })) ||
    hardwareId === process.env.MQTT_USERNAME;
  if (taken) {
    throw new ConflictException(`${hardwareId} already exists`);
  }
  const deviceSecret = randomToken(24);
  const code = claimCode();
  const [secretHash, claimCodeHash] = await Promise.all([
    hashSecret(deviceSecret),
    hashSecret(code),
  ]);
  const id = await dataSource.transaction(async (manager) => {
    const { identifiers } = await manager.insert(Device, {
      hardwareId,
      typeKey,
      claimCodeHash,
    });
    const deviceId = identifiers[0].id as string;
    await manager.insert(MqttUser, {
      username: hardwareId,
      passwordHash: secretHash,
      kind: 'device',
      deviceId,
    });
    return deviceId;
  });
  return {
    id,
    hardwareId,
    typeKey,
    deviceSecret,
    claimCode: code,
  };
}
