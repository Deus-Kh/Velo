import { Router } from "express";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { UserModel } from "../models/User";

export const usersRouter = Router();

// POST /users/public-key  (JWT)
usersRouter.post(
  "/public-key",
  requireAuth,
  async (req: AuthedRequest, res) => {
    const { publicKey } = req.body as { publicKey?: string };
    if (!publicKey)
      return res.status(400).json({ error: "publicKey is required" });

    // минимальная sanity-check (не крипто-верификация, но от мусора защищает)
    if (typeof publicKey !== "string" || publicKey.length < 20) {
      return res.status(400).json({ error: "Invalid publicKey format" });
    }

    await UserModel.updateOne(
      { _id: req.userId },
      { $set: { publicKey, publicKeyUpdatedAt: new Date() } },
    );

    return res.json({ ok: true });
  },
);

// GET /users/public-key/:userId  (JWT)
usersRouter.get(
  "/public-key/:userId",
  requireAuth,
  async (req: AuthedRequest, res) => {
    const { userId } = req.params;

    const user = await UserModel.findById(userId).select("publicKey");
    if (!user) return res.status(404).json({ error: "User not found" });
    if (!user.publicKey)
      return res.status(404).json({ error: "Public key not set" });

    return res.json({ userId: String(user._id), publicKey: user.publicKey });
  },
);

// (опционально) GET /users/me  (JWT)
usersRouter.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  const user = await UserModel.findById(req.userId).select(
    "email username publicKey",
  );
  if (!user) return res.status(404).json({ error: "User not found" });
  return res.json({
    userId: String(user._id),
    email: user.email,
    username: user.username,
    publicKey: user.publicKey,
  });
});

usersRouter.patch("/me", requireAuth, async (req: AuthedRequest, res) => {
  const { email, username } = req.body as { email?: string; username?: string };

  const nextEmail = String(email || "").trim().toLowerCase();
  const nextUsername = String(username || "").trim();

  if (!nextEmail || !nextUsername) {
    return res.status(400).json({ error: "email and username are required" });
  }

  if (nextUsername.length < 3 || nextUsername.length > 32) {
    return res.status(400).json({ error: "Username must be between 3 and 32 characters" });
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(nextEmail)) {
    return res.status(400).json({ error: "Invalid email format" });
  }

  const existingEmail = await UserModel.findOne({
    email: nextEmail,
    _id: { $ne: req.userId },
  }).select("_id");
  if (existingEmail) {
    return res.status(409).json({ error: "Email already in use" });
  }

  const existingUsername = await UserModel.findOne({
    username: nextUsername,
    _id: { $ne: req.userId },
  }).select("_id");
  if (existingUsername) {
    return res.status(409).json({ error: "Username already in use" });
  }

  const user = await UserModel.findByIdAndUpdate(
    req.userId,
    {
      $set: {
        email: nextEmail,
        username: nextUsername,
      },
    },
    { new: true },
  ).select("email username publicKey");

  if (!user) return res.status(404).json({ error: "User not found" });

  return res.json({
    userId: String(user._id),
    email: user.email,
    username: user.username,
    publicKey: user.publicKey,
  });
});

usersRouter.post("/me/push-token", requireAuth, async (req: AuthedRequest, res) => {
  const token = String(req.body?.token || "").trim();
  const platform = String(req.body?.platform || "").trim().toLowerCase();

  if (!token) {
    return res.status(400).json({ error: "token is required" });
  }

  if (platform !== "android" && platform !== "ios") {
    return res.status(400).json({ error: "platform must be android or ios" });
  }

  await UserModel.updateOne(
    { _id: req.userId },
    {
      $pull: {
        pushTokens: { token },
      },
    },
  );

  await UserModel.updateOne(
    { _id: req.userId },
    {
      $push: {
        pushTokens: {
          token,
          platform,
          updatedAt: new Date(),
        },
      },
    },
  );

  return res.json({ ok: true });
});

usersRouter.delete("/me/push-token", requireAuth, async (req: AuthedRequest, res) => {
  const token = String(req.body?.token || req.query?.token || "").trim();

  if (!token) {
    return res.status(400).json({ error: "token is required" });
  }

  await UserModel.updateOne(
    { _id: req.userId },
    {
      $pull: {
        pushTokens: { token },
      },
    },
  );

  return res.json({ ok: true });
});

// GET /users  (JWT) — список пользователей (без пароля)
usersRouter.get('/', requireAuth, async (req: AuthedRequest, res) => {
  const q = String(req.query.q || '').trim(); // search by username/email
  const limit = Math.min(Number(req.query.limit || 50), 100);

  const filter: any = { _id: { $ne: req.userId } };

  if (q) {
    filter.$or = [
      { username: { $regex: q, $options: 'i' } },
      { email: { $regex: q, $options: 'i' } },
    ];
  }

  const users = await UserModel.find(filter)
    .select('_id username email identitySignUpdatedAt identityDhUpdatedAt') // Check for E2EE key setup
    .limit(limit)
    .sort({ username: 1 });

  return res.json({
    items: users.map((u) => ({
      userId: String(u._id),
      username: u.username,
      email: u.email,
      hasPublicKey: !!(u.identitySignUpdatedAt && u.identityDhUpdatedAt),
    })),
  });
});
