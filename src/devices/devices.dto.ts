import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class ClaimDeviceDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  hardwareId: string;

  /** The single-use code on the device label, e.g. `K7QM-2XRP`. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  claimCode: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;
}

export class UpdateDeviceDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  /** A location in the same organization, or null to clear it. */
  @IsOptional()
  @IsUUID()
  locationId?: string | null;
}

export class ListDevicesQuery {
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  type?: string;
}

/** JSON Merge Patch of desired state: `{ "speed": 60 }`; `null` removes a key. */
export class PatchStateDto {
  @IsObject()
  state: Record<string, unknown>;
}
