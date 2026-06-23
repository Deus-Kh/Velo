import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { UserModel } from "../models/User";
import { config } from "../config";
import { requireAuth, type AuthedRequest } from "../middleware/auth";

export const authRouter = Router();

authRouter.post("/register", async (req, res) => {
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
//@ts-ignore
  const accessToken = jwt.sign(
    { userId: String(user._id) },
    config.JWT_SECRET,
    //@ts-ignore
    { expiresIn: config.JWT_MAX_AGE},
  );

  return res.json({ accessToken, userId: String(user._id) });
});

authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  const user = await UserModel.findOne({ email: email.toLowerCase() });
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });
//@ts-ignore
  const accessToken = jwt.sign(
    { userId: String(user._id) },
    config.JWT_SECRET,
    { expiresIn: config.JWT_MAX_AGE },
  );

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
