import fs from "fs";
import path from "path";
import { config } from "../config";
import { UserModel } from "../models/User";

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
    console.warn("[push] firebase-admin is not installed; push delivery is disabled.");
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
        if (fs.existsSync(resolvedPath)) {
          const serviceAccount = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
          firebaseAdmin.initializeApp({
            credential: firebaseAdmin.credential.cert(serviceAccount),
          });
        } else {
          firebaseAdmin.initializeApp();
        }
      }
    }

    firebaseAvailable = true;
    return firebaseAdmin;
  } catch (error) {
    console.warn("[push] failed to initialize firebase-admin:", error);
    firebaseAvailable = false;
    return null;
  }
}

export async function sendMessagePushToUser(params: {
  toUserId: string;
  fromUserId: string;
  conversationId: string;
  serverMessageId: string;
}) {
  const admin = getFirebaseAdmin();
  if (!admin) return;

  const recipient = await UserModel.findById(params.toUserId).select("pushTokens");
  if (!recipient?.pushTokens?.length) return;

  const sender = await UserModel.findById(params.fromUserId).select("username");
  const title = sender?.username || "New message";
  const body = "New encrypted message";

  const tokens = recipient.pushTokens
    .map((item: any) => item?.token)
    .filter((token: unknown): token is string => typeof token === "string" && token.length > 0);

  if (!tokens.length) return;

  try {
    const response = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: {
        title,
        body,
      },
      data: {
        type: "chat_message",
        conversationId: params.conversationId,
        fromUserId: params.fromUserId,
        serverMessageId: params.serverMessageId,
      },
      android: {
        priority: "high",
        notification: {
          priority: "high",
        },
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
            badge: 1,
          },
        },
      },
    });

    const invalidTokens = response.responses
      .map((result: any, index: number) => (!result.success ? tokens[index] : null))
      .filter((token: string | null) => token !== null);

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
    console.warn("[push] failed to send push notification:", error);
  }
}
