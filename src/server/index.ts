/**
 * `better-auth-support/server` — the Better Auth support plugin.
 *
 * Identity comes from Better Auth itself: conversations link to `user.id`, and
 * the agent inbox joins back to the `user` table. Pre-auth visitors are tracked
 * with a signed cookie. An optional `aiResponder` answers first and escalates to
 * a human on `null`. Agent endpoints are role-gated (composes with the Better
 * Auth `admin` plugin).
 *
 * Realtime is poll-based in v0: clients re-fetch `/support/conversation`.
 * See the README for the serverless/SSE caveats.
 */
import type { GenericEndpointContext, BetterAuthPlugin } from "@better-auth/core";
import { APIError, createAuthEndpoint, getSessionFromCtx, sessionMiddleware } from "better-auth/api";

import type {
  ConversationStatus,
  InboxItem,
  InboxUser,
  SupportConversation,
  SupportMessage,
  SupportStats,
} from "../types.js";

export type {
  ConversationStatus,
  ConversationThread,
  InboxItem,
  InboxUser,
  MessageAuthorType,
  SupportConversation,
  SupportMessage,
} from "../types.js";

/* -------------------------------------------------------------------------- */
/* Options                                                                    */
/* -------------------------------------------------------------------------- */

export interface SupportNotifyHooks {
  /** Fired when a brand-new conversation is opened. */
  onNewConversation?: (
    conversation: SupportConversation,
    ctx: GenericEndpointContext,
  ) => void | Promise<void>;
  /** Fired for every inbound visitor/user message (including the first). */
  onNewMessage?: (
    message: SupportMessage,
    conversation: SupportConversation,
    ctx: GenericEndpointContext,
  ) => void | Promise<void>;
}

