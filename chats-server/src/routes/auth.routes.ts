import { Router } from "express";
import bcrypt from "bcrypt";
import jwt, { type SignOptions } from "jsonwebtoken";
import { UserModel, USERNAME_CI_COLLATION } from "../models/User";
import { config } from "../config";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { authLimiter } from "../middleware/rateLimit";
import { services } from "../lib/services";
import { checkPasswordPolicy } from "../lib/passwordPolicy";
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  validateBody,
  validationFailed,
} from "../utils/validation";

export const authRouter = Router();

const accessTokenSignOptions: SignOptions = {
  expiresIn: config.JWT_ACCESS_TTL as SignOptions["expiresIn"],
  algorithm: config.JWT_ALGORITHM,
};

function signAccessToken(userId: string): string {
  return jwt.sign({ userId }, config.JWT_SECRET, accessTokenSignOptions);
}

function isDuplicateKeyError(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: number }).code === 11000;
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

  return res.json({ accessToken: signAccessToken(userId), userId });
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
  const accessToken = signAccessToken(String(user._id));

  return res.json({ accessToken, userId: String(user._id) });
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

    // Existing access tokens stay valid until T1.10 introduces revocation.
    return res.json({ ok: true });
  },
);
