import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RateLimit } from '../common/rate-limit.js';
import { User } from '../users/user.entity.js';
import { Authenticated, UserId } from './auth.decorators.js';
import { LoginDto, RefreshDto, RegisterDto } from './auth.dto.js';
import { AuthService, AuthTokens } from './auth.service.js';

@ApiTags('auth')
@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('auth/register')
  @RateLimit(10, 60_000)
  register(@Body() dto: RegisterDto): Promise<AuthTokens> {
    return this.auth.register(dto);
  }

  @Post('auth/login')
  @HttpCode(200)
  @RateLimit(10, 60_000)
  login(@Body() dto: LoginDto): Promise<AuthTokens> {
    return this.auth.login(dto);
  }

  /** Exchange a refresh token for a new access + refresh token pair. */
  @Post('auth/refresh')
  @HttpCode(200)
  @RateLimit(30, 60_000)
  refresh(@Body() dto: RefreshDto): Promise<AuthTokens> {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('auth/logout')
  @HttpCode(204)
  logout(@Body() dto: RefreshDto): Promise<void> {
    return this.auth.logout(dto.refreshToken);
  }

  @Get('me')
  @Authenticated()
  me(@UserId() userId: string): Promise<User> {
    return this.auth.me(userId);
  }
}