export interface SupportOptions {
  /**
   * Role permitted to use the agent endpoints. Defaults to `"admin"`, which
   * composes with the Better Auth admin plugin. The guard checks
   * `session.user.role` (comma-separated roles are supported).
   */
  agentRole?: string;
  /**
   * AI first-responder. Called on an inbound message when the conversation is
   * unassigned. Return a string to auto-reply (posted as an `ai` message and
   * the conversation stays `open`); return `null` to escalate — the
   * conversation is marked `pending` and `notify` fires for the agents.
   */
  aiResponder?: (message: string, ctx: GenericEndpointContext) => Promise<string | null>;
  /** Notify agents out-of-band (email/Slack/Discord/webhook). */
  notify?: SupportNotifyHooks;
  /**
   * Realtime transport. v0 only implements `"poll"` (serverless-safe); `"sse"`
   * is accepted for forward-compat but currently behaves like `"poll"`.
   */
  realtime?: "sse" | "poll";
  /** Allow pre-auth visitors via a signed cookie. Default `true`. */
  anonymous?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Internal helpers                                                           */
/* -------------------------------------------------------------------------- */

const CONVERSATION = "supportConversation";
const MESSAGE = "supportMessage";
const USER = "user";
const VISITOR_COOKIE = "support_visitor";
const VISITOR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

/** DB adapter type, derived from the endpoint context to avoid an extra import. */
type Adapter = GenericEndpointContext["context"]["adapter"];

type Actor =
  | { kind: "user"; id: string; role: string | null }
  | { kind: "visitor"; id: string };

function readRole(user: Record<string, unknown> | undefined | null): string | null {
  const role = user?.["role"];
  return typeof role === "string" ? role : null;
}

/** True when `role` (possibly comma-separated) contains `agentRole`. */
function isAgent(role: string | null, agentRole: string): boolean {
  if (!role) return false;
  return role
    .split(",")
    .map((r) => r.trim())
    .includes(agentRole);
}

/**
 * Resolve who is making the request. Prefers a Better Auth session; falls back
 * to a signed visitor cookie when `anonymous` is enabled, minting one on demand.
 */
async function resolveActor(
  ctx: GenericEndpointContext,
  allowAnonymous: boolean,
  mintVisitor: boolean,
): Promise<Actor | null> {
  const session = await getSessionFromCtx(ctx, { disableRefresh: true });
  if (session?.user) {
    return { kind: "user", id: session.user.id, role: readRole(session.user) };
  }
  if (!allowAnonymous) return null;

  const cookie = ctx.context.createAuthCookie(VISITOR_COOKIE, { maxAge: VISITOR_COOKIE_MAX_AGE });
  const existing = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
  if (existing) return { kind: "visitor", id: existing };
  if (!mintVisitor) return null;

  const visitorId = crypto.randomUUID();
  await ctx.setSignedCookie(cookie.name, visitorId, ctx.context.secret, cookie.attributes);
  return { kind: "visitor", id: visitorId };
}

async function findActorConversation(
  adapter: Adapter,
  actor: Actor,
): Promise<SupportConversation | null> {
  const field = actor.kind === "user" ? "userId" : "visitorId";
  const rows = await adapter.findMany<SupportConversation>({
    model: CONVERSATION,
    where: [{ field, value: actor.id }],
    sortBy: { field: "lastMessageAt", direction: "desc" },
    limit: 1,
  });
  return rows[0] ?? null;
}

async function findConversationById(
  adapter: Adapter,
  id: string,
): Promise<SupportConversation | null> {
  return adapter.findOne<SupportConversation>({
    model: CONVERSATION,
    where: [{ field: "id", value: id }],
  });
}

async function createConversation(
  adapter: Adapter,
  actor: Actor,
  subject: string | undefined,
): Promise<SupportConversation> {
  const now = new Date();
  return adapter.create<SupportConversation>({
    model: CONVERSATION,
    data: {
      userId: actor.kind === "user" ? actor.id : null,
      visitorId: actor.kind === "visitor" ? actor.id : null,
      status: "open",
      subject: subject ?? null,
      assignedAgentId: null,
      visitorEmail: null,
      visitorName: null,
      lastMessageAt: now,
      createdAt: now,
    },
  });
}

async function insertMessage(
  adapter: Adapter,
  conversationId: string,
  authorType: SupportMessage["authorType"],
  authorId: string | null,
  body: string,
): Promise<SupportMessage> {
  return adapter.create<SupportMessage>({
    model: MESSAGE,
    data: {
      conversationId,
      authorType,
      authorId: authorId ?? null,
      body,
      readAt: null,
      createdAt: new Date(),
    },
  });
}

async function loadMessages(adapter: Adapter, conversationId: string): Promise<SupportMessage[]> {
  return adapter.findMany<SupportMessage>({
    model: MESSAGE,
    where: [{ field: "conversationId", value: conversationId }],
    sortBy: { field: "createdAt", direction: "asc" },
  });
}

/** The most recent message in a conversation, or null when empty. */
async function latestMessage(
  adapter: Adapter,
  conversationId: string,
): Promise<SupportMessage | null> {
  const rows = await adapter.findMany<SupportMessage>({
    model: MESSAGE,
    where: [{ field: "conversationId", value: conversationId }],
    sortBy: { field: "createdAt", direction: "desc" },
    limit: 1,
  });
  return rows[0] ?? null;
}

const PREVIEW_MAX = 140;

/** Collapse whitespace and truncate a message body for list previews. */
function previewOf(body: string): string {
  const trimmed = body.trim().replace(/\s+/g, " ");
  return trimmed.length > PREVIEW_MAX ? `${trimmed.slice(0, PREVIEW_MAX - 1)}…` : trimmed;
}

/** Inbound = authored by the visitor/user (i.e. awaiting an agent reply). */
function isInbound(authorType: SupportMessage["authorType"]): boolean {
  return authorType === "visitor" || authorType === "user";
}

/** Resolve a user id to the minimal inbox identity, memoized per request. */
async function resolveInboxUser(
  adapter: Adapter,
  userId: string | null | undefined,
  cache: Map<string, InboxUser | null>,
): Promise<InboxUser | null> {
  if (!userId) return null;
  if (cache.has(userId)) return cache.get(userId) ?? null;
  const row = await adapter.findOne<Record<string, unknown>>({
    model: USER,
    where: [{ field: "id", value: userId }],
  });
  const user: InboxUser | null = row
    ? {
        id: String(row["id"]),
        email: String(row["email"] ?? ""),
        name: String(row["name"] ?? ""),
        role: readRole(row),
      }
    : null;
  cache.set(userId, user);
  return user;
}

/** Patch a conversation and bump `lastMessageAt`. Returns the fresh row. */
async function updateConversation(
  adapter: Adapter,
  id: string,
  patch: Partial<SupportConversation>,
  touch: boolean,
  fallback: SupportConversation,
): Promise<SupportConversation> {
  const update: Record<string, unknown> = { ...patch };
  if (touch) update["lastMessageAt"] = new Date();
  const updated = await adapter.update<SupportConversation>({
    model: CONVERSATION,
    where: [{ field: "id", value: id }],
    update,
  });
  return updated ?? { ...fallback, ...patch };
}

/** Run a user-supplied hook without letting its failure break the request. */
async function runHook(
  ctx: GenericEndpointContext,
  label: string,
  fn: () => unknown | Promise<unknown>,
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    ctx.context.logger.error(`[support] ${label} failed`, error);
  }
}

