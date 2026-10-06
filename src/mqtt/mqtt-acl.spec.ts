import { aclAllows } from './mqtt-auth.service.js';
import { emqxAdapter } from './brokers/emqx.adapter.js';
import { mosquittoAdapter } from './brokers/mosquitto.adapter.js';
import { topicMatches } from './topic-match.js';
import { isTopicFilter } from './mqtt-users.dto.js';

describe('topicMatches', () => {
  it.each([
    ['devices/+/telemetry', 'devices/a/telemetry', true],
    ['devices/+/telemetry', 'devices/a/b/telemetry', false],
    ['devices/#', 'devices', true],
    ['devices/#', 'devices/a/b', true],
    ['devices/a', 'devices/a/b', false],
    ['devices/+/telemetry', 'devices/+/telemetry', true], // subscribe filter within rule
    ['devices/a/telemetry', 'devices/+/telemetry', false], // filter broader than rule
    ['devices/+/telemetry', 'devices/#', false],
    ['devices/#', 'devices/+/x', true],
  ])('%s covers %s → %s', (pattern, topic, expected) => {
    expect(topicMatches(pattern, topic)).toBe(expected);
  });
});

describe('aclAllows', () => {
  const rules = [
    { topic: 'clients/%u/#', access: 'readwrite' as const },
    { topic: 'logs/%c', access: 'write' as const },
  ];
  const req = (
    topic: string,
    access: 'read' | 'write' | 'readwrite' | 'subscribe',
    username = 'bob',
    clientId = 'c1',
  ) => ({
    username,
    clientId,
    topic,
    access,
  });

  it('substitutes %u and %c', () => {
    expect(aclAllows(rules, req('clients/bob/x', 'readwrite'))).toBe(true);
    expect(aclAllows(rules, req('logs/c1', 'write'))).toBe(true);
    expect(aclAllows(rules, req('logs/c1', 'read'))).toBe(false);
  });

  it('refuses usernames or client ids that would add levels or wildcards', () => {
    expect(aclAllows(rules, req('clients/#', 'subscribe', '#'))).toBe(false);
    expect(aclAllows(rules, req('clients/a/b/x', 'write', 'a/b'))).toBe(false);
    expect(aclAllows(rules, req('logs/+', 'write', 'bob', '+'))).toBe(false);
  });
});

describe('isTopicFilter', () => {
  it.each([
    ['a/b', true],
    ['a/+/c', true],
    ['a/#', true],
    ['#', true],
    ['a/#/c', false],
    ['a/b+', false],
    ['', false],
  ])('%s → %s', (topic, ok) => expect(isTopicFilter(topic)).toBe(ok));
});

describe('broker adapters', () => {
  it('mosquitto-go-auth: acc codes and status responses', () => {
    expect(
      mosquittoAdapter.parseAcl({
        username: 'u',
        clientid: 'c',
        topic: 't',
        acc: 4,
      })?.access,
    ).toBe('subscribe');
    expect(
      mosquittoAdapter.parseAcl({ username: 'u', topic: 't', acc: '3' })
        ?.access,
    ).toBe('readwrite');
    expect(
      mosquittoAdapter.parseAcl({ username: 'u', topic: 't', acc: 7 }),
    ).toBeNull();
    expect(mosquittoAdapter.deny().status).toBe(403);
  });

  it('EMQX: actions and result bodies', () => {
    expect(
      emqxAdapter.parseAcl({ username: 'u', topic: 't', action: 'publish' })
        ?.access,
    ).toBe('write');
    expect(emqxAdapter.allow(true)).toEqual({
      status: 200,
      body: { result: 'allow', is_superuser: true },
    });
    expect(emqxAdapter.deny()).toEqual({
      status: 200,
      body: { result: 'deny' },
    });
  });
});
