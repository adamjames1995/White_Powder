import webpush from 'web-push';
import { createHash } from 'node:crypto';

let ready = false;
export function push() {
  if (!ready) {
    const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) throw new Error('VAPID keys not configured');
    webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:admin@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    ready = true;
  }
  return webpush;
}

export const subId = (sub) => createHash('sha256').update(sub.endpoint).digest('hex').slice(0, 16);

export function validSub(sub) {
  return sub && typeof sub.endpoint === 'string' && sub.endpoint.startsWith('https://') && sub.keys?.p256dh && sub.keys?.auth;
}
