import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { brokerAdapter } from './brokers/index.js';
import type { HookResponse } from './brokers/broker-adapter.js';
import { mqttConfig } from './mqtt.config.js';
import { MqttAuthService } from './mqtt-auth.service.js';

const adapter = brokerAdapter(mqttConfig.broker);

/**
 * Auth/ACL hooks the broker calls for every connect, subscribe and publish (the broker
 * should cache results). Request/response shapes come from the configured broker adapter;
 * the decisions come from mqtt_users in Postgres.
 * Protected by MQTT_HOOK_SECRET, sent as header `x-hook-secret` or `?secret=`.
 */
@ApiExcludeController()
@Controller('mqtt')
export class MqttHooksController {
  constructor(private readonly auth: MqttAuthService) {}

  @Post('auth')
  @HttpCode(200)
  async authenticate(
    @Headers('x-hook-secret') header: string | undefined,
    @Query('secret') query: string | undefined,
    @Body() body: Record<string, unknown>,
    @Res() res: Response,
  ) {
    if (!this.trusted(header ?? query)) return this.send(res, adapter.deny());
    const result = await this.auth.authenticate(adapter.parseAuth(body));
    return this.send(
      res,
      result.ok ? adapter.allow(result.superuser) : adapter.deny(),
    );
  }

  @Post('superuser')
  @HttpCode(200)
  async superuser(
    @Headers('x-hook-secret') header: string | undefined,
    @Query('secret') query: string | undefined,
    @Body() body: Record<string, unknown>,
    @Res() res: Response,
  ) {
    if (!this.trusted(header ?? query)) return this.send(res, adapter.deny());
    const { username } = adapter.parseSuperuser(body);
    return this.send(
      res,
      (await this.auth.isSuperuser(username))
        ? adapter.allow(true)
        : adapter.deny(),
    );
  }

  @Post('acl')
  @HttpCode(200)
  async acl(
    @Headers('x-hook-secret') header: string | undefined,
    @Query('secret') query: string | undefined,
    @Body() body: Record<string, unknown>,
    @Res() res: Response,
  ) {
    const request = adapter.parseAcl(body);
    if (!this.trusted(header ?? query) || !request)
      return this.send(res, adapter.deny());
    return this.send(
      res,
      (await this.auth.checkAcl(request)) ? adapter.allow() : adapter.deny(),
    );
  }

  private trusted(given = ''): boolean {
    const expected = mqttConfig.hookSecret;
    return (
      !!expected &&
      given.length === expected.length &&
      timingSafeEqual(Buffer.from(given), Buffer.from(expected))
    );
  }

  private send(res: Response, { status, body }: HookResponse) {
    res.status(status).json(body);
  }
}
