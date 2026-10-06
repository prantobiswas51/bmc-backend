import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  OneToOne,
  JoinColumn,
  PrimaryGeneratedColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';
import { Device } from '../devices/device.entity.js';

export type MqttUserKind = 'device' | 'client';

export interface AclRule {
  /** MQTT topic filter; may use + and #, and %u (username) / %c (client id). */
  topic: string;
  access: 'read' | 'write' | 'readwrite';
}

/**
 * Broker accounts, checked by the broker through our auth hooks (no passwd file).
 * - device: one per device, username = hardwareId, ACL = its own topics (fixed template).
 * - client: anything else (dashboards, Node-RED, test tools), with its own ACL rules.
 */
@Entity('mqtt_users')
@Check(`"kind" IN ('device', 'client')`)
export class MqttUser {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  username: string;

  /** scrypt; the plain password is only ever shown once. */
  @Column({ select: false })
  passwordHash: string;

  @Column({ type: 'varchar' })
  kind: MqttUserKind;

  /** Unique via the one-to-one join column. */
  @Column({ type: 'uuid', nullable: true })
  deviceId: string | null;

  @OneToOne(() => Device, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'deviceId' })
  device?: Relation<Device> | null;

  /** Superusers skip ACL checks. Never for devices. */
  @Column({ default: false })
  superuser: boolean;

  /** Client ACL rules. Devices use the built-in template instead. */
  @Column({ type: 'jsonb', default: [] })
  acl: AclRule[];

  @Column({ default: true })
  enabled: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  lastAuthAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
