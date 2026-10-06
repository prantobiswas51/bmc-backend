import './env.js';
import { DataSource, DataSourceOptions } from 'typeorm';
import { RefreshToken } from './auth/refresh-token.entity.js';
import { Command } from './commands/command.entity.js';
import { DeviceType } from './device-types/device-type.entity.js';
import { Device } from './devices/device.entity.js';
import { MqttUser } from './mqtt/mqtt-user.entity.js';
import { Location, OrgMember, Organization } from './orgs/org.entities.js';
import { Telemetry } from './telemetry/telemetry.entity.js';
import { User } from './users/user.entity.js';

export function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

// .ts when running from source (tests), .js from dist. Never the .d.ts files.
const ext = import.meta.url.endsWith('.ts') ? 'ts' : 'js';

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  url: env('DATABASE_URL'),
  uuidExtension: 'pgcrypto', // gen_random_uuid() is built into Postgres 13+
  entities: [
    User,
    RefreshToken,
    Organization,
    OrgMember,
    Location,
    DeviceType,
    Device,
    Command,
    Telemetry,
    MqttUser,
  ],
  migrations: [`${import.meta.dirname}/migrations/*.${ext}`],
  migrationsRun: true,
};

export default new DataSource(dataSourceOptions);
