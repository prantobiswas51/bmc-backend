import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export const PLATFORM_ROLES = ['super_admin', 'developer'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

@Entity('users')
@Check(`"platformRole" IN ('super_admin', 'developer')`)
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  /** citext: case-insensitive unique email. */
  @Column({ type: 'citext', unique: true })
  email: string;

  @Column({ select: false })
  passwordHash: string;

  /**
   * BongoMaker staff. super_admin: everything, in every organization, plus user
   * management. developer: provisioning + read access to every organization.
   * Null for customers, whose access comes only from org_members.
   */
  @Column({ type: 'varchar', nullable: true })
  platformRole: PlatformRole | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