/* -------------------------------------------------------------------------- */
/* Plugin                                                                     */
/* -------------------------------------------------------------------------- */

export const support = (opts: SupportOptions = {}) => {
  const agentRole = opts.agentRole ?? "admin";
  const allowAnonymous = opts.anonymous ?? true;

  /** Throw unless the current session belongs to an agent. Returns the user id. */
  const requireAgent = (ctx: GenericEndpointContext): string => {
    const user = ctx.context.session?.user as Record<string, unknown> | undefined;
    if (!user || !isAgent(readRole(user), agentRole)) {
      throw new APIError("FORBIDDEN", { message: "Agent access required" });
    }
    return String(user["id"]);
  };

  return {
    id: "support",
    schema: {
      supportConversation: {
        fields: {
          userId: { type: "string", required: false },
          visitorId: { type: "string", required: false },
          status: { type: "string", required: true, defaultValue: "open" },
          subject: { type: "string", required: false },
          assignedAgentId: { type: "string", required: false },
          visitorEmail: { type: "string", required: false },
          visitorName: { type: "string", required: false },
          lastMessageAt: { type: "date", required: true },
          createdAt: { type: "date", required: true },
        },
      },
      supportMessage: {
        fields: {
          conversationId: { type: "string", required: true },
          authorType: { type: "string", required: true },
          authorId: { type: "string", required: false },
          body: { type: "string", required: true },
          readAt: { type: "date", required: false },
          createdAt: { type: "date", required: true },
        },
      },
    },
    endpoints: {
      /* ---- visitor / user ------------------------------------------------ */
      sendMessage: createAuthEndpoint(
        "/support/message",
        {
          method: "POST",
          metadata: {
            $Infer: {
              body: {} as { conversationId?: string; body: string; subject?: string },
            },
          },
        },
        async (ctx) => {
          const text = (ctx.body?.body ?? "").trim();
          if (!text) throw new APIError("BAD_REQUEST", { message: "Message body is required" });

          const adapter = ctx.context.adapter;
          const actor = await resolveActor(ctx, allowAnonymous, true);
          if (!actor) {
            throw new APIError("UNAUTHORIZED", {
              message: "Sign in or enable anonymous visitors to start a conversation",
            });
          }

          let conversation: SupportConversation;
          let isNew = false;
          if (ctx.body?.conversationId) {
            const found = await findConversationById(adapter, ctx.body.conversationId);
            if (!found) throw new APIError("NOT_FOUND", { message: "Conversation not found" });
            const owns =
              actor.kind === "user" ? found.userId === actor.id : found.visitorId === actor.id;
            if (!owns) throw new APIError("FORBIDDEN", { message: "Not your conversation" });
            conversation = found;
          } else {
            const existing = await findActorConversation(adapter, actor);
            if (existing) {
              conversation = existing;
            } else {
              conversation = await createConversation(adapter, actor, ctx.body?.subject);
              isNew = true;
            }
          }

          const authorType = actor.kind === "user" ? "user" : "visitor";
          const inbound = await insertMessage(adapter, conversation.id, authorType, actor.id, text);
          const created: SupportMessage[] = [inbound];

          if (isNew && opts.notify?.onNewConversation) {
            await runHook(ctx, "notify.onNewConversation", () =>
              opts.notify!.onNewConversation!(conversation, ctx),
            );
          }
          if (opts.notify?.onNewMessage) {
            await runHook(ctx, "notify.onNewMessage", () =>
              opts.notify!.onNewMessage!(inbound, conversation, ctx),
            );
          }

          // A new inbound message reopens a closed thread.
          let nextStatus: ConversationStatus =
            conversation.status === "closed" ? "open" : conversation.status;

          if (!conversation.assignedAgentId) {
            if (opts.aiResponder) {
              let reply: string | null = null;
              try {
                reply = await opts.aiResponder(text, ctx);
              } catch (error) {
                ctx.context.logger.error("[support] aiResponder failed", error);
              }
              if (reply && reply.trim()) {
                const aiMessage = await insertMessage(
                  adapter,
                  conversation.id,
                  "ai",
                  null,
                  reply.trim(),
                );
                created.push(aiMessage);
                nextStatus = "open";
              } else {
                // Escalate to a human.
                nextStatus = "pending";
              }
            } else {
              // No AI first-responder: route straight to the human queue.
              nextStatus = "pending";
            }
          }

          conversation = await updateConversation(
            adapter,
            conversation.id,
            { status: nextStatus },
            true,
            conversation,
          );

          return ctx.json({ conversation, messages: created });
        },
      ),

      getConversation: createAuthEndpoint(
        "/support/conversation",
        {
          method: "GET",
          metadata: { $Infer: { query: {} as { conversationId?: string } } },
        },
        async (ctx) => {
          const adapter = ctx.context.adapter;
          const conversationId = ctx.query?.conversationId;

          // Agents may read any conversation by id (needed by the inbox UI).
          const session = await getSessionFromCtx(ctx, { disableRefresh: true });
          const asAgent = !!session?.user && isAgent(readRole(session.user), agentRole);
          if (conversationId && asAgent) {
            const conversation = await findConversationById(adapter, conversationId);
            if (!conversation) return ctx.json({ conversation: null, messages: [] });
            return ctx.json({ conversation, messages: await loadMessages(adapter, conversation.id) });
          }

          const actor = await resolveActor(ctx, allowAnonymous, false);
          if (!actor) return ctx.json({ conversation: null, messages: [] });

          let conversation: SupportConversation | null;
          if (conversationId) {
            conversation = await findConversationById(adapter, conversationId);
            const owns =
              conversation &&
              (actor.kind === "user"
                ? conversation.userId === actor.id
                : conversation.visitorId === actor.id);
            if (!owns) conversation = null;
          } else {
            conversation = await findActorConversation(adapter, actor);
          }

          if (!conversation) return ctx.json({ conversation: null, messages: [] });
          return ctx.json({ conversation, messages: await loadMessages(adapter, conversation.id) });
        },
      ),

      identify: createAuthEndpoint(
        "/support/identify",
        {
          method: "POST",
          metadata: { $Infer: { body: {} as { email: string; name?: string } } },
        },
        async (ctx) => {
          const email = (ctx.body?.email ?? "").trim();
          if (!email) throw new APIError("BAD_REQUEST", { message: "Email is required" });

          const adapter = ctx.context.adapter;
          const actor = await resolveActor(ctx, allowAnonymous, true);
          if (!actor) throw new APIError("UNAUTHORIZED", { message: "No visitor session" });

          let conversation = await findActorConversation(adapter, actor);
          if (!conversation) conversation = await createConversation(adapter, actor, undefined);

          conversation = await updateConversation(
            adapter,
            conversation.id,
            { visitorEmail: email, visitorName: ctx.body?.name ?? conversation.visitorName ?? null },
            false,
            conversation,
          );

          return ctx.json({ conversation });
        },
      ),

      /* ---- agent (role-gated) ------------------------------------------- */
      inbox: createAuthEndpoint(
        "/support/inbox",
        {
          method: "GET",
          use: [sessionMiddleware],
          metadata: {
            $Infer: {
              query: {} as { status?: ConversationStatus; limit?: string; offset?: string },
            },
          },
        },
        async (ctx) => {
          requireAgent(ctx);
          const adapter = ctx.context.adapter;

          const status = ctx.query?.status;
          const where = status ? [{ field: "status", value: status }] : undefined;
          const limitRaw = ctx.query?.limit;
          const limit = limitRaw ? Math.min(Math.max(Number(limitRaw) || 0, 1), 200) : 50;
          const offsetRaw = ctx.query?.offset;
          const offset = offsetRaw ? Math.max(Number(offsetRaw) || 0, 0) : 0;

          const conversations = await adapter.findMany<SupportConversation>({
            model: CONVERSATION,
            where,
            sortBy: { field: "lastMessageAt", direction: "desc" },
            limit,
            offset,
          });
          const total = await adapter.count({ model: CONVERSATION, where });

          const userCache = new Map<string, InboxUser | null>();
          const items: InboxItem[] = [];
          for (const conversation of conversations) {
            const user = await resolveInboxUser(adapter, conversation.userId, userCache);
            const assignedAgent = await resolveInboxUser(
              adapter,
              conversation.assignedAgentId,
              userCache,
            );
            const last = await latestMessage(adapter, conversation.id);
            items.push({
              ...conversation,
              user,
              assignedAgent,
              lastMessagePreview: last ? previewOf(last.body) : null,
              unread: last ? isInbound(last.authorType) && conversation.status !== "closed" : false,
            });
          }

          return ctx.json({ conversations: items, total });
        },
      ),

      stats: createAuthEndpoint(
        "/support/stats",
        {
          method: "GET",
          use: [sessionMiddleware],
        },
        async (ctx) => {
          requireAgent(ctx);
          const adapter = ctx.context.adapter;

          const countStatus = (value: ConversationStatus) =>
            adapter.count({ model: CONVERSATION, where: [{ field: "status", value }] });

          const [open, pending, closed, total] = await Promise.all([
            countStatus("open"),
            countStatus("pending"),
            countStatus("closed"),
            adapter.count({ model: CONVERSATION }),
          ]);

          const stats: SupportStats = { open, pending, closed, total };
          return ctx.json(stats);
        },
      ),

      reply: createAuthEndpoint(
        "/support/reply",
        {
          method: "POST",
          use: [sessionMiddleware],
          metadata: { $Infer: { body: {} as { conversationId: string; body: string } } },
        },
        async (ctx) => {
          const agentId = requireAgent(ctx);
          const adapter = ctx.context.adapter;

          const text = (ctx.body?.body ?? "").trim();
          if (!text) throw new APIError("BAD_REQUEST", { message: "Reply body is required" });
          if (!ctx.body?.conversationId) {
            throw new APIError("BAD_REQUEST", { message: "conversationId is required" });
          }

          const found = await findConversationById(adapter, ctx.body.conversationId);
          if (!found) throw new APIError("NOT_FOUND", { message: "Conversation not found" });

          const message = await insertMessage(adapter, found.id, "agent", agentId, text);
          const conversation = await updateConversation(
            adapter,
            found.id,
            { status: "open", assignedAgentId: found.assignedAgentId ?? agentId },
            true,
            found,
          );

          return ctx.json({ conversation, message });
        },
      ),

      assign: createAuthEndpoint(
        "/support/assign",
        {
          method: "POST",
          use: [sessionMiddleware],
          metadata: { $Infer: { body: {} as { conversationId: string; agentId?: string } } },
        },
        async (ctx) => {
          const agentId = requireAgent(ctx);
          const adapter = ctx.context.adapter;
          if (!ctx.body?.conversationId) {
            throw new APIError("BAD_REQUEST", { message: "conversationId is required" });
          }

          const found = await findConversationById(adapter, ctx.body.conversationId);
          if (!found) throw new APIError("NOT_FOUND", { message: "Conversation not found" });

          const conversation = await updateConversation(
            adapter,
            found.id,
            { assignedAgentId: ctx.body.agentId ?? agentId },
            false,
            found,
          );
          return ctx.json({ conversation });
        },
      ),

      close: createAuthEndpoint(
        "/support/close",
        {
          method: "POST",
          use: [sessionMiddleware],
          metadata: { $Infer: { body: {} as { conversationId: string } } },
        },
        async (ctx) => {
          requireAgent(ctx);
          const adapter = ctx.context.adapter;
          if (!ctx.body?.conversationId) {
            throw new APIError("BAD_REQUEST", { message: "conversationId is required" });
          }

          const found = await findConversationById(adapter, ctx.body.conversationId);
          if (!found) throw new APIError("NOT_FOUND", { message: "Conversation not found" });

          const conversation = await updateConversation(
            adapter,
            found.id,
            { status: "closed" },
            false,
            found,
          );
          return ctx.json({ conversation });
        },
      ),
    },
    rateLimit: [
      { pathMatcher: (path: string) => path === "/support/message", max: 20, window: 60 },
      { pathMatcher: (path: string) => path === "/support/identify", max: 10, window: 60 },
    ],
  } satisfies BetterAuthPlugin;
};

export type SupportPlugin = ReturnType<typeof support>;
