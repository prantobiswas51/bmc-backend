import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Authenticated, UserId } from '../auth/auth.decorators.js';
import { RateLimit } from '../common/rate-limit.js';
import { Command } from './command.entity.js';
import { CreateCommandDto } from './commands.dto.js';
import { CommandsService } from './commands.service.js';

@ApiTags('commands')
@Authenticated()
@Controller()
export class CommandsController {
  constructor(private readonly commands: CommandsService) {}

  /** Member+: one-shot action (snapshot, reboot, play_effect…). Poll or listen for the ack. */
  @Post('devices/:id/commands')
  @HttpCode(202)
  @RateLimit(20, 60_000)
  create(
    @UserId() userId: string,
    @Param('id', ParseUUIDPipe) deviceId: string,
    @Body() dto: CreateCommandDto,
  ): Promise<Command> {
    return this.commands.create(deviceId, userId, dto);
  }

  /** The 50 most recent commands. */
  @Get('devices/:id/commands')
  list(
    @UserId() userId: string,
    @Param('id', ParseUUIDPipe) deviceId: string,
  ): Promise<Command[]> {
    return this.commands.list(deviceId, userId);
  }

  /**
   * Commands per day — dashboard chart. Either a calendar `month` (`YYYY-MM`)
   * or the last `days` (1-90, default 7).
   */
  @Get('orgs/:orgId/activity')
  activity(
    @UserId() userId: string,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query('days', new ParseIntPipe({ optional: true })) days = 7,
    @Query('month') month?: string,
  ) {
    if (month !== undefined) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
        throw new BadRequestException('month must be YYYY-MM');
      }
      return this.commands.activity(orgId, userId, { month });
    }
    return this.commands.activity(orgId, userId, {
      days: Math.min(Math.max(days, 1), 90),
    });
  }

  @Get('commands/:id')
  get(
    @UserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Command> {
    return this.commands.get(id, userId);
  }
}
