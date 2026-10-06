import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { Device } from '../devices/device.entity.js';
import { User } from '../users/user.entity.js';

export type CommandStatus =
  'pending' | 'sent' | 'succeeded' | 'failed' | 'expired';

/** One-shot action (snapshot, reboot, effect…) and its outcome. Never replayed. */
@Entity('commands')
@Index(['deviceId', 'createdAt'])
@Check(`"status" IN ('pending', 'sent', 'succeeded', 'failed', 'expired')`)
export class Command {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  deviceId: string;

  @ManyToOne(() => Device, { onDelete: 'CASCADE' })
  device?: Relation<Device>;

  @Column({ type: 'uuid', nullable: true })
  issuedBy: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'issuedBy' })
  issuer?: Relation<User> | null;

  @Column()
  action: string;

  @Column({ type: 'jsonb', default: {} })
  payload: Record<string, unknown>;

  @Column({ type: 'varchar', default: 'pending' })
  status: CommandStatus;

  /** Whatever the device returned with its ack (e.g. a media id or an error). */
  @Column({ type: 'jsonb', nullable: true })
  result: unknown;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  ackedAt: Date | null;
}
