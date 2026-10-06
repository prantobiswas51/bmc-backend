import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Authenticated, UserId } from '../auth/auth.decorators.js';
import { Location, OrgMember, Organization } from './org.entities.js';
import { AddMemberDto, NameDto, RoleDto } from './orgs.dto.js';
import { OrgsService, OrgWithRole } from './orgs.service.js';

const OrgId = () => Param('orgId', ParseUUIDPipe);

@ApiTags('orgs')
@Authenticated()
@Controller()
export class OrgsController {
  constructor(private readonly orgs: OrgsService) {}

  @Get('orgs')
  list(@UserId() userId: string): Promise<OrgWithRole[]> {
    return this.orgs.listForUser(userId);
  }

  @Post('orgs')
  create(@UserId() userId: string, @Body() dto: NameDto): Promise<OrgWithRole> {
    return this.orgs.create(userId, dto.name);
  }

  @Patch('orgs/:orgId')
  rename(
    @UserId() userId: string,
    @OrgId() orgId: string,
    @Body() dto: NameDto,
  ): Promise<Organization> {
    return this.orgs.rename(orgId, userId, dto.name);
  }

  // --- members ---------------------------------------------------------------

  @Get('orgs/:orgId/members')
  members(
    @UserId() userId: string,
    @OrgId() orgId: string,
  ): Promise<OrgMember[]> {
    return this.orgs.listMembers(orgId, userId);
  }

  /** Owner: add an existing user by email with a role (owner, member, viewer). */
  @Post('orgs/:orgId/members')
  addMember(
    @UserId() userId: string,
    @OrgId() orgId: string,
    @Body() dto: AddMemberDto,
  ): Promise<OrgMember> {
    return this.orgs.addMember(orgId, userId, dto.email, dto.role);
  }

  @Patch('orgs/:orgId/members/:userId')
  changeRole(
    @UserId() actorId: string,
    @OrgId() orgId: string,
    @Param('userId', ParseUUIDPipe) targetId: string,
    @Body() dto: RoleDto,
  ): Promise<OrgMember> {
    return this.orgs.changeRole(orgId, actorId, targetId, dto.role);
  }

  /** Remove a member, or leave the organization by passing your own id. */
  @Delete('orgs/:orgId/members/:userId')
  @HttpCode(204)
  removeMember(
    @UserId() actorId: string,
    @OrgId() orgId: string,
    @Param('userId', ParseUUIDPipe) targetId: string,
  ): Promise<void> {
    return this.orgs.removeMember(orgId, actorId, targetId);
  }

  // --- locations -------------------------------------------------------------

  @Get('orgs/:orgId/locations')
  locations(
    @UserId() userId: string,
    @OrgId() orgId: string,
  ): Promise<Location[]> {
    return this.orgs.listLocations(orgId, userId);
  }

  @Post('orgs/:orgId/locations')
  createLocation(
    @UserId() userId: string,
    @OrgId() orgId: string,
    @Body() dto: NameDto,
  ): Promise<Location> {
    return this.orgs.createLocation(orgId, userId, dto.name);
  }

  @Patch('locations/:id')
  renameLocation(
    @UserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: NameDto,
  ): Promise<Location> {
    return this.orgs.renameLocation(id, userId, dto.name);
  }

  @Delete('locations/:id')
  @HttpCode(204)
  deleteLocation(
    @UserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.orgs.deleteLocation(id, userId);
  }
}
