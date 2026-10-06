import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MqttAuthService } from './mqtt-auth.service.js';
import { MqttHooksController } from './mqtt-hooks.controller.js';
import { MqttUser } from './mqtt-user.entity.js';
import { MqttUsersService } from './mqtt-users.service.js';
import { MqttService } from './mqtt.service.js';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([MqttUser])],
  controllers: [MqttHooksController],
  providers: [MqttService, MqttAuthService, MqttUsersService],
  exports: [MqttService, MqttUsersService],
})
export class MqttModule {}
