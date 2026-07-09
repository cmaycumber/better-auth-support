/**
 * Shared, framework-agnostic types for `better-auth-support`.
 *
 * These describe the wire shapes returned by the server endpoints and consumed
 * by the client plugin and the React reference components. They intentionally
 * avoid any dependency on `better-auth` internals so they can be imported from
 * every entry (`/server`, `/client`, `/react`) without leaking server-only
 * types into the browser bundle.
 *
 * Dates cross the wire as ISO strings but are `Date` objects in-process, hence
 * the `string | Date` unions.
 */

export type ConversationStatus = "open" | "pending" | "closed";

/**
 * Who authored a message.
 * - `visitor` — a pre-auth visitor identified by a signed cookie
 * - `user`    — an authenticated Better Auth user
 * - `agent`   — a support agent (a user whose role matches `agentRole`)
 * - `ai`      — the `aiResponder` first-responder
 * - `system`  — automated/system events
 */
export type MessageAuthorType = "visitor" | "user" | "agent" | "ai" | "system";

export interface SupportConversation {
  id: string;
  /** Better Auth user id, when the conversation belongs to a logged-in user. */
  userId?: string | null;
  /** Signed-cookie visitor id, for pre-auth visitors. */
  visitorId?: string | null;
  status: ConversationStatus;
  subject?: string | null;
  /** User id of the agent this conversation is assigned to. */
  assignedAgentId?: string | null;
  /** Contact email captured from an anonymous visitor via `identify`. */
  visitorEmail?: string | null;
  visitorName?: string | null;
  lastMessageAt: string | Date;
  createdAt: string | Date;
}

export interface SupportMessage {
  id: string;
  conversationId: string;
  authorType: MessageAuthorType;
  authorId?: string | null;
  body: string;
  readAt?: string | Date | null;
  createdAt: string | Date;
}

/** A conversation plus its ordered messages — the unit the widget renders. */
export interface ConversationThread {
  conversation: SupportConversation | null;
  messages: SupportMessage[];
}

/** Minimal Better Auth user fields joined into the agent inbox. */
export interface InboxUser {
  id: string;
  email: string;
  name: string;
  role?: string | null;
}

/** A conversation enriched with the Better Auth identity behind it. */
export interface InboxItem extends SupportConversation {
  /** The visitor/user identity behind the conversation, when logged in. */
  user: InboxUser | null;
  /** The agent this conversation is assigned to, resolved from `user`. */
  assignedAgent?: InboxUser | null;
  /** Body of the most recent message, truncated for list previews. */
  lastMessagePreview?: string | null;
  /** True when the latest message is inbound (awaiting an agent reply). */
  unread?: boolean;
}

export interface InboxResult {
  conversations: InboxItem[];
  /** Total conversations matching the filter (for pagination). */
  total?: number;
}

/** Aggregate counts for the dashboard overview row. */
export interface SupportStats {
  open: number;
  pending: number;
  closed: number;
  total: number;
}

export interface ReplyResult {
  conversation: SupportConversation;
  message: SupportMessage;
}

export interface ConversationResult {
  conversation: SupportConversation;
}

/* -------------------------------------------------------------------------- */
/* Request payloads                                                           */
/* -------------------------------------------------------------------------- */

export interface SendMessageInput {
  /** Continue an existing conversation; omit to reuse/open the caller's own. */
  conversationId?: string;
  body: string;
  /** Optional subject, only used when a new conversation is created. */
  subject?: string;
}

export interface ConversationQuery {
  conversationId?: string;
}

export interface IdentifyInput {
  email: string;
  name?: string;
}

export interface InboxQuery {
  status?: ConversationStatus;
  limit?: number;
  /** Number of conversations to skip, for pagination. */
  offset?: number;
}

export interface ReplyInput {
  conversationId: string;
  body: string;
}

export interface AssignInput {
  conversationId: string;
  /** Defaults to the acting agent when omitted. */
  agentId?: string;
}

export interface CloseInput {
  conversationId: string;
}

/* -------------------------------------------------------------------------- */
/* Client surface (structural — matches Better Auth's `$fetch` result shape)  */
/* -------------------------------------------------------------------------- */

/** The `{ data, error }` envelope Better Auth's fetch layer returns. */
export interface FetchResult<T> {
  data: T | null;
  error: {
    message?: string;
    status?: number;
    statusText?: string;
    code?: string;
  } | null;
}

export interface SubscribeOptions {
  conversationId?: string;
  /** Poll cadence in ms (default 3000). */
  intervalMs?: number;
  onThread: (thread: ConversationThread) => void;
  onError?: (error: unknown) => void;
  /** Abort to stop polling (in addition to the returned unsubscribe fn). */
  signal?: AbortSignal;
}

export type Unsubscribe = () => void;

/** Visitor/user chat actions — session or signed visitor cookie. */
export interface SupportChatActions {
  send: (input: SendMessageInput) => Promise<FetchResult<ConversationThread>>;
  conversation: (query?: ConversationQuery) => Promise<FetchResult<ConversationThread>>;
  identify?: (input: IdentifyInput) => Promise<FetchResult<ConversationResult>>;
  subscribe?: (options: SubscribeOptions) => Unsubscribe;
}

/** Agent-only actions, gated server-side by the `agentRole` guard. */
export interface SupportAgentActions {
  inbox: (query?: InboxQuery) => Promise<FetchResult<InboxResult>>;
  conversation: (query: ConversationQuery) => Promise<FetchResult<ConversationThread>>;
  stats: () => Promise<FetchResult<SupportStats>>;
  reply: (input: ReplyInput) => Promise<FetchResult<ReplyResult>>;
  assign: (input: AssignInput) => Promise<FetchResult<ConversationResult>>;
  close: (input: CloseInput) => Promise<FetchResult<ConversationResult>>;
}

/**
 * The structural client shape the React components depend on. Any Better Auth
 * client configured with `supportClient()` satisfies this — the components
 * accept it via a `client` prop so they stay framework-plumbing agnostic.
 *
 * Actions are namespaced: `chat.*` for visitors/users, `agent.*` for agents
 * (present only when the caller is configured as an agent client).
 */
export interface SupportClient {
  chat: SupportChatActions;
  agent?: SupportAgentActions;
}
