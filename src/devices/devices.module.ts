import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeviceTypesModule } from '../device-types/device-types.module.js';
import { OrgsModule } from '../orgs/orgs.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { Device } from './device.entity.js';
import { DevicesController } from './devices.controller.js';
import { DevicesService } from './devices.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Device]),
    OrgsModule,
    DeviceTypesModule,
    RealtimeModule,
  ],
  controllers: [DevicesController],
  providers: [DevicesService],
  exports: [DevicesService],
})
export class DevicesModule {}
