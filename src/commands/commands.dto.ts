import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateCommandDto {
  /** Must be one of the device type's `commands` keys. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  action: string;

  /** Validated against that action's JSON Schema. */
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}
