import {
  applyDecorators,
  createParamDecorator,
  ExecutionContext,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth } from '@nestjs/swagger';

/** Requires a valid `Authorization: Bearer <access token>` header. */
export const Authenticated = () =>
  applyDecorators(UseGuards(AuthGuard('jwt')), ApiBearerAuth());

/** The authenticated user's id (set by JwtStrategy.validate). */
export const UserId = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string =>
    ctx.switchToHttp().getRequest<{ user: { id: string } }>().user.id,
);
