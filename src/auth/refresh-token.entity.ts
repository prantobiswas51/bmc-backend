import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { User } from '../users/user.entity.js';

/** Opaque, rotating refresh tokens (only the SHA-256 is stored). */
@Entity('refresh_tokens')
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user?: Relation<User>;

  @Column({ unique: true })
  tokenHash: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  /** Set when rotated or logged out. Reusing a revoked token revokes the whole family. */
  @Column({ type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  /** Set when exchanged for a new pair; cleared when the family is revoked. Drives the grace window. */
  @Column({ type: 'timestamptz', nullable: true })
  rotatedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
