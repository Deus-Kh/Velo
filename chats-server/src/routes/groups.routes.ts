import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, type AuthedRequest } from '../middleware/auth';
import { GroupModel, GROUP_MAX_MEMBERS, GROUP_NAME_MAX } from '../models/Group';
import { objectIdSchema, validateBody } from '../utils/validation';
import { addMembers, createGroup, httpStatusFor, loadGroupForMember, removeMember, renameGroup, toGroupView } from '../lib/groups';

export const groupsRouter = Router();

const nameSchema = z.string().trim().min(1).max(GROUP_NAME_MAX);
const createSchema = z.object({ name: nameSchema, memberIds: z.array(objectIdSchema).max(GROUP_MAX_MEMBERS) });
const membersSchema = z.object({ userIds: z.array(objectIdSchema).min(1).max(GROUP_MAX_MEMBERS) });
const renameSchema = z.object({ name: nameSchema });

/** POST /groups  { name, memberIds } (T6.3): the caller becomes the admin. */
groupsRouter.post('/', requireAuth, validateBody(createSchema), async (req: AuthedRequest, res) => {
  const r = await createGroup({ creatorId: String(req.userId), name: req.body.name, memberIds: req.body.memberIds });
  if (!r.ok) return res.status(httpStatusFor(r.code)).json({ error: r.error, code: r.code });
  return res.status(201).json(await toGroupView(r.value));
});

/** GET /groups: the caller's groups, most recently active first. */
groupsRouter.get('/', requireAuth, async (req: AuthedRequest, res) => {
  const groups = await GroupModel.find({ 'members.userId': req.userId }).sort({ lastMessageAt: -1 }).limit(200);
  return res.json({ items: await Promise.all(groups.map(toGroupView)) });
});

/** GET /groups/:id (members only). */
groupsRouter.get('/:id', requireAuth, async (req: AuthedRequest, res) => {
  const r = await loadGroupForMember(String(req.params.id), String(req.userId));
  if (!r.ok) return res.status(httpStatusFor(r.code)).json({ error: r.error, code: r.code });
  return res.json(await toGroupView(r.value));
});

/** PATCH /groups/:id { name } (admins). */
groupsRouter.patch('/:id', requireAuth, validateBody(renameSchema), async (req: AuthedRequest, res) => {
  const r = await renameGroup({ groupId: String(req.params.id), byUserId: String(req.userId), name: req.body.name });
  if (!r.ok) return res.status(httpStatusFor(r.code)).json({ error: r.error, code: r.code });
  return res.json(await toGroupView(r.value));
});

/** POST /groups/:id/members { userIds } (admins): epoch increments, every member is told. */
groupsRouter.post('/:id/members', requireAuth, validateBody(membersSchema), async (req: AuthedRequest, res) => {
  const r = await addMembers({ groupId: String(req.params.id), byUserId: String(req.userId), userIds: req.body.userIds });
  if (!r.ok) return res.status(httpStatusFor(r.code)).json({ error: r.error, code: r.code });
  return res.json(await toGroupView(r.value));
});

/** DELETE /groups/:id/members/:userId (admins remove; a member may remove itself = leave). */
groupsRouter.delete('/:id/members/:userId', requireAuth, async (req: AuthedRequest, res) => {
  const r = await removeMember({ groupId: String(req.params.id), byUserId: String(req.userId), userId: String(req.params.userId) });
  if (!r.ok) return res.status(httpStatusFor(r.code)).json({ error: r.error, code: r.code });
  return res.json(r.value ? await toGroupView(r.value) : { ok: true, deleted: true });
});

/** POST /groups/:id/leave */
groupsRouter.post('/:id/leave', requireAuth, async (req: AuthedRequest, res) => {
  const r = await removeMember({ groupId: String(req.params.id), byUserId: String(req.userId), userId: String(req.userId) });
  if (!r.ok) return res.status(httpStatusFor(r.code)).json({ error: r.error, code: r.code });
  return res.json({ ok: true, deleted: r.value === null });
});
