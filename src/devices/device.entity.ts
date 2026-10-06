import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';
import { DeviceType } from '../device-types/device-type.entity.js';
import { Location, Organization } from '../orgs/org.entities.js';

export type DeviceState = Record<string, unknown>;

/**
 * A physical device and its shadow. Provisioned at the factory (`npm run device:create`),
 * then claimed into an organization with its single-use claim code.
 * Its broker login lives in mqtt_users (kind 'device').
 */
@Entity('devices')
export class Device {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Printed on the device and used as its MQTT username / topic segment. */
  @Column({ unique: true })
  hardwareId: string;

  @Column()
  typeKey: string;

  @ManyToOne(() => DeviceType, { onDelete: 'RESTRICT' })
  type?: Relation<DeviceType>;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  orgId: string | null;

  @ManyToOne(() => Organization, { onDelete: 'SET NULL' })
  org?: Relation<Organization> | null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  locationId: string | null;

  @ManyToOne(() => Location, { onDelete: 'SET NULL' })
  location?: Relation<Location> | null;

  @Column({ type: 'varchar', nullable: true })
  name: string | null;

  /** scrypt hash of the label claim code; null once claimed (single use). */
  @Column({ type: 'varchar', nullable: true, select: false })
  claimCodeHash: string | null;

  /** What users want. Validated against the type's stateSchema. */
  @Column({ type: 'jsonb', default: {} })
  desiredState: DeviceState;

  /** What the device last said it is doing. */
  @Column({ type: 'jsonb', default: {} })
  reportedState: DeviceState;

  /** Bumped on every desired-state change; used for If-Match. */
  @Column({ default: 0 })
  stateVersion: number;

  @Column({ type: 'varchar', nullable: true })
  firmwareVersion: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastSeenAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  claimedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
