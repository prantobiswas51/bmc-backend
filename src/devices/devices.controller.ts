import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { Authenticated, UserId } from '../auth/auth.decorators.js';
import { RateLimit } from '../common/rate-limit.js';
import type { DeviceState } from './device.entity.js';
import {
  ClaimDeviceDto,
  ListDevicesQuery,
  PatchStateDto,
  UpdateDeviceDto,
} from './devices.dto.js';
import { DevicesService, DeviceView } from './devices.service.js';

const Id = () => Param('id', ParseUUIDPipe);

@ApiTags('devices')
@Authenticated()
@Controller()
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get('orgs/:orgId/devices')
  list(
    @UserId() userId: string,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() query: ListDevicesQuery,
  ): Promise<DeviceView[]> {
    return this.devices.list(orgId, userId, query);
  }

  /** Owner: claim a provisioned device with its hardware id and single-use claim code. */
  @Post('orgs/:orgId/devices/claim')
  @RateLimit(10, 60_000)
  claim(
    @UserId() userId: string,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: ClaimDeviceDto,
  ): Promise<DeviceView> {
    return this.devices.claim(orgId, userId, dto);
  }

  @Get('devices/:id')
  get(@UserId() userId: string, @Id() id: string): Promise<DeviceView> {
    return this.devices.get(id, userId);
  }

  /** Owner: rename or move to another location. */
  @Patch('devices/:id')
  update(
    @UserId() userId: string,
    @Id() id: string,
    @Body() dto: UpdateDeviceDto,
  ): Promise<DeviceView> {
    return this.devices.update(id, userId, dto);
  }

  /** Owner: remove from the organization. Returns a new claim code for the next owner. */
  @Delete('devices/:id')
  release(
    @UserId() userId: string,
    @Id() id: string,
  ): Promise<{ claimCode: string }> {
    return this.devices.release(id, userId);
  }

  /**
   * Member+: merge into desired state (validated against the type's stateSchema).
   * Send `If-Match: <stateVersion>` to fail with 412 if someone changed it meanwhile.
   */
  @Patch('devices/:id/state')
  @HttpCode(202)
  @RateLimit(60, 10_000)
  @ApiHeader({ name: 'If-Match', required: false })
  patchState(
    @UserId() userId: string,
    @Id() id: string,
    @Body() dto: PatchStateDto,
    @Headers('if-match') ifMatch?: string,
  ): Promise<{ stateVersion: number; desiredState: DeviceState }> {
    return this.devices.patchState(id, userId, dto.state, ifMatch);
  }
}
