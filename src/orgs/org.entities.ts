import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  type Relation,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../users/user.entity.js';

/** A client account (tenant): a company or a household. Owns devices. */
@Entity('organizations')
export class Organization {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

export const ORG_ROLES = ['viewer', 'member', 'owner'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/** True if `role` is at least `min` (viewer < member < owner). */
export const hasRole = (role: OrgRole, min: OrgRole): boolean =>
  ORG_ROLES.indexOf(role) >= ORG_ROLES.indexOf(min);

/**
 * Per-organization role. viewer: read only · member: + control devices (state, commands) ·
 * owner: + claim/release devices, locations, members.
 * Platform staff (users.platformRole) get access on top of this, see OrgsService.requireRole.
 */
@Entity('org_members')
@Check(`"role" IN ('viewer', 'member', 'owner')`)
export class OrgMember {
  @PrimaryColumn('uuid')
  orgId: string;

  @PrimaryColumn('uuid')
  @Index()
  userId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  org?: Relation<Organization>;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user?: Relation<User>;

  @Column({ type: 'varchar' })
  role: OrgRole;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

/** A place inside an organization (office, floor, room, home) used to group devices. */
@Entity('locations')
@Unique(['orgId', 'name'])
export class Location {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  orgId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  org?: Relation<Organization>;

  @Column()
  name: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
