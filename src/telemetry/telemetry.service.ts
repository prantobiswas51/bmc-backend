import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { parseJsonObject } from '../common/merge-patch.js';
import { DevicesService } from '../devices/devices.service.js';
import { MqttService } from '../mqtt/mqtt.service.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';
import { TelemetryQuery, BUCKETS } from './telemetry.dto.js';

export interface TelemetryPoint {
  bucket: Date;
  metrics: Record<string, { avg: number; min: number; max: number }>;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_MS = 31 * DAY_MS;
const RETENTION_MONTHS = 12;

@Injectable()
export class TelemetryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelemetryService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly devices: DevicesService,
    private readonly realtime: RealtimeGateway,
    mqtt: MqttService,
  ) {
    mqtt.on('telemetry', (hw, payload) => this.onTelemetry(hw, payload));
  }

  /** Keep this and next month's partitions in place, detach expired ones (checked daily). */
  async onModuleInit(): Promise<void> {
    await this.maintainPartitions();
    this.timer = setInterval(() => void this.maintainPartitions(), DAY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  private async maintainPartitions(): Promise<void> {
    await this.ensurePartitions();
    await this.detachExpiredPartitions();
  }

  async ensurePartitions(now = new Date()): Promise<void> {
    for (const offset of [0, 1]) {
      const start = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1),
      );
      const end = new Date(
        Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1),
      );
      const name = `telemetry_y${start.getUTCFullYear()}m${String(start.getUTCMonth() + 1).padStart(2, '0')}`;
      try {
        await this.dataSource.query(
          `CREATE TABLE IF NOT EXISTS "${name}" PARTITION OF "telemetry"
           FOR VALUES FROM ('${start.toISOString()}') TO ('${end.toISOString()}')`,
        );
      } catch (error) {
        this.logger.error(
          `Could not create ${name}: ${(error as Error).message}`,
        );
      }
    }
  }

  /**
   * Detach and drop monthly partitions that lie entirely beyond the retention
   * window. Dropping is permanent: the telemetry rows in them are deleted.
   */
  async detachExpiredPartitions(now = new Date()): Promise<void> {
    const cutoff = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth() - RETENTION_MONTHS,
      1,
    );
    try {
      const rows = (await this.dataSource.query(
        `SELECT c.relname AS "name"
           FROM pg_inherits i
           JOIN pg_class c ON c.oid = i.inhrelid
          WHERE i.inhparent = 'telemetry'::regclass`,
      )) as Array<{ name: string }>;
      for (const { name } of rows) {
        const match = /^telemetry_y(\d{4})m(\d{2})$/.exec(name);
        if (!match) {
          continue; // telemetry_default and anything unrecognised
        }
        if (Date.UTC(Number(match[1]), Number(match[2]) - 1, 1) >= cutoff) {
          continue;
        }
        await this.dataSource.query(
          `ALTER TABLE "telemetry" DETACH PARTITION "${name}"`,
        );
        await this.dataSource.query(`DROP TABLE "${name}"`);
        this.logger.log(`Detached and dropped expired partition ${name}`);
      }
    } catch (error) {
      this.logger.error(
        `Could not detach expired partitions: ${(error as Error).message}`,
      );
    }
  }

  /** Aggregated per bucket with date_bin: avg/min/max of every numeric metric. */
  async query(
    deviceId: string,
    userId: string,
    { from, to, bucket = '5m' }: TelemetryQuery,
  ): Promise<TelemetryPoint[]> {
    await this.devices.access(deviceId, userId, 'viewer');
    const end = to ? new Date(to) : new Date();
    const start = from ? new Date(from) : new Date(end.getTime() - DAY_MS);
    if (start >= end || end.getTime() - start.getTime() > MAX_RANGE_MS) {
      throw new BadRequestException(
        '`from` must be before `to`, at most 31 days apart',
      );
    }
    const rows = (await this.dataSource.query(
      `SELECT date_bin($2::interval, t."ts", $3::timestamptz) AS "bucket",
              m."key",
              avg((m."value")::double precision) AS "avg",
              min((m."value")::double precision) AS "min",
              max((m."value")::double precision) AS "max"
         FROM "telemetry" t, jsonb_each(t."metrics") AS m("key", "value")
        WHERE t."deviceId" = $1 AND t."ts" >= $3 AND t."ts" < $4
          AND jsonb_typeof(m."value") = 'number'
        GROUP BY 1, 2
        ORDER BY 1, 2`,
      [deviceId, BUCKETS[bucket], start, end],
    )) as Array<{
      bucket: Date;
      key: string;
      avg: number;
      min: number;
      max: number;
    }>;

    const points = new Map<number, TelemetryPoint>();
    for (const { bucket: at, key, avg, min, max } of rows) {
      const point = points.get(at.getTime()) ?? { bucket: at, metrics: {} };
      point.metrics[key] = { avg, min, max };
      points.set(at.getTime(), point);
    }
    return [...points.values()];
  }

  /** Payload: a flat object of numbers, e.g. `{"rssi": -61, "rpm": 1200}`. */
  private async onTelemetry(hardwareId: string, payload: Buffer) {
    const metrics = parseJsonObject(payload);
    const device = await this.devices.touch(hardwareId);
    const entries = Object.entries(metrics ?? {});
    const valid =
      entries.length > 0 &&
      entries.length <= 50 &&
      entries.every(([, value]) => Number.isFinite(value));
    if (!device || !valid) {
      return;
    }
    const ts = new Date();
    await this.dataSource.query(
      `INSERT INTO "telemetry" ("deviceId", "ts", "metrics") VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [device.id, ts, JSON.stringify(metrics)],
    );
    this.realtime.emit(device.orgId, 'device.telemetry', {
      deviceId: device.id,
      ts,
      metrics,
    });
  }
}
