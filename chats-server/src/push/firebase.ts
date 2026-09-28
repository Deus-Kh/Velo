import fs from "fs";
import path from "path";
import { config } from "../config";
import { UserModel } from "../models/User";
import { log } from '../lib/logger';
import { metrics } from '../lib/metrics';

let firebaseAdmin: any = null;
let firebaseInitAttempted = false;
let firebaseAvailable = false;

function getFirebaseAdmin() {
  if (firebaseInitAttempted) {
    return firebaseAvailable ? firebaseAdmin : null;
  }

  firebaseInitAttempted = true;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    firebaseAdmin = require("firebase-admin");
  } catch (error) {
    log.warn("[push] firebase-admin is not installed; push delivery is disabled.");
    firebaseAvailable = false;
    return null;
  }

  try {
    if (!firebaseAdmin.apps.length) {
      const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

      if (serviceAccountJson) {
        firebaseAdmin.initializeApp({
          credential: firebaseAdmin.credential.cert(JSON.parse(serviceAccountJson)),
        });
      } else {
        const resolvedPath = path.resolve(process.cwd(), config.FIREBASE_SERVICE_ACCOUNT_PATH);
        if (!fs.existsSync(resolvedPath)) {
          // Never fall back to application-default credentials: on a misconfigured
          // host that would silently bind push to whatever project the machine
          // happens to be logged into. Disable push loudly instead.
          log.warn(`[push] service-account file not found at ${resolvedPath}; push delivery is disabled.`);
          firebaseAvailable = false;
          return null;
        }
        const serviceAccount = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
        firebaseAdmin.initializeApp({
          credential: firebaseAdmin.credential.cert(serviceAccount),
        });
      }
    }

    firebaseAvailable = true;
    return firebaseAdmin;
  } catch (error) {
    log.warn({ err: error }, "[push] failed to initialize firebase-admin");
    firebaseAvailable = false;
    return null;
  }
}

/**
 * T3.3 (P1-9): the push is a data-only wake-up. It names the message the
 * device should fetch and nothing else: no sender, no conversation, no
 * text. The device pulls the ciphertext from `/messages/undelivered`,
 * decrypts it, and renders the notification itself, so Google's servers
 * never see who is talking to whom.
 */
export type MessagePushPayload = {
  data: { type: "msg"; serverMessageId: string };
  android: { priority: "high" };
  apns: {
    headers: { "apns-priority": "5"; "apns-push-type": "background" };
    payload: { aps: { "content-available": 1 } };
  };
};

export function buildMessagePush(serverMessageId: string): MessagePushPayload {
  return {
    data: { type: "msg", serverMessageId },
    android: { priority: "high" },
    // iOS is parked (T1.16); the silent-push shape is here so the iOS build needs no server change.
    apns: {
      headers: { "apns-priority": "5", "apns-push-type": "background" },
      payload: { aps: { "content-available": 1 } },
    },
  };
}

/**
 * Only these FCM errors mean the token is dead. Anything else (quota,
 * internal, unavailable, a transient network failure) keeps the token: the
 * old code pruned on any failure and silently unsubscribed devices during
 * FCM outages.
 */
export const PRUNE_ERROR_CODES = new Set<string>([
  "messaging/registration-token-not-registered",
  "messaging/invalid-argument",
  "messaging/invalid-registration-token",
]);

export function tokensToPrune(
  tokens: string[],
  responses: Array<{ success: boolean; error?: { code?: string } | null }>,
): string[] {
  const out: string[] = [];
  responses.forEach((result, index) => {
    const token = tokens[index];
    if (!token || result.success) return;
    const code = result.error?.code ?? "";
    if (PRUNE_ERROR_CODES.has(code)) out.push(token);
  });
  return out;
}

export async function sendMessagePushToUser(params: { toUserId: string; serverMessageId: string }) {
  const admin = getFirebaseAdmin();
  if (!admin) {
    metrics.pushSent.inc({ result: 'disabled' });
    return;
  }

  const recipient = await UserModel.findById(params.toUserId).select("pushTokens");
  if (!recipient?.pushTokens?.length) {
    metrics.pushSent.inc({ result: 'no_token' });
    return;
  }

  const tokens = recipient.pushTokens
    .map((item: any) => item?.token)
    .filter((token: unknown): token is string => typeof token === "string" && token.length > 0);

  if (!tokens.length) return;

  try {
    const response = await admin.messaging().sendEachForMulticast({
      tokens,
      ...buildMessagePush(params.serverMessageId),
    });

    const responses = (response.responses ?? []) as Array<{ success: boolean; error?: { code?: string } | null }>;
    for (const r of responses) metrics.pushSent.inc({ result: r.success ? 'ok' : 'failed' });
    const invalidTokens = tokensToPrune(tokens, responses);
    if (invalidTokens.length) metrics.pushTokensPruned.inc(invalidTokens.length);
    if (invalidTokens.length) {
      await UserModel.updateOne(
        { _id: params.toUserId },
        {
          $pull: {
            pushTokens: {
              token: { $in: invalidTokens },
            },
          },
        },
      );
    }
  } catch (error) {
    log.warn({ err: (error as Error)?.message ?? error }, "[push] failed to send push notification");
  }
}
