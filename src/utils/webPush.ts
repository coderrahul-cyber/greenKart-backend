// src/utils/webPush.ts
// Handles web push notifications to the admin browser.
//
// How it works:
//   1. Admin dashboard subscribes (browser generates endpoint + keys)
//   2. Frontend POSTs that subscription object to POST /admin/push/subscribe
//   3. We store it here in memory (survives across requests, lost on restart)
//   4. When an order is placed, notifyAdminPush() sends to all stored subscriptions
//   5. Browser's push service (FCM/Mozilla) wakes the service worker even if Chrome is closed
//   6. Service worker shows a native OS notification
//
// Subscription storage:
//   Using a Map in memory — same trade-off as storeState.ts (resets on restart).
//   On restart the admin just re-subscribes on their next login.
//   If you want persistence, swap the Map for a MongoDB collection.

import webpush, { type PushSubscription } from "web-push";
import { env } from "../config/env";

// ─── Configure VAPID ──────────────────────────────────────────────────────────
// Called once at server boot. VAPID = Voluntary Application Server Identification
// The push service (Google, Mozilla) uses these to verify messages are from you.
export const initWebPush = (): void => {
  webpush.setVapidDetails(
    env.vapid.subject,
    env.vapid.publicKey,
    env.vapid.privateKey,
  );
  console.log("🔔  Web push (VAPID) initialised");
};

// ─── Subscription store ───────────────────────────────────────────────────────
// Key = endpoint URL (unique per browser/device — safe to use as ID)
const subscriptions = new Map<string, PushSubscription>();

export const saveSubscription = (sub: PushSubscription): void => {
  subscriptions.set(sub.endpoint, sub);
  console.log(`[push] Subscription saved — total: ${subscriptions.size}`);
};

export const removeSubscription = (endpoint: string): void => {
  subscriptions.delete(endpoint);
};

export const getSubscriptionCount = (): number => subscriptions.size;

// ─── Push payload types ───────────────────────────────────────────────────────
export interface PushPayload {
  title:   string;
  body:    string;
  icon?:   string;   // path to notification icon — e.g. "/icons/logo-192.png"
  badge?:  string;   // small monochrome icon shown in status bar
  url?:    string;   // where to navigate when admin clicks the notification
  tag?:    string;   // replaces previous notification with same tag (dedup)
  data?:   Record<string, unknown>;
}

// ─── Send push to all subscribed admin devices ────────────────────────────────
// Called from order controller after placeOrder succeeds.
// Sends to ALL stored subscriptions — admin may be subscribed on multiple devices.
export const notifyAdminPush = async (payload: PushPayload): Promise<void> => {
  if (subscriptions.size === 0) return; // no subscriptions — nothing to do

  const message = JSON.stringify(payload);
  const failed:  string[] = [];

  const sends = Array.from(subscriptions.entries()).map(async ([endpoint, sub]) => {
    try {
      await webpush.sendNotification(sub, message);
    } catch (err: unknown) {
      // 404 or 410 = subscription expired / user unsubscribed — remove it
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        failed.push(endpoint);
        console.log(`[push] Removed expired subscription: ${endpoint.slice(-20)}`);
      } else {
        console.error(`[push] Failed to send to ${endpoint.slice(-20)}:`, (err as Error).message);
      }
    }
  });

  await Promise.allSettled(sends);

  // Clean up expired subscriptions
  failed.forEach(removeSubscription);
};