import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import {
  hashSecret,
  randomToken,
  sha256,
  verifySecret,
} from '../common/secrets.js';
import { User } from '../users/user.entity.js';
import { LoginDto, RegisterDto } from './auth.dto.js';
import { RefreshToken } from './refresh-token.entity.js';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: Pick<User, 'id' | 'name' | 'email'>;
}

const ROTATION_GRACE_MS = 10_000;
const REFRESH_TTL_MS =
  Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30) * 24 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokens: Repository<RefreshToken>,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthTokens> {
    if (await this.users.existsBy({ email: dto.email })) {
      throw new ConflictException('Email is already registered');
    }
    const user = await this.users.save(
      this.users.create({
        name: dto.name,
        email: dto.email,
        passwordHash: await hashSecret(dto.password),
      }),
    );
    return this.issueTokens(user);
  }

  async login(dto: LoginDto): Promise<AuthTokens> {
    const user = await this.users.findOne({
      where: { email: dto.email },
      select: { id: true, name: true, email: true, passwordHash: true },
    });
    if (!user || !(await verifySecret(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return this.issueTokens(user);
  }

  /**
   * Rotates the refresh token. Reusing an old one (after a 10 s grace window for
   * concurrent requests) revokes every session of that user.
   */
  async refresh(token: string): Promise<AuthTokens> {
    const stored = await this.refreshTokens.findOne({
      where: { tokenHash: sha256(token) },
      relations: { user: true },
    });
    if (!stored?.user || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (stored.revokedAt) {
      // Parallel requests (e.g. two tabs, prefetches) may refresh the same token at
      // once; tolerate that for a few seconds instead of logging the user out.
      if (
        stored.rotatedAt &&
        Date.now() - stored.rotatedAt.getTime() < ROTATION_GRACE_MS
      ) {
        return this.issueTokens(stored.user);
      }
      await this.revokeAll(stored.userId);
      throw new UnauthorizedException('Refresh token was already used');
    }
    const now = new Date();
    await this.refreshTokens.update(
      { id: stored.id, revokedAt: IsNull() },
      { revokedAt: now, rotatedAt: now },
    );
    return this.issueTokens(stored.user);
  }

  async logout(token: string): Promise<void> {
    await this.refreshTokens.update(
      { tokenHash: sha256(token), revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  async me(userId: string): Promise<User> {
    const user = await this.users.findOneBy({ id: userId });
    if (!user) {
      throw new NotFoundException();
    }
    return user;
  }

  private async revokeAll(userId: string): Promise<void> {
    await this.refreshTokens.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
    // No grace for anything in a revoked family.
    await this.refreshTokens.update({ userId }, { rotatedAt: null });
  }

  private async issueTokens(user: User): Promise<AuthTokens> {
    const refreshToken = randomToken();
    await this.refreshTokens.insert({
      userId: user.id,
      tokenHash: sha256(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    });
    return {
      accessToken: await this.jwt.signAsync({ sub: user.id }),
      refreshToken,
      user: { id: user.id, name: user.name, email: user.email },
    };
  }
}
