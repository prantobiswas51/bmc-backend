import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';
import { ORG_ROLES, type OrgRole } from './org.entities.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Used for organizations and locations. */
export class NameDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;
}

export class RoleDto {
  @IsIn(ORG_ROLES)
  role: OrgRole;
}

export class AddMemberDto extends RoleDto {
  @Transform(trim)
  @IsEmail()
  @MaxLength(255)
  email: string;
}
