const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** RFC 7396 JSON Merge Patch: objects merge recursively, `null` deletes a key. */
export function mergePatch(target: unknown, patch: unknown): unknown {
  if (!isObject(patch)) {
    return patch;
  }
  const result: Record<string, unknown> = isObject(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (key === '__proto__') {
      continue;
    }
    if (value === null) {
      delete result[key];
    } else {
      result[key] = mergePatch(result[key], value);
    }
  }
  return result;
}

/** Parses an MQTT payload as a JSON object; anything else is undefined. */
export function parseJsonObject(
  payload: Buffer,
): Record<string, unknown> | undefined {
  if (payload.length > 16_384) {
    return undefined;
  }
  try {
    const value: unknown = JSON.parse(payload.toString());
    return isObject(value) ? value : undefined;
  } catch {
    return undefined;
  }
}
