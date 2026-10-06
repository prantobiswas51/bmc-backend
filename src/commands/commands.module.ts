import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeviceTypesModule } from '../device-types/device-types.module.js';
import { DevicesModule } from '../devices/devices.module.js';
import { OrgsModule } from '../orgs/orgs.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { Command } from './command.entity.js';
import { CommandsController } from './commands.controller.js';
import { CommandsService } from './commands.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Command]),
    DevicesModule,
    OrgsModule,
    DeviceTypesModule,
    RealtimeModule,
  ],
  controllers: [CommandsController],
  providers: [CommandsService],
})
export class CommandsModule {}
