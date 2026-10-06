import { applyDecorators, Injectable, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

/** Limits per authenticated user (falls back to client IP before login). */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: {
    user?: { id: string };
    ip?: string;
  }): Promise<string> {
    return Promise.resolve(req.user?.id ?? req.ip ?? 'unknown');
  }
}

/** `limit` requests per `ttlMs`. Put it after @Authenticated() so the user is known. */
export const RateLimit = (limit: number, ttlMs: number) =>
  applyDecorators(
    Throttle({ default: { limit, ttl: ttlMs } }),
    UseGuards(UserThrottlerGuard),
  );
