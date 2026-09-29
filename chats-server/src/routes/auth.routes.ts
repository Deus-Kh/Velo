import { Router } from "express";
import bcrypt from "bcrypt";
import { UserModel, USERNAME_CI_COLLATION } from "../models/User";
import { config } from "../config";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { authLimiter } from "../middleware/rateLimit";
import { services } from "../lib/services";
import { checkPasswordPolicy } from "../lib/passwordPolicy";
import { deleteAccount } from "../lib/accountDeletion";
import {
  issueTokenPair,
  revokeAllRefreshTokens,
  revokeFamilyByToken,
  rotateRefreshToken,
} from "../lib/refreshTokens";
import {
  deleteAccountSchema,
  changePasswordSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
  validateBody,
  validationFailed,
} from "../utils/validation";

export const authRouter = Router();

function isDuplicateKeyError(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: number }).code === 11000;
}

function userAgentOf(req: { header(name: string): string | undefined }): string | null {
  const ua = req.header("user-agent");
  return ua ? ua.slice(0, 256) : null;
}

authRouter.post("/register", authLimiter, validateBody(registerSchema), async (req, res) => {
  const { email, username, password } = req.body as {
    email: string;
    username: string;
    password: string;
  };

  // Strength + breach policy; the shape (length) was already enforced by the schema.
  const policy = await checkPasswordPolicy(password, {
    userInputs: [email, username],
    breachCheck: config.PASSWORD_BREACH_CHECK,
  });
  if (!policy.ok) return validationFailed(res, { password: policy.reason });

  const existingEmail = await UserModel.findOne({ email }).select("_id");
  if (existingEmail) return res.status(409).json({ error: "Email already in use", code: "EMAIL_TAKEN" });

  const existingUsername = await UserModel.findOne({ username }).collation(USERNAME_CI_COLLATION).select("_id");
  if (existingUsername) return res.status(409).json({ error: "Username already in use", code: "USERNAME_TAKEN" });

  const passwordHash = await bcrypt.hash(password, config.BCRYPT_ROUNDS);
  let userId: string;
  try {
    const user = await UserModel.create({ email, username, passwordHash });
    userId = String(user._id);
  } catch (e) {
    // Concurrent registration lost the race against the unique index.
    if (isDuplicateKeyError(e)) {
      return res.status(409).json({ error: "Email or username already in use", code: "TAKEN" });
    }
    throw e;
  }

  const pair = await issueTokenPair(userId, userAgentOf(req));
  return res.json({ ...pair, userId });
});

authRouter.post("/login", authLimiter, validateBody(loginSchema), async (req, res) => {
  const { email, password } = req.body as { email: string; password: string };

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

  const user = await UserModel.findOne({ email });
  const ok = user ? await bcrypt.compare(password, user.passwordHash) : false;

  if (!user || !ok) {
    await services.loginThrottle.recordFailure(email);
    return res.status(401).json({ error: "Invalid credentials", code: "INVALID_CREDENTIALS" });
  }

  await services.loginThrottle.recordSuccess(email);
  const userId = String(user._id);
  const pair = await issueTokenPair(userId, userAgentOf(req));
  return res.json({ ...pair, userId });
});

/**
 * POST /auth/refresh — exchange a refresh token for a new access + refresh
 * pair (rotation). A rotated-out token presented again revokes its whole
 * family (reuse detection). Not behind authLimiter: a healthy client refreshes
 * about once per access-token lifetime, and abuse is bounded by the token
 * itself plus the global limiter.
 */
authRouter.post("/refresh", validateBody(refreshSchema), async (req, res) => {
  const { refreshToken } = req.body as { refreshToken: string };
  const result = await rotateRefreshToken(refreshToken, userAgentOf(req));
  if (!result.ok) {
    return res.status(401).json({ error: "Session expired. Please sign in again.", code: `REFRESH_${result.code}` });
  }
  return res.json({ ...result.pair, userId: result.userId });
});

/** POST /auth/logout — revoke the caller's refresh-token family. Access token required. */
authRouter.post("/logout", requireAuth, validateBody(logoutSchema), async (req: AuthedRequest, res) => {
  const { refreshToken } = req.body as { refreshToken?: string };
  if (refreshToken) {
    await revokeFamilyByToken(refreshToken, String(req.userId));
  }
  return res.json({ ok: true });
});

// T7.6: account deletion (GDPR Art. 17). Password once more; then everything the server holds goes (lib/accountDeletion.ts).
authRouter.delete("/account", requireAuth, validateBody(deleteAccountSchema), async (req: AuthedRequest, res) => {
  const { password } = req.body as { password: string };
  const user = await UserModel.findById(req.userId);
  if (!user) return res.status(404).json({ error: "User not found", code: "NOT_FOUND" });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Password is incorrect", code: "INVALID_CREDENTIALS" });
  const report = await deleteAccount(String(user._id));
  if (!report) return res.status(404).json({ error: "User not found", code: "NOT_FOUND" });
  return res.json({ ok: true, deleted: true, groupsLeft: report.groupsLeft, peersNotified: report.peersNotified });
});

authRouter.post(
  "/change-password",
  requireAuth,
  validateBody(changePasswordSchema),
  async (req: AuthedRequest, res) => {
    const { currentPassword, newPassword } = req.body as {
      currentPassword: string;
      newPassword: string;
    };

    const user = await UserModel.findById(req.userId);
    if (!user) return res.status(404).json({ error: "User not found", code: "NOT_FOUND" });

    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: "Current password is incorrect", code: "INVALID_CREDENTIALS" });
    }

    const policy = await checkPasswordPolicy(newPassword, {
      userInputs: [user.email, user.username],
      breachCheck: config.PASSWORD_BREACH_CHECK,
    });
    if (!policy.ok) return validationFailed(res, { newPassword: policy.reason });

    if (await bcrypt.compare(newPassword, user.passwordHash)) {
      return validationFailed(res, { newPassword: "New password must differ from the current one" });
    }

    user.passwordHash = await bcrypt.hash(newPassword, config.BCRYPT_ROUNDS);
    await user.save();

    // Every other session must re-authenticate: revoke all refresh families
    // and hand this client a fresh pair. Outstanding access tokens expire
    // within JWT_ACCESS_TTL.
    await revokeAllRefreshTokens(String(user._id));
    const pair = await issueTokenPair(String(user._id), userAgentOf(req));
    return res.json({ ok: true, ...pair });
  },
);
