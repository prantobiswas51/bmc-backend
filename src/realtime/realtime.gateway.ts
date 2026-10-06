import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { isUUID } from 'class-validator';
import type { Namespace, Socket } from 'socket.io';
import { OrgsService } from '../orgs/orgs.service.js';

type AuthedSocket = Socket & { data: { userId?: string } };

/**
 * Socket.IO namespace `/realtime`. Connect with `auth: { token: <access token> }`,
 * then emit `subscribe` with `{ orgId }` to receive that organization's events:
 * device.desired, device.reported, device.online, device.telemetry, device.removed,
 * command.updated.
 */
@WebSocketGateway({
  namespace: 'realtime',
  cors: { origin: process.env.CORS_ORIGINS?.split(',') ?? false },
})
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer()
  private readonly server?: Namespace;

  constructor(
    private readonly jwt: JwtService,
    private readonly orgs: OrgsService,
  ) {}

  async handleConnection(socket: AuthedSocket): Promise<void> {
    try {
      const token = String(socket.handshake.auth?.token ?? '');
      const { sub } = await this.jwt.verifyAsync<{ sub: string }>(token);
      socket.data.userId = sub;
    } catch {
      socket.disconnect(true);
    }
  }

  @SubscribeMessage('subscribe')
  async subscribe(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: { orgId?: unknown },
  ): Promise<{ ok: boolean; error?: string }> {
    const { userId } = socket.data;
    const orgId = body?.orgId;
    // Never query with an undefined userId: TypeORM would drop the condition.
    if (!userId || typeof orgId !== 'string' || !isUUID(orgId)) {
      return { ok: false, error: 'Invalid request' };
    }
    try {
      await this.orgs.requireRole(orgId, userId, 'viewer');
    } catch {
      return { ok: false, error: 'Organization not found' };
    }
    await socket.join(`org.${orgId}`);
    return { ok: true };
  }

  @SubscribeMessage('unsubscribe')
  async unsubscribe(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: { orgId?: unknown },
  ): Promise<{ ok: boolean }> {
    await socket.leave(`org.${String(body?.orgId)}`);
    return { ok: true };
  }

  emit(orgId: string | null, event: string, data: object): void {
    if (orgId) {
      this.server?.to(`org.${orgId}`).emit(event, data);
    }
  }
}
