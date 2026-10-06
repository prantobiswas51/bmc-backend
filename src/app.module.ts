import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminModule } from './admin/admin.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CommandsModule } from './commands/commands.module.js';
import { dataSourceOptions } from './data-source.js';
import { DeviceTypesModule } from './device-types/device-types.module.js';
import { DevicesModule } from './devices/devices.module.js';
import { MqttModule } from './mqtt/mqtt.module.js';
import { OrgsModule } from './orgs/orgs.module.js';
import { TelemetryModule } from './telemetry/telemetry.module.js';

@Module({
  imports: [
    TypeOrmModule.forRoot(dataSourceOptions),
    // Limits are set per route with @RateLimit().
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    MqttModule,
    AuthModule,
    OrgsModule,
    DeviceTypesModule,
    DevicesModule,
    CommandsModule,
    TelemetryModule,
    AdminModule,
  ],
})
export class AppModule {}
