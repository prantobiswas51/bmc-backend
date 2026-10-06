import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { type PlatformRole, User } from '../users/user.entity.js';
import { Authenticated } from './auth.decorators.js';

const ROLES = 'platformRoles';

/** Read from the DB on each request, so revoking a role takes effect immediately. */
@Injectable()
export class PlatformRoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const allowed = this.reflector.getAllAndOverride<PlatformRole[]>(ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    const userId = context
      .switchToHttp()
      .getRequest<{ user?: { id: string } }>().user?.id;
    const user = userId ? await this.users.findOneBy({ id: userId }) : null;
    if (!user?.platformRole || !allowed.includes(user.platformRole)) {
      throw new ForbiddenException('Requires a BongoMaker staff role');
    }
    return true;
  }
}

/** Authenticated + one of the given platform roles. */
export const Platform = (...roles: PlatformRole[]) =>
  applyDecorators(
    Authenticated(),
    SetMetadata(ROLES, roles),
    UseGuards(PlatformRoleGuard),
  );
