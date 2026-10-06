import { type BrokerAdapter, str } from './broker-adapter.js';

/**
 * EMQX 5 HTTP authenticator + HTTP authorizer. Configure the request bodies as
 * {"username": "${username}", "password": "${password}", "clientid": "${clientid}"} and
 * {"username": "${username}", "clientid": "${clientid}", "topic": "${topic}", "action": "${action}"}.
 * EMQX reads `result` from a 200 response.
 */
export const emqxAdapter: BrokerAdapter = {
  name: 'emqx',
  integration: 'EMQX (HTTP authentication + authorization)',
  parseAuth: (body) => ({
    username: str(body.username),
    password: str(body.password),
    clientId: str(body.clientid),
  }),
  parseAcl: (body) => {
    const action = str(body.action);
    if (action !== 'publish' && action !== 'subscribe') return null;
    return {
      username: str(body.username),
      clientId: str(body.clientid),
      topic: str(body.topic),
      access: action === 'publish' ? 'write' : 'subscribe',
    };
  },
  parseSuperuser: (body) => ({ username: str(body.username) }),
  allow: (superuser = false) => ({
    status: 200,
    body: { result: 'allow', is_superuser: superuser },
  }),
  deny: () => ({ status: 200, body: { result: 'deny' } }),
};
