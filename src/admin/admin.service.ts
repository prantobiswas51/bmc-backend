import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, ILike, IsNull, Not, Repository } from 'typeorm';
import { Device } from '../devices/device.entity.js';
import { DevicesService, DeviceView } from '../devices/devices.service.js';
import {
  nextHardwareId,
  provisionDevice,
  ProvisionedDevice,
} from '../devices/provision.js';
import { Organization } from '../orgs/org.entities.js';
import { type PlatformRole, User } from '../users/user.entity.js';
import { AdminDevicesQuery } from './admin.dto.js';

export type AdminUser = Pick<
  User,
  'id' | 'name' | 'email' | 'platformRole' | 'createdAt'
> & { orgCount: number };

export type AdminDevice = DeviceView & { orgName: string | null };

/** Escape LIKE wildcards in user input. */
const like = (value: string) => `%${value.replace(/[\\%_]/g, '\\$&')}%`;

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    @InjectRepository(Organization)
    private readonly orgs: Repository<Organization>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly devicesService: DevicesService,
  ) {}

  async stats() {
    const offlineAfter = Number(process.env.DEVICE_OFFLINE_AFTER ?? 90);
    const [row] = (await this.dataSource.query(
      `SELECT
         (SELECT count(*)::int FROM "users") AS "users",
         (SELECT count(*)::int FROM "users" WHERE "platformRole" IS NOT NULL) AS "staff",
         (SELECT count(*)::int FROM "organizations") AS "organizations",
         (SELECT count(*)::int FROM "devices") AS "devices",
         (SELECT count(*)::int FROM "devices" WHERE "orgId" IS NOT NULL) AS "claimed",
         (SELECT count(*)::int FROM "devices"
           WHERE "lastSeenAt" > now() - make_interval(secs => $1)) AS "online",
         (SELECT count(*)::int FROM "commands"
           WHERE "createdAt" > now() - interval '24 hours') AS "commands24h"`,
      [offlineAfter],
    )) as Array<Record<string, number>>;
    return row;
  }

  async listUsers(search?: string): Promise<AdminUser[]> {
    return this.dataSource.query(
      `SELECT u."id", u."name", u."email", u."platformRole", u."createdAt",
              (SELECT count(*)::int FROM "org_members" m WHERE m."userId" = u."id") AS "orgCount"
         FROM "users" u
        WHERE $1::text IS NULL OR u."name" ILIKE $1 OR u."email" ILIKE $1
        ORDER BY u."createdAt" DESC
        LIMIT 200`,
      [search ? like(search) : null],
    );
  }

  /** The last super admin can't be demoted (by anyone, including themselves). */
  async setPlatformRole(
    targetId: string,
    platformRole: PlatformRole | null,
  ): Promise<User> {
    const target = await this.users.findOneBy({ id: targetId });
    if (!target) {
      throw new NotFoundException('User not found');
    }
    if (
      target.platformRole === 'super_admin' &&
      platformRole !== 'super_admin' &&
      (await this.users.countBy({ platformRole: 'super_admin' })) <= 1
    ) {
      throw new BadRequestException('There must be at least one super admin');
    }
    await this.users.update(targetId, { platformRole });
    return { ...target, platformRole };
  }

  async listDevices(filters: AdminDevicesQuery): Promise<AdminDevice[]> {
    const devices = await this.devices.find({
      where: {
        ...(filters.status === 'claimed' && { orgId: Not(IsNull()) }),
        ...(filters.status === 'unclaimed' && { orgId: IsNull() }),
        ...(filters.type && { typeKey: filters.type }),
        ...(filters.search && { hardwareId: ILike(like(filters.search)) }),
      },
      relations: { location: true, org: true },
      order: { createdAt: 'DESC' },
      take: 500,
    });
    return devices.map((device) => ({
      ...this.devicesService.view(device),
      orgName: device.org?.name ?? null,
    }));
  }

  deleteDevice(id: string): Promise<void> {
    return this.devicesService.remove(id);
  }

  nextHardwareId(typeKey: string): Promise<string> {
    return nextHardwareId(this.dataSource, typeKey);
  }

  provision(typeKey: string, hardwareId: string): Promise<ProvisionedDevice> {
    return provisionDevice(this.dataSource, typeKey, hardwareId);
  }

  listOrganizations(): Promise<
    Array<Organization & { memberCount: number; deviceCount: number }>
  > {
    return this.dataSource.query(
      `SELECT o.*,
              (SELECT count(*)::int FROM "org_members" m WHERE m."orgId" = o."id") AS "memberCount",
              (SELECT count(*)::int FROM "devices" d WHERE d."orgId" = o."id") AS "deviceCount"
         FROM "organizations" o
        ORDER BY o."name"`,
    );
  }
}
