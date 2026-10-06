import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import type { AclRule } from './mqtt-user.entity.js';

/** Valid MQTT filter: `#` only as the last level, `+` only as a whole level, no empty topic. */
export const isTopicFilter = (topic: string) =>
  topic.length > 0 &&
  topic
    .split('/')
    .every(
      (level, i, levels) =>
        (level === '#' && i === levels.length - 1) ||
        level === '+' ||
        !/[+#]/.test(level),
    );

export class AclRuleDto implements AclRule {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(255)
  topic: string;

  @IsIn(['read', 'write', 'readwrite'])
  access: AclRule['access'];
}

export class CreateMqttUserDto {
  /** Same character rules as hardware ids, so it is safe as a %u topic segment. */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Matches(/^[A-Za-z0-9_-]{3,64}$/, {
    message: 'username must be 3-64 characters of A-Z a-z 0-9 _ -',
  })
  username: string;

  @IsOptional()
  @IsBoolean()
  superuser?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AclRuleDto)
  acl?: AclRuleDto[];
}

export class UpdateMqttUserDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  superuser?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AclRuleDto)
  acl?: AclRuleDto[];
}

export class MqttUsersQuery {
  @IsOptional()
  @IsIn(['device', 'client'])
  kind?: 'device' | 'client';

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
