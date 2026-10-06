import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Time-series readings (RPM, temperature, RSSI…). The table is partitioned by month and
 * managed by hand-written SQL (see the Init migration and TelemetryService), so TypeORM
 * must not try to sync it.
 */
@Entity({ name: 'telemetry', synchronize: false })
export class Telemetry {
  @PrimaryColumn('uuid')
  deviceId: string;

  @PrimaryColumn({ type: 'timestamptz' })
  ts: Date;

  @Column({ type: 'jsonb' })
  metrics: Record<string, number>;
}
