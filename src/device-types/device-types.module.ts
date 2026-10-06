import { Controller, Get, Module } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Authenticated } from '../auth/auth.decorators.js';
import { DeviceType } from './device-type.entity.js';
import { DeviceTypesService } from './device-types.service.js';

@ApiTags('device-types')
@Authenticated()
@Controller('device-types')
export class DeviceTypesController {
  constructor(private readonly types: DeviceTypesService) {}

  /** Schemas the website/app use to build controls for each kind of device. */
  @Get()
  list(): Promise<DeviceType[]> {
    return this.types.list();
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([DeviceType])],
  controllers: [DeviceTypesController],
  providers: [DeviceTypesService],
  exports: [DeviceTypesService],
})
export class DeviceTypesModule {}
