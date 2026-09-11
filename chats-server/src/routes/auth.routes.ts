import { Router } from "express";
import bcrypt from "bcrypt";
import jwt, { type SignOptions } from "jsonwebtoken";
import { UserModel } from "../models/User";
import { config } from "../config";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { authLimiter } from "../middleware/rateLimit";
import { services } from "../lib/services";

export const authRouter = Router();

const accessTokenSignOptions: SignOptions = {
  expiresIn: config.JWT_ACCESS_TTL as SignOptions["expiresIn"],
  algorithm: config.JWT_ALGORITHM,
};

function signAccessToken(userId: string): string {
  return jwt.sign({ userId }, config.JWT_SECRET, accessTokenSignOptions);
}

authRouter.post("/register", authLimiter, async (req, res) => {
  const { email, username, password } = req.body as {
    email?: string;
    username?: string;
    password?: string;
  };

  if (!email || !username || !password) {
    return res
      .status(400)
      .json({ error: "email, username, password are required" });
  }

  const existingEmail = await UserModel.findOne({ email: email.toLowerCase() });
  if (existingEmail)
    return res.status(409).json({ error: "Email already in use" });

  const existingUsername = await UserModel.findOne({ username });
  if (existingUsername)
    return res.status(409).json({ error: "Username already in use" });

  const passwordHash = await bcrypt.hash(password, config.BCRYPT_ROUNDS);
  const user = await UserModel.create({ email, username, passwordHash });
  const accessToken = signAccessToken(String(user._id));

  return res.json({ accessToken, userId: String(user._id) });
});

authRouter.post("/login", authLimiter, async (req, res) => {
  const { email, password } = req.body as { email?: unknown; password?: unknown };

  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  // Per-account progressive backoff (P0-5). Checked before the database
  // lookup so unknown accounts are throttled exactly like real ones.
  const throttle = await services.loginThrottle.check(email);
  if (throttle.blocked) {
    res.setHeader("Retry-After", String(throttle.retryAfterSeconds));
    return res.status(429).json({
      error: `Too many failed attempts. Try again in ${throttle.retryAfterSeconds}s.`,
      code: "LOGIN_THROTTLED",
      retryAfterSeconds: throttle.retryAfterSeconds,
    });
  }

  const user = await UserModel.findOne({ email: email.toLowerCase() });
  const ok = user ? await bcrypt.compare(password, user.passwordHash) : false;

  if (!user || !ok) {
    await services.loginThrottle.recordFailure(email);
    return res.status(401).json({ error: "Invalid credentials" });
  }

  await services.loginThrottle.recordSuccess(email);
  const accessToken = signAccessToken(String(user._id));

  return res.json({ accessToken, userId: String(user._id) });
});

authRouter.post("/change-password", requireAuth, async (req: AuthedRequest, res) => {
  const { currentPassword, newPassword } = req.body as {
    currentPassword?: string;
    newPassword?: string;
  };

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "currentPassword and newPassword are required" });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: "New password must be at least 8 characters" });
  }

  const user = await UserModel.findById(req.userId);
  if (!user) return res.status(404).json({ error: "User not found" });

  const ok = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Current password is incorrect" });

  user.passwordHash = await bcrypt.hash(newPassword, config.BCRYPT_ROUNDS);
  await user.save();

  return res.json({ ok: true });
});
