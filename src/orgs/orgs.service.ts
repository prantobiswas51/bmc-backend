import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { User } from '../users/user.entity.js';
import {
  hasRole,
  Location,
  OrgMember,
  Organization,
  type OrgRole,
} from './org.entities.js';

export type OrgWithRole = Organization & { role: OrgRole };

@Injectable()
export class OrgsService {
  constructor(
    @InjectRepository(Organization)
    private readonly orgs: Repository<Organization>,
    @InjectRepository(OrgMember)
    private readonly members: Repository<OrgMember>,
    @InjectRepository(Location)
    private readonly locations: Repository<Location>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /**
   * The single access check for everything org-scoped. Returns the effective role:
   * - members get their org role;
   * - super_admin acts as owner in every organization;
   * - developer gets at least viewer in every organization.
   * 404 if none applies (so other tenants' ids aren't confirmed), 403 if the role is too low.
   */
  async requireRole(
    orgId: string,
    userId: string,
    min: OrgRole,
  ): Promise<OrgRole> {
    const role = await this.effectiveRole(orgId, userId);
    if (!role) {
      throw new NotFoundException('Organization not found');
    }
    if (!hasRole(role, min)) {
      throw new ForbiddenException(`Requires the ${min} role or higher`);
    }
    return role;
  }

  private async effectiveRole(
    orgId: string,
    userId: string,
  ): Promise<OrgRole | null> {
    // Guard: TypeORM ignores undefined conditions, which would match any row.
    if (!orgId || !userId) {
      return null;
    }
    const [member, user, orgExists] = await Promise.all([
      this.members.findOneBy({ orgId, userId }),
      this.users.findOneBy({ id: userId }),
      this.orgs.existsBy({ id: orgId }),
    ]);
    if (!orgExists) {
      return null;
    }
    if (user?.platformRole === 'super_admin') {
      return 'owner';
    }
    if (user?.platformRole === 'developer') {
      return member && hasRole(member.role, 'viewer') ? member.role : 'viewer';
    }
    return member?.role ?? null;
  }

  // --- organizations ---------------------------------------------------------

  /** Members see their organizations; platform staff see all of them. */
  async listForUser(userId: string): Promise<OrgWithRole[]> {
    const user = await this.users.findOneByOrFail({ id: userId });
    const memberships = await this.members.find({
      where: { userId },
      relations: { org: true },
      order: { createdAt: 'ASC' },
    });
    if (!user.platformRole) {
      return memberships.map(({ org, role }) => ({ ...org!, role }));
    }
    const mine = new Map(memberships.map((m) => [m.orgId, m.role]));
    const all = await this.orgs.find({ order: { name: 'ASC' } });
    return all.map((org) => ({
      ...org,
      role:
        user.platformRole === 'super_admin'
          ? 'owner'
          : (mine.get(org.id) ?? 'viewer'),
    }));
  }

  /** The creator becomes the owner. */
  async create(userId: string, name: string): Promise<OrgWithRole> {
    return this.dataSource.transaction(async (manager) => {
      const org = await manager.save(manager.create(Organization, { name }));
      await manager.insert(OrgMember, { orgId: org.id, userId, role: 'owner' });
      return { ...org, role: 'owner' as const };
    });
  }

  async rename(
    orgId: string,
    userId: string,
    name: string,
  ): Promise<Organization> {
    await this.requireRole(orgId, userId, 'owner');
    await this.orgs.update(orgId, { name });
    return this.orgs.findOneByOrFail({ id: orgId });
  }

  // --- members ---------------------------------------------------------------

  async listMembers(orgId: string, userId: string): Promise<OrgMember[]> {
    await this.requireRole(orgId, userId, 'viewer');
    return this.members
      .createQueryBuilder('member')
      .innerJoin('member.user', 'user')
      .addSelect(['user.id', 'user.name', 'user.email'])
      .where('member.orgId = :orgId', { orgId })
      .orderBy('member.createdAt')
      .getMany();
  }

  async addMember(
    orgId: string,
    actorId: string,
    email: string,
    role: OrgRole,
  ): Promise<OrgMember> {
    await this.requireRole(orgId, actorId, 'owner');
    const user = await this.users.findOneBy({ email });
    if (!user) {
      throw new NotFoundException('No user is registered with that email');
    }
    if (await this.members.existsBy({ orgId, userId: user.id })) {
      throw new ConflictException('This user is already a member');
    }
    return this.members.save(
      this.members.create({ orgId, userId: user.id, role }),
    );
  }

  async changeRole(
    orgId: string,
    actorId: string,
    targetId: string,
    role: OrgRole,
  ): Promise<OrgMember> {
    await this.requireRole(orgId, actorId, 'owner');
    const target = await this.findMember(orgId, targetId);
    if (target.role === 'owner' && role !== 'owner') {
      await this.assertAnotherOwner(orgId);
    }
    await this.members.update({ orgId, userId: targetId }, { role });
    return { ...target, role };
  }

  /** Owners remove others; anyone can leave. The last owner can't do either. */
  async removeMember(
    orgId: string,
    actorId: string,
    targetId: string,
  ): Promise<void> {
    const target = await this.findMember(orgId, targetId);
    await this.requireRole(
      orgId,
      actorId,
      actorId === targetId ? 'viewer' : 'owner',
    );
    if (target.role === 'owner') {
      await this.assertAnotherOwner(orgId);
    }
    await this.members.delete({ orgId, userId: targetId });
  }

  private async findMember(orgId: string, userId: string): Promise<OrgMember> {
    const member = await this.members.findOneBy({ orgId, userId });
    if (!member) {
      throw new NotFoundException('Member not found');
    }
    return member;
  }

  private async assertAnotherOwner(orgId: string): Promise<void> {
    if ((await this.members.countBy({ orgId, role: 'owner' })) <= 1) {
      throw new BadRequestException(
        'The organization needs another owner first',
      );
    }
  }

  // --- locations -------------------------------------------------------------

  async listLocations(orgId: string, userId: string): Promise<Location[]> {
    await this.requireRole(orgId, userId, 'viewer');
    return this.locations.find({ where: { orgId }, order: { name: 'ASC' } });
  }

  async createLocation(
    orgId: string,
    userId: string,
    name: string,
  ): Promise<Location> {
    await this.requireRole(orgId, userId, 'owner');
    await this.assertLocationNameFree(orgId, name);
    return this.locations.save(this.locations.create({ orgId, name }));
  }

  async renameLocation(
    id: string,
    userId: string,
    name: string,
  ): Promise<Location> {
    const location = await this.findLocation(id, userId, 'owner');
    if (location.name !== name) {
      await this.assertLocationNameFree(location.orgId, name);
    }
    return this.locations.save(Object.assign(location, { name }));
  }

  /** Devices in it stay in the organization, without a location. */
  async deleteLocation(id: string, userId: string): Promise<void> {
    await this.locations.remove(await this.findLocation(id, userId, 'owner'));
  }

  /** A location the user can see with at least `min`; 404 otherwise. */
  async findLocation(
    id: string,
    userId: string,
    min: OrgRole,
  ): Promise<Location> {
    const location = await this.locations.findOneBy({ id });
    if (!location) {
      throw new NotFoundException('Location not found');
    }
    await this.requireRole(location.orgId, userId, min).catch((error) => {
      throw error instanceof NotFoundException
        ? new NotFoundException('Location not found')
        : error;
    });
    return location;
  }

  /** For devices: the location must belong to the device's organization. */
  async assertLocationInOrg(locationId: string, orgId: string): Promise<void> {
    if (!(await this.locations.existsBy({ id: locationId, orgId }))) {
      throw new BadRequestException(
        'Location does not belong to this organization',
      );
    }
  }

  private async assertLocationNameFree(orgId: string, name: string) {
    if (await this.locations.existsBy({ orgId, name })) {
      throw new ConflictException('A location with this name already exists');
    }
  }
}
