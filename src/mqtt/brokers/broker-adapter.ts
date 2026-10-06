/** What every broker's auth/ACL hook request boils down to. */
export type MqttAccess = 'read' | 'write' | 'readwrite' | 'subscribe';

export interface AuthRequest {
  username: string;
  password: string;
  clientId: string;
}

export interface AclRequest {
  username: string;
  clientId: string;
  topic: string;
  access: MqttAccess;
}

export interface HookResponse {
  status: number;
  body: unknown;
}

/**
 * Translates one broker's HTTP auth plugin format to/from ours.
 * Add a file here to support another broker; nothing else changes.
 */
export interface BrokerAdapter {
  readonly name: string;
  /** Human description for the admin page. */
  readonly integration: string;
  parseAuth(body: Record<string, unknown>): AuthRequest;
  parseAcl(body: Record<string, unknown>): AclRequest | null;
  parseSuperuser(body: Record<string, unknown>): { username: string };
  allow(superuser?: boolean): HookResponse;
  deny(): HookResponse;
}

export const str = (value: unknown) => (typeof value === 'string' ? value : '');
