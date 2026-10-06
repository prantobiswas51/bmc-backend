/**
 * Grant or remove a platform role (use it to create the first super admin):
 *   npm run user:role -- you@example.com super_admin
 *   npm run user:role -- dev@example.com developer
 *   npm run user:role -- someone@example.com none
 */
import dataSource from '../data-source.js';
import { PLATFORM_ROLES, User } from '../users/user.entity.js';

const [email = '', role = ''] = process.argv.slice(2);
const platformRole = role === 'none' ? null : role;

await dataSource.initialize();
try {
  if (
    platformRole !== null &&
    !PLATFORM_ROLES.includes(platformRole as never)
  ) {
    throw new Error(`Role must be one of: ${PLATFORM_ROLES.join(', ')}, none`);
  }
  const { affected } = await dataSource
    .getRepository(User)
    .update({ email }, { platformRole: platformRole as User['platformRole'] });
  if (!affected) {
    throw new Error(`No user with email ${email}`);
  }
  console.log(`${email} → ${platformRole ?? 'no platform role'}`);
} catch (error) {
  console.error(
    `${(error as Error).message}\nUsage: npm run user:role -- <email> <super_admin|developer|none>`,
  );
  process.exitCode = 1;
} finally {
  await dataSource.destroy();
}
