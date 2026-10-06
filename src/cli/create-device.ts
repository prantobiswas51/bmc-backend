/**
 * Provision a device at the factory (same as POST /api/v1/admin/devices):
 *   npm run device:create -- fanled BM_FANLED_0001
 * Prints the device secret (firmware) and claim code (label) once; only hashes are stored.
 */
import dataSource from '../data-source.js';
import { provisionDevice } from '../devices/provision.js';

const [typeKey = '', hardwareId = ''] = process.argv.slice(2);

await dataSource.initialize();
try {
  const device = await provisionDevice(dataSource, typeKey, hardwareId);
  console.log(
    `Created ${device.hardwareId} (${device.typeKey})\n` +
      `MQTT username: ${device.hardwareId}\n` +
      `Device secret: ${device.deviceSecret}\n` +
      `Claim code:    ${device.claimCode}`,
  );
} catch (error) {
  console.error(
    `${(error as Error).message}\nUsage: npm run device:create -- <typeKey> <hardwareId>`,
  );
  process.exitCode = 1;
} finally {
  await dataSource.destroy();
}
