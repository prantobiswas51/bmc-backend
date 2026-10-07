import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

export type JsonSchema = Record<string, unknown>;

/**
 * What a kind of device can do. New device types are rows, not migrations.
 * - stateSchema: JSON Schema for persistent settings (desired/reported state).
 * - commands: { [action]: JSON Schema of its payload } for one-shot actions.
 */
@Entity('device_types')
export class DeviceType {
  @PrimaryColumn()
  key: string;

  @Column()
  name: string;

  @Column({ type: 'jsonb' })
  stateSchema: JsonSchema;

  @Column({ type: 'jsonb', default: {} })
  commands: Record<string, JsonSchema>;

  /** Hardware ID prefix for provisioning, e.g. BM_MBL → BM_MBL_00001. */
  @Column({ type: 'varchar', nullable: true })
  idPrefix: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
