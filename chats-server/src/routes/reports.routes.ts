import { Router } from 'express';
import { Types } from 'mongoose';
import { requireAuth, type AuthedRequest } from '../middleware/auth';
import { ReportModel, type ReportReason } from '../models/Report';
import { UserModel } from '../models/User';
import { reportSchema, validateBody } from '../utils/validation';
import { log } from '../lib/logger';

/** T7.5: POST /reports — a report about a user, in the reporter's own words. */
export const reportsRouter = Router();

reportsRouter.post('/', requireAuth, validateBody(reportSchema), async (req: AuthedRequest, res) => {
  const me = String(req.userId);
  const body = req.body as { reportedUserId: string; reason: ReportReason; excerpt?: string; groupId?: string };
  if (body.reportedUserId === me) return res.status(400).json({ error: 'Cannot report yourself', code: 'SELF' });
  if (!(await UserModel.exists({ _id: body.reportedUserId }))) return res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' });
  const doc = await ReportModel.create({
    reporterId: me,
    reportedUserId: body.reportedUserId,
    reason: body.reason,
    excerpt: body.excerpt?.trim() || null,
    groupId: body.groupId && Types.ObjectId.isValid(body.groupId) ? body.groupId : null,
  });
  log.info({ reportId: String(doc._id), reason: body.reason }, '[reports] filed'); // no user ids in the log line (T4.5)
  return res.status(201).json({ ok: true, reportId: String(doc._id) });
});
