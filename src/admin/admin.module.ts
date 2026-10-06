import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformRoleGuard } from '../auth/platform.guard.js';
import { Device } from '../devices/device.entity.js';
import { DevicesModule } from '../devices/devices.module.js';
import { Organization } from '../orgs/org.entities.js';
import { User } from '../users/user.entity.js';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Device, Organization]),
    DevicesModule,
  ],
  controllers: [AdminController],
  providers: [AdminService, PlatformRoleGuard],
})
export class AdminModule {}
