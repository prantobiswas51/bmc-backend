import { IsIn, IsISO8601, IsOptional } from 'class-validator';

export const BUCKETS = {
  '1m': '1 minute',
  '5m': '5 minutes',
  '15m': '15 minutes',
  '1h': '1 hour',
  '1d': '1 day',
} as const;

export class TelemetryQuery {
  /** Default: 24 hours before `to`. */
  @IsOptional()
  @IsISO8601()
  from?: string;

  /** Default: now. */
  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @IsIn(Object.keys(BUCKETS))
  bucket?: keyof typeof BUCKETS;
}
