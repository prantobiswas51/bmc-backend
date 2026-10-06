import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { hashSecret, randomToken } from '../common/secrets.js';
import { brokerAdapter } from './brokers/index.js';
import { DEVICE_ACL, MqttAuthService } from './mqtt-auth.service.js';
import { mqttConfig, safeBrokerUrl } from './mqtt.config.js';
import { MqttService } from './mqtt.service.js';
import { type AclRule, MqttUser } from './mqtt-user.entity.js';
import {
  CreateMqttUserDto,
  isTopicFilter,
  MqttUsersQuery,
  UpdateMqttUserDto,
} from './mqtt-users.dto.js';

export interface MqttUserView {
  id: string;
  username: string;
  kind: MqttUser['kind'];
  superuser: boolean;
  enabled: boolean;
  acl: AclRule[];
  lastAuthAt: Date | null;
  createdAt: Date;
  device: {
    id: string;
    hardwareId: string;
    typeKey: string;
    name: string | null;
    orgName: string | null;
  } | null;
}

/** Escape LIKE wildcards in user input. */
const like = (value: string) => `%${value.replace(/[\\%_]/g, '\\$&')}%`;

@Injectable()
export class MqttUsersService {
  constructor(
    @InjectRepository(MqttUser) private readonly users: Repository<MqttUser>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly mqtt: MqttService,
    private readonly auth: MqttAuthService,
  ) {}

  /** Broker summary for the admin page. Never includes credentials. */
  broker() {
    const adapter = brokerAdapter(mqttConfig.broker);
    return {
      broker: adapter.name,
      integration: adapter.integration,
      url: safeBrokerUrl(),
      connected: this.mqtt.connected,
      topicPrefix: mqttConfig.topicPrefix,
      serviceUsername: mqttConfig.username || null,
      hooks: {
        auth: '/api/v1/mqtt/auth',
        superuser: '/api/v1/mqtt/superuser',
        acl: '/api/v1/mqtt/acl',
      },
      deviceAcl: DEVICE_ACL,
    };
  }

  async list({ kind, search }: MqttUsersQuery): Promise<MqttUserView[]> {
    const query = this.users
      .createQueryBuilder('u')
      .leftJoinAndSelect('u.device', 'd')
      .leftJoinAndSelect('d.org', 'o')
      .orderBy('u.kind', 'ASC')
      .addOrderBy('u.username', 'ASC')
      .take(500);
    if (kind) query.andWhere('u.kind = :kind', { kind });
    if (search) query.andWhere('u.username ILIKE :q', { q: like(search) });
    return (await query.getMany()).map((u) => this.view(u));
  }

  /** Creates a client account. The generated password is returned once. */
  async create(
    dto: CreateMqttUserDto,
  ): Promise<{ user: MqttUserView; password: string }> {
    if (this.auth.isServiceAccount(dto.username)) {
      throw new ConflictException('That username is reserved for the backend');
    }
    if (await this.users.existsBy({ username: dto.username })) {
      throw new ConflictException('That username is taken');
    }
    const acl = this.validAcl(dto.acl ?? []);
    const password = randomToken(24);
    const user = await this.users.save(
      this.users.create({
        username: dto.username,
        passwordHash: await hashSecret(password),
        kind: 'client',
        superuser: dto.superuser ?? false,
        acl,
      }),
    );
    return { user: this.view(user), password };
  }

  async update(id: string, dto: UpdateMqttUserDto): Promise<MqttUserView> {
    const user = await this.find(id);
    if (
      user.kind === 'device' &&
      (dto.superuser !== undefined || dto.acl !== undefined)
    ) {
      throw new BadRequestException(
        'Device accounts use the fixed device ACL; only enable/disable them',
      );
    }
    await this.users.update(id, {
      ...(dto.enabled !== undefined && { enabled: dto.enabled }),
      ...(dto.superuser !== undefined && { superuser: dto.superuser }),
      ...(dto.acl !== undefined && { acl: this.validAcl(dto.acl) }),
    });
    return this.view(await this.find(id));
  }

  /** New password, returned once. For a device this is its new device secret (reflash firmware). */
  async resetPassword(id: string): Promise<{ password: string }> {
    await this.find(id);
    const password = randomToken(24);
    await this.users.update(id, { passwordHash: await hashSecret(password) });
    return { password };
  }

  /** Clients only; device accounts go away with their device. */
  async remove(id: string): Promise<void> {
    const user = await this.find(id);
    if (user.kind === 'device') {
      throw new BadRequestException(
        'Device accounts are removed with the device; disable it instead',
      );
    }
    await this.users.delete(id);
  }

  private async find(id: string): Promise<MqttUser> {
    const user = await this.users.findOne({
      where: { id },
      relations: { device: { org: true } },
    });
    if (!user) throw new NotFoundException('MQTT user not found');
    return user;
  }

  private validAcl(rules: AclRule[]): AclRule[] {
    const invalid = rules.find((rule) => !isTopicFilter(rule.topic));
    if (invalid) {
      throw new BadRequestException(
        `"${invalid.topic}" is not a valid MQTT topic filter`,
      );
    }
    return rules.map(({ topic, access }) => ({ topic, access }));
  }

  private view(u: MqttUser): MqttUserView {
    return {
      id: u.id,
      username: u.username,
      kind: u.kind,
      superuser: u.superuser,
      enabled: u.enabled,
      acl: u.kind === 'device' ? DEVICE_ACL : u.acl,
      lastAuthAt: u.lastAuthAt,
      createdAt: u.createdAt,
      device: u.device
        ? {
            id: u.device.id,
            hardwareId: u.device.hardwareId,
            typeKey: u.device.typeKey,
            name: u.device.name,
            orgName: u.device.org?.name ?? null,
          }
        : null,
    };
  }
}
