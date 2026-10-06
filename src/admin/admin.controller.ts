import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Platform } from '../auth/platform.guard.js';
import type { ProvisionedDevice } from '../devices/provision.js';
import {
  CreateMqttUserDto,
  MqttUsersQuery,
  UpdateMqttUserDto,
} from '../mqtt/mqtt-users.dto.js';
import { MqttUsersService, MqttUserView } from '../mqtt/mqtt-users.service.js';
import type { User } from '../users/user.entity.js';
import {
  AdminDevicesQuery,
  ProvisionDeviceDto,
  SearchQuery,
  SetPlatformRoleDto,
} from './admin.dto.js';
import { AdminDevice, AdminService, AdminUser } from './admin.service.js';

/** BongoMaker staff only. */
@ApiTags('admin')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly mqttUsers: MqttUsersService,
  ) {}

  @Get('stats')
  @Platform('super_admin', 'developer')
  stats() {
    return this.admin.stats();
  }

  @Get('users')
  @Platform('super_admin')
  users(@Query() query: SearchQuery): Promise<AdminUser[]> {
    return this.admin.listUsers(query.search);
  }

  @Patch('users/:id')
  @Platform('super_admin')
  setRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetPlatformRoleDto,
  ): Promise<User> {
    return this.admin.setPlatformRole(id, dto.platformRole);
  }

  @Get('organizations')
  @Platform('super_admin', 'developer')
  organizations() {
    return this.admin.listOrganizations();
  }

  /** Every device, claimed or not, across all organizations. */
  @Get('devices')
  @Platform('super_admin', 'developer')
  devices(@Query() query: AdminDevicesQuery): Promise<AdminDevice[]> {
    return this.admin.listDevices(query);
  }

  /** Factory provisioning. The response holds the device secret and claim code; they are not shown again. */
  @Post('devices')
  @Platform('super_admin', 'developer')
  provision(@Body() dto: ProvisionDeviceDto): Promise<ProvisionedDevice> {
    return this.admin.provision(dto.typeKey, dto.hardwareId);
  }

  // --- MQTT -------------------------------------------------------------------

  /** Broker, connection state and the device ACL template. */
  @Get('mqtt')
  @Platform('super_admin', 'developer')
  mqttBroker() {
    return this.mqttUsers.broker();
  }

  @Get('mqtt-users')
  @Platform('super_admin', 'developer')
  listMqttUsers(@Query() query: MqttUsersQuery): Promise<MqttUserView[]> {
    return this.mqttUsers.list(query);
  }

  /** Client account (dashboards, integrations, test tools). The password is shown once. */
  @Post('mqtt-users')
  @Platform('super_admin')
  createMqttUser(@Body() dto: CreateMqttUserDto) {
    return this.mqttUsers.create(dto);
  }

  @Patch('mqtt-users/:id')
  @Platform('super_admin')
  updateMqttUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMqttUserDto,
  ): Promise<MqttUserView> {
    return this.mqttUsers.update(id, dto);
  }

  /** New password, shown once. For a device this replaces its device secret. */
  @Post('mqtt-users/:id/password')
  @Platform('super_admin')
  resetMqttPassword(@Param('id', ParseUUIDPipe) id: string) {
    return this.mqttUsers.resetPassword(id);
  }

  @Delete('mqtt-users/:id')
  @HttpCode(204)
  @Platform('super_admin')
  deleteMqttUser(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.mqttUsers.remove(id);
  }
}
