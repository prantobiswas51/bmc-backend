import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { timingSafeEqual } from 'node:crypto';
import { Repository } from 'typeorm';
import { verifySecret } from '../common/secrets.js';
import type {
  AclRequest,
  AuthRequest,
  MqttAccess,
} from './brokers/broker-adapter.js';
import { mqttConfig } from './mqtt.config.js';
import { type AclRule, MqttUser } from './mqtt-user.entity.js';
import { topicMatches } from './topic-match.js';

/** What every device may do, on its own topics only (%u = its hardware id). */
export const DEVICE_ACL: AclRule[] = [
  { topic: `${mqttConfig.topicPrefix}/%u/state/desired`, access: 'read' },
  { topic: `${mqttConfig.topicPrefix}/%u/cmd`, access: 'read' },
  { topic: `${mqttConfig.topicPrefix}/%u/state/reported`, access: 'write' },
  { topic: `${mqttConfig.topicPrefix}/%u/cmd/ack`, access: 'write' },
  { topic: `${mqttConfig.topicPrefix}/%u/telemetry`, access: 'write' },
  { topic: `${mqttConfig.topicPrefix}/%u/status`, access: 'write' },
];

const sameSecret = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Values substituted into a rule must not add levels or wildcards. */
const safeSegment = (value: string) => value !== '' && !/[+#/]/.test(value);

function expand(
  rule: AclRule,
  username: string,
  clientId: string,
): string | null {
  if (rule.topic.includes('%u') && !safeSegment(username)) return null;
  if (rule.topic.includes('%c') && !safeSegment(clientId)) return null;
  return rule.topic.replaceAll('%u', username).replaceAll('%c', clientId);
}

const grants = (rule: AclRule['access'], access: 'read' | 'write') =>
  rule === 'readwrite' || rule === access;

export function aclAllows(rules: AclRule[], request: AclRequest): boolean {
  const allows = (access: 'read' | 'write') =>
    rules.some((rule) => {
      const pattern = expand(rule, request.username, request.clientId);
      return (
        pattern !== null &&
        grants(rule.access, access) &&
        topicMatches(pattern, request.topic)
      );
    });
  const access: MqttAccess = request.access;
  if (access === 'readwrite') return allows('read') && allows('write');
  return allows(access === 'subscribe' ? 'read' : access);
}

/** The broker-neutral decisions behind the auth hooks. */
@Injectable()
export class MqttAuthService {
  constructor(
    @InjectRepository(MqttUser) private readonly users: Repository<MqttUser>,
  ) {}

  /** The backend's own account, from env. */
  isServiceAccount(username: string): boolean {
    return !!mqttConfig.username && username === mqttConfig.username;
  }

  async authenticate({
    username,
    password,
  }: AuthRequest): Promise<{ ok: boolean; superuser: boolean }> {
    if (this.isServiceAccount(username)) {
      return { ok: sameSecret(password, mqttConfig.password), superuser: true };
    }
    const user = username
      ? await this.users.findOne({
          where: { username },
          select: {
            id: true,
            passwordHash: true,
            enabled: true,
            superuser: true,
          },
        })
      : null;
    if (!user?.enabled || !(await verifySecret(password, user.passwordHash))) {
      return { ok: false, superuser: false };
    }
    await this.users.update(user.id, { lastAuthAt: new Date() });
    return { ok: true, superuser: user.superuser };
  }

  async isSuperuser(username: string): Promise<boolean> {
    if (this.isServiceAccount(username)) return true;
    const user = username ? await this.users.findOneBy({ username }) : null;
    return !!user?.enabled && user.superuser;
  }

  async checkAcl(request: AclRequest): Promise<boolean> {
    if (this.isServiceAccount(request.username)) return true;
    const user = request.username
      ? await this.users.findOneBy({ username: request.username })
      : null;
    if (!user?.enabled) return false;
    if (user.superuser) return true;
    return aclAllows(user.kind === 'device' ? DEVICE_ACL : user.acl, request);
  }
}
