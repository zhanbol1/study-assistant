import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const tokenPath = fileURLToPath(new URL('../../.bridge-token', import.meta.url));

export async function ensureBridgeToken() {
  try {
    const token = (await fs.readFile(tokenPath, 'utf8')).trim();
    if (token.length >= 32) return token;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const token = crypto.randomBytes(32).toString('base64url');
  await fs.writeFile(tokenPath, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
  return token;
}

export async function readBridgeToken() {
  return (await fs.readFile(tokenPath, 'utf8')).trim();
}
