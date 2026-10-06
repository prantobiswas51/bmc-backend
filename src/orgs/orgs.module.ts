import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/user.entity.js';
import { Location, OrgMember, Organization } from './org.entities.js';
import { OrgsController } from './orgs.controller.js';
import { OrgsService } from './orgs.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Organization, OrgMember, Location, User]),
  ],
  controllers: [OrgsController],
  providers: [OrgsService],
  exports: [OrgsService],
})
export class OrgsModule {}
