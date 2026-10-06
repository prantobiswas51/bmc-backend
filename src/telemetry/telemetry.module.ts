import {
  Controller,
  Get,
  Module,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Authenticated, UserId } from '../auth/auth.decorators.js';
import { DevicesModule } from '../devices/devices.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { TelemetryQuery } from './telemetry.dto.js';
import { TelemetryPoint, TelemetryService } from './telemetry.service.js';

@ApiTags('telemetry')
@Authenticated()
@Controller()
export class TelemetryController {
  constructor(private readonly telemetry: TelemetryService) {}

  @Get('devices/:id/telemetry')
  query(
    @UserId() userId: string,
    @Param('id', ParseUUIDPipe) deviceId: string,
    @Query() query: TelemetryQuery,
  ): Promise<TelemetryPoint[]> {
    return this.telemetry.query(deviceId, userId, query);
  }
}

@Module({
  imports: [DevicesModule, RealtimeModule],
  controllers: [TelemetryController],
  providers: [TelemetryService],
})
export class TelemetryModule {}
