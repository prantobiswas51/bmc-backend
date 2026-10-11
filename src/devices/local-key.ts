import { createHmac } from 'node:crypto';
import { env } from '../data-source.js';

/**
 * The key a claimed device expects on its local HTTP API (hotspot / LAN), so only people
 * who belong to the owning organization can control it without the internet.
 *
 * Derived, never stored: HMAC of the hardware id and the claim time. Releasing and
 * re-claiming a device changes `claimedAt`, so the previous owner's key stops working.
 * The device gets it over MQTT (retained `claim` message); the app asks the API for it.
 */
export function localKey(hardwareId: string, claimedAt: Date): string {
  return createHmac('sha256', env('JWT_SECRET'))
    .update(`bm-local-key:${hardwareId}:${claimedAt.getTime()}`)
    .digest('base64url');
}
