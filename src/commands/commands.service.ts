import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { parseJsonObject } from '../common/merge-patch.js';
import { DeviceTypesService } from '../device-types/device-types.service.js';
import { DevicesService } from '../devices/devices.service.js';
import { OrgsService } from '../orgs/orgs.service.js';
import { MqttService } from '../mqtt/mqtt.service.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';
import { Command } from './command.entity.js';
import { CreateCommandDto } from './commands.dto.js';

/** Unacked commands older than this are reported as expired. */
const TTL_MS = Number(process.env.COMMAND_TTL ?? 60) * 1000;

@Injectable()
export class CommandsService {
  private readonly logger = new Logger(CommandsService.name);

  constructor(
    @InjectRepository(Command) private readonly commands: Repository<Command>,
    private readonly devices: DevicesService,
    private readonly orgs: OrgsService,
    private readonly types: DeviceTypesService,
    private readonly mqtt: MqttService,
    private readonly realtime: RealtimeGateway,
  ) {
    mqtt.on('cmd/ack', (hw, payload) => this.onAck(hw, payload));
  }

  /** Member+: Validates action + payload for the device type, stores it, sends it. */
  async create(
    deviceId: string,
    userId: string,
    dto: CreateCommandDto,
  ): Promise<Command> {
    const device = await this.devices.access(deviceId, userId, 'member');
    const payload = dto.payload ?? {};
    await this.types.validateCommand(device.typeKey, dto.action, payload);
    const command = await this.commands.save(
      this.commands.create({
        deviceId,
        issuedBy: userId,
        action: dto.action,
        payload,
      }),
    );
    // Don't hold the request while the broker acks; status moves to "sent" when it does.
    void this.send(device.hardwareId, device.orgId, command);
    return command;
  }

  async list(deviceId: string, userId: string): Promise<Command[]> {
    await this.devices.access(deviceId, userId, 'viewer');
    await this.expireStale(deviceId);
    return this.commands.find({
      where: { deviceId },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  async get(id: string, userId: string): Promise<Command> {
    const command = await this.commands.findOneBy({ id });
    if (!command) {
      throw new NotFoundException('Command not found');
    }
    await this.devices.access(command.deviceId, userId, 'viewer').catch(() => {
      throw new NotFoundException('Command not found');
    });
    await this.expireStale(command.deviceId);
    return this.commands.findOneByOrFail({ id });
  }

  /** Commands sent per day in an organization, oldest first, zero-filled. */
  async activity(
    orgId: string,
    userId: string,
    days: number,
  ): Promise<Array<{ day: string; commands: number; failed: number }>> {
    await this.orgs.requireRole(orgId, userId, 'viewer');
    return this.commands.query(
      `SELECT to_char(d.day, 'YYYY-MM-DD') AS "day",
              count(c."id")::int AS "commands",
              count(c."id") FILTER (WHERE c."status" IN ('failed', 'expired'))::int AS "failed"
         FROM generate_series(current_date - ($2::int - 1), current_date, interval '1 day') AS d(day)
         LEFT JOIN "commands" c
           ON c."createdAt" >= d.day AND c."createdAt" < d.day + interval '1 day'
          AND c."deviceId" IN (SELECT "id" FROM "devices" WHERE "orgId" = $1)
        GROUP BY d.day
        ORDER BY d.day`,
      [orgId, days],
    );
  }

  private async send(
    hardwareId: string,
    orgId: string | null,
    command: Command,
  ) {
    try {
      await this.mqtt.publish(hardwareId, 'cmd', {
        id: command.id,
        action: command.action,
        payload: command.payload,
      });
      await this.commands.update(
        { id: command.id, status: 'pending' },
        { status: 'sent', sentAt: new Date() },
      );
      this.realtime.emit(orgId, 'command.updated', {
        ...command,
        status: 'sent',
      });
    } catch (error) {
      this.logger.error(
        `Failed to send command ${command.id}: ${(error as Error).message}`,
      );
    }
  }

  /** `{"id": "...", "ok": true, "result": {...}}` or `{"id": "...", "ok": false, "error": "..."}` */
  private async onAck(hardwareId: string, payload: Buffer) {
    const ack = parseJsonObject(payload);
    const device = await this.devices.touch(hardwareId);
    if (!device || typeof ack?.id !== 'string' || typeof ack.ok !== 'boolean') {
      return;
    }
    // Scoped to this device, so one device can't settle another device's commands.
    const command = await this.commands.findOneBy({
      id: ack.id,
      deviceId: device.id,
      status: In(['pending', 'sent', 'expired']),
    });
    if (!command) {
      return;
    }
    Object.assign(command, {
      status: ack.ok ? 'succeeded' : 'failed',
      result: ack.ok ? (ack.result ?? null) : { error: ack.error ?? 'failed' },
      ackedAt: new Date(),
    });
    await this.commands.save(command);
    this.realtime.emit(device.orgId, 'command.updated', command);
  }

  private async expireStale(deviceId: string): Promise<void> {
    await this.commands.update(
      {
        deviceId,
        status: In(['pending', 'sent']),
        createdAt: LessThan(new Date(Date.now() - TTL_MS)),
      },
      { status: 'expired' },
    );
  }
}
