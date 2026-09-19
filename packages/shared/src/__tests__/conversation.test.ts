import { expect, test } from 'vitest';
import {
  buildConversationContext,
  type ParentageClient,
  type ReplyParentage,
} from '../conversation.js';

const reply = (overrides: Partial<ReplyParentage> & { id: string }): ReplyParentage => ({
  text: `text of ${overrides.id}`,
  username: `user-${overrides.id}`,
  isReplyOwnedByMe: false,
  ...overrides,
});

/** Fake client that serves a fixed reply map; anything missing is a fetch failure. */
const makeClient = (map: Record<string, ReplyParentage>): ParentageClient => ({
  getReplyById: async (id: string) => {
    const found = map[id];
    return found
      ? { success: true, reply: found }
      : { success: false, error: `not found: ${id}` };
  },
});

const FOCUSED = { id: 'post-1', text: 'The focused post' };

test('direct reply off the focused post builds a depth-1 context', async () => {
  const r = reply({ id: 'r1', repliedToId: FOCUSED.id });
  const result = await buildConversationContext(makeClient({}), FOCUSED, r);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.context.rootPost.id).toBe(FOCUSED.id);
  expect(result.context.targetReply.id).toBe('r1');
  expect(result.context.parentChain).toHaveLength(0);
  expect(result.context.depth).toBe(1);
  expect(result.context.parentageSource).toBe('api');
});

test('nested reply walks the parent chain in root-first order', async () => {
  // r3 -> r2 -> r1 -> post-1
  const r1 = reply({ id: 'r1', repliedToId: FOCUSED.id });
  const r2 = reply({ id: 'r2', repliedToId: 'r1' });
  const r3 = reply({ id: 'r3', repliedToId: 'r2' });
  const client = makeClient({ r1, r2 });
  const result = await buildConversationContext(client, FOCUSED, r3);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.context.depth).toBe(3);
  expect(result.context.parentChain.map((m) => m.id)).toEqual(['r1', 'r2']);
  expect(result.context.targetReply.id).toBe('r3');
});

test('reply that IS the focused post is refused', async () => {
  const r = reply({ id: FOCUSED.id, repliedToId: 'something' });
  const result = await buildConversationContext(makeClient({}), FOCUSED, r);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.reason).toContain('focused post itself');
});

test('missing replied_to link is refused (never assumed)', async () => {
  const r = reply({ id: 'r1' }); // no repliedToId at all
  const result = await buildConversationContext(makeClient({}), FOCUSED, r);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.reason).toContain('Missing parentage');
});

test('unfetchable parent is refused', async () => {
  const r = reply({ id: 'r1', repliedToId: 'ghost' });
  const result = await buildConversationContext(makeClient({}), FOCUSED, r);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.reason).toContain('could not fetch parent ghost');
});

test('parentage cycle is refused', async () => {
  // r1 -> r2 -> r1 (cycle)
  const r1 = reply({ id: 'r1', repliedToId: 'r2' });
  const r2 = reply({ id: 'r2', repliedToId: 'r1' });
  const client = makeClient({ r1, r2 });
  const result = await buildConversationContext(client, FOCUSED, r1);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.reason).toContain('cycle');
});

test('self-reply cycle is refused', async () => {
  const r = reply({ id: 'r1', repliedToId: 'r1' });
  const result = await buildConversationContext(makeClient({}), FOCUSED, r);
  expect(result.ok).toBe(false);
});

test('chain that terminates at a different post is refused (no silent wrong-root)', async () => {
  // r2 -> r1 -> other-post (never reaches FOCUSED, r1 has no further parent)
  const r1 = reply({ id: 'r1', repliedToId: 'other-post' });
  const r2 = reply({ id: 'r2', repliedToId: 'r1' });
  const other = reply({ id: 'other-post' }); // no parent link: dead end
  const client = makeClient({ r1, other });
  const result = await buildConversationContext(client, FOCUSED, r2);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.reason).toContain('Missing parentage');
});

test('excessively long chains are refused instead of recursing forever', async () => {
  // Build a 10-deep chain that never touches the focused post.
  const map: Record<string, ReplyParentage> = {};
  let prev = 'chain-0';
  for (let i = 1; i <= 10; i++) {
    const id = `chain-${i}`;
    map[id] = reply({ id, repliedToId: prev });
    prev = id;
  }
  const tip = reply({ id: 'tip', repliedToId: 'chain-10' });
  const result = await buildConversationContext(makeClient(map), FOCUSED, tip);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.reason).toContain('exceeded');
});

test('our prior replies are carried through, capped at five', async () => {
  const r = reply({ id: 'r1', repliedToId: FOCUSED.id });
  const priors = Array.from({ length: 8 }, (_, i) => ({ id: `mine-${i}`, text: `my ${i}` }));
  const result = await buildConversationContext(makeClient({}), FOCUSED, r, priors);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.context.ourPriorReplies).toHaveLength(5);
  expect(result.context.ourPriorReplies[0].id).toBe('mine-0');
});
