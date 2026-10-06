import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { PLATFORM_ROLES, type PlatformRole } from '../users/user.entity.js';

export class SetPlatformRoleDto {
  /** super_admin, developer, or null to make them a regular customer. */
  @ValidateIf((dto: SetPlatformRoleDto) => dto.platformRole !== null)
  @IsIn(PLATFORM_ROLES)
  platformRole: PlatformRole | null;
}

export class ProvisionDeviceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  typeKey: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  hardwareId: string;
}

export class SearchQuery {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class AdminDevicesQuery extends SearchQuery {
  @IsOptional()
  @IsIn(['claimed', 'unclaimed'])
  status?: 'claimed' | 'unclaimed';

  @IsOptional()
  @IsString()
  @MaxLength(64)
  type?: string;
}
