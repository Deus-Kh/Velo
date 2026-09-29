import type { NextFunction, Request, Response } from 'express';
import { z, type ZodType } from 'zod';

/**
 * Shared request validation (T1.8 / P0-8).
 *
 * Every body that reaches a handler has been parsed by one of these schemas.
 * Failures return 400 `{ error: 'Validation failed', code: 'VALIDATION', fields }`
 * where `fields` maps each offending path to one human-readable message, which
 * the client renders next to the matching input.
 */

// ───────────────────────── primitives ─────────────────────────

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Standard (not URL-safe) base64 that decodes to exactly `bytes` bytes. */
export function base64Bytes(bytes: number, label = 'value'): ZodType<string> {
  return z
    .string()
    .trim()
    .refine((s) => s.length % 4 === 0 && BASE64.test(s), `${label} must be standard base64`)
    .refine((s) => Buffer.from(s, 'base64').length === bytes, `${label} must decode to ${bytes} bytes`);
}

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;
/** Letters, digits, underscore, dot. No leading/trailing dot, no double dots. */
export const USERNAME_PATTERN = /^(?!\.)(?!.*\.\.)[A-Za-z0-9_.]+(?<!\.)$/;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'Email is too long')
  .pipe(z.email('Enter a valid email address'));

export const usernameSchema = z
  .string()
  .trim()
  .min(USERNAME_MIN_LENGTH, `Username must be at least ${USERNAME_MIN_LENGTH} characters`)
  .max(USERNAME_MAX_LENGTH, `Username must be at most ${USERNAME_MAX_LENGTH} characters`)
  .regex(USERNAME_PATTERN, 'Username may contain letters, digits, underscores and dots');

/** Shape only; strength and breach checks are async — see checkPasswordPolicy(). */
export const passwordShapeSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters`)
  .refine((s) => /\S/.test(s), 'Password cannot be only whitespace');

export const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

// ───────────────────────── request bodies ─────────────────────────

export const registerSchema = z.object({
  email: emailSchema,
  username: usernameSchema,
  password: passwordShapeSchema,
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(1, 'Email is required').max(254),
  password: z.string().min(1, 'Password is required').max(PASSWORD_MAX_LENGTH),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required').max(PASSWORD_MAX_LENGTH),
  newPassword: passwordShapeSchema,
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(16).max(512),
});

/** T7.6: account deletion re-asks the password. */
export const deleteAccountSchema = z.object({
  password: z.string().min(1, 'Password is required').max(PASSWORD_MAX_LENGTH),
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(16).max(512).optional(),
});

export const updateMeSchema = z.object({
  email: emailSchema,
  username: usernameSchema,
});

/** T7.4: a partial update of the privacy toggles; at least one field, nothing unknown. */
export const privacySchema = z
  .object({
    readReceipts: z.boolean().optional(),
    typing: z.boolean().optional(),
    lastSeen: z.boolean().optional(),
    online: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one setting is required' });

/** T7.5: a report; only what the reporter wrote reaches the server. */
export const reportSchema = z
  .object({
    reportedUserId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'reportedUserId must be an id'),
    reason: z.enum(['spam', 'abuse', 'impersonation', 'other']),
    excerpt: z.string().max(2000).optional(),
    groupId: z.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
  })
  .strict();

/** T8.2: an attachment reservation: the ciphertext length (8 MiB plaintext + chunk overhead + MAC at most). */
export const MAX_BLOB_BYTES_SCHEMA = 8 * 1024 * 1024 + Math.ceil((8 * 1024 * 1024) / (64 * 1024)) * 16 + 32;
export const reserveAttachmentSchema = z
  .object({
    size: z.number().int().min(1).max(MAX_BLOB_BYTES_SCHEMA),
  })
  .strict();

export const pushTokenSchema = z.object({
  token: z.string().trim().min(1, 'token is required').max(4096),
  platform: z.enum(['android', 'ios']),
});

export const identityKeySchema = z.object({
  identitySignPublicKey: base64Bytes(32, 'identitySignPublicKey'),
});

export const identityDhKeySchema = z.object({
  identityDhPublicKey: base64Bytes(32, 'identityDhPublicKey'),
});

/** T2.13: both identity keys and the binding signature in one upload. */
export const identityUploadSchema = z.object({
  identitySignPublicKey: base64Bytes(32, 'identitySignPublicKey'),
  identityDhPublicKey: base64Bytes(32, 'identityDhPublicKey'),
  identityBindingSignature: base64Bytes(64, 'identityBindingSignature'),
});

export const signedPreKeySchema = z.object({
  keyId: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  publicKey: base64Bytes(32, 'publicKey'),
  signature: base64Bytes(64, 'signature'),
});

export const MAX_PREKEYS_PER_UPLOAD = 500;

export const preKeysUploadSchema = z.object({
  items: z
    .array(
      z.object({
        keyId: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
        publicKey: base64Bytes(32, 'publicKey'),
      }),
    )
    .min(1, 'items must not be empty')
    .max(MAX_PREKEYS_PER_UPLOAD, `Too many prekeys (max ${MAX_PREKEYS_PER_UPLOAD} per request)`),
});

// ───────────────────────── middleware ─────────────────────────

export type FieldErrors = Record<string, string>;

export function fieldErrorsFromZod(error: z.ZodError): FieldErrors {
  const fields: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.map(String).join('.') : '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}

export function validationFailed(res: Response, fields: FieldErrors): Response {
  return res.status(400).json({ error: 'Validation failed', code: 'VALIDATION', fields });
}

/** Parses `req.body` with `schema`; on success replaces it with the parsed value. */
export function validateBody<T extends ZodType>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      validationFailed(res, fieldErrorsFromZod(result.error));
      return;
    }
    req.body = result.data;
    next();
  };
}
