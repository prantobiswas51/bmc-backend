import { Module } from '@nestjs/common';
import { OrgsModule } from '../orgs/orgs.module.js';
import { RealtimeGateway } from './realtime.gateway.js';

@Module({
  imports: [OrgsModule],
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
