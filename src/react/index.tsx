/**
 * `better-auth-support/react` — headless hooks + reference UI.
 *
 * Visitor side: `useSupportChat()` is the headless core (state + poll-based
 * realtime) and `<SupportChatWidget/>` is the floating bubble.
 *
 * Agent side: `useSupportInbox()` is the headless console core and
 * `<SupportDashboard/>` is a full two-pane support console (list + thread +
 * stats + assign/close). `<AgentInbox/>` remains as a minimal alternative.
 *
 * Every component is intentionally lightly/inline-styled so consumers can
 * restyle via `className`/`theme` props or replace them outright. React is the
 * only runtime dependency.
 *
 * All components take a `client` prop — pass your Better Auth client configured
 * with `supportClient()`; it structurally satisfies `SupportClient`.
 */
import * as React from "react";

import type {
  ConversationStatus,
  ConversationThread,
  InboxItem,
  SendMessageInput,
  SupportClient,
  SupportConversation,
  SupportMessage,
  SupportStats,
} from "../types.js";

export type {
  ConversationStatus,
  ConversationThread,
  InboxItem,
  SupportClient,
  SupportConversation,
  SupportMessage,
  SupportStats,
} from "../types.js";

const DEFAULT_POLL_MS = 3000;

/* -------------------------------------------------------------------------- */
/* Headless hook                                                              */
/* -------------------------------------------------------------------------- */

export type SupportChatStatus = "idle" | "loading" | "ready" | "error";

export interface UseSupportChatOptions {
  client: SupportClient;
  /** Pin to a specific conversation; otherwise the caller's own is used. */
  conversationId?: string;
  /** Poll cadence in ms (default 3000). */
  pollIntervalMs?: number;
  /**
   * Start polling immediately instead of only while `open` is true. Useful for
   * fully custom UIs that don't use the widget's open/close state.
   */
  autoStart?: boolean;
}

export interface UseSupportChatResult {
  conversation: SupportConversation | null;
  messages: SupportMessage[];
  status: SupportChatStatus;
  error: string | null;
  sending: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
  sendMessage: (body: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useSupportChat(options: UseSupportChatOptions): UseSupportChatResult {
  const { client, pollIntervalMs = DEFAULT_POLL_MS, autoStart = false } = options;

  const [open, setOpen] = React.useState(false);
  const [conversation, setConversation] = React.useState<SupportConversation | null>(null);
  const [messages, setMessages] = React.useState<SupportMessage[]>([]);
  const [status, setStatus] = React.useState<SupportChatStatus>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [sending, setSending] = React.useState(false);

  const conversationIdRef = React.useRef<string | undefined>(options.conversationId);

  const applyThread = React.useCallback((thread: ConversationThread) => {
    if (thread.conversation) {
      setConversation(thread.conversation);
      conversationIdRef.current = thread.conversation.id;
    }
    setMessages(thread.messages);
  }, []);

  const refresh = React.useCallback(async () => {
    setStatus((prev) => (prev === "idle" ? "loading" : prev));
    const query = conversationIdRef.current
      ? { conversationId: conversationIdRef.current }
      : undefined;
    const res = await client.chat.conversation(query);
    if (res.error) {
      setError(res.error.message ?? "Failed to load conversation");
      setStatus("error");
      return;
    }
    if (res.data) applyThread(res.data);
    setError(null);
    setStatus("ready");
  }, [client, applyThread]);

  const sendMessage = React.useCallback(
    async (body: string) => {
      const text = body.trim();
      if (!text) return;
      setSending(true);
      const input: SendMessageInput = { body: text };
      if (conversationIdRef.current) input.conversationId = conversationIdRef.current;
      const res = await client.chat.send(input);
      setSending(false);
      if (res.error) {
        setError(res.error.message ?? "Failed to send message");
        return;
      }
      if (res.data) applyThread(res.data);
      setError(null);
      setStatus("ready");
    },
    [client, applyThread],
  );

  React.useEffect(() => {
    if (!autoStart && !open) return;
    let cancelled = false;
    void refresh();
    const id = setInterval(() => {
      if (!cancelled) void refresh();
    }, pollIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [autoStart, open, pollIntervalMs, refresh]);

  return {
    conversation,
    messages,
    status,
    error,
    sending,
    open,
    setOpen,
    sendMessage,
    refresh,
  };
}

/* -------------------------------------------------------------------------- */
/* Reference widget                                                           */
/* -------------------------------------------------------------------------- */

export interface SupportChatWidgetProps {
  client: SupportClient;
  title?: string;
  greeting?: string;
  placeholder?: string;
  pollIntervalMs?: number;
  /** Accent color for the bubble and outbound messages. */
  accentColor?: string;
}

const bubbleStyle = (accent: string): React.CSSProperties => ({
  position: "fixed",
  right: 20,
  bottom: 20,
  width: 56,
  height: 56,
  borderRadius: "50%",
  border: "none",
  background: accent,
  color: "#fff",
  fontSize: 24,
  cursor: "pointer",
  boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
  zIndex: 2147483000,
});

const panelStyle: React.CSSProperties = {
  position: "fixed",
  right: 20,
  bottom: 88,
  width: 340,
  maxHeight: 480,
  display: "flex",
  flexDirection: "column",
  background: "#fff",
  color: "#111",
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  boxShadow: "0 12px 32px rgba(0,0,0,0.18)",
  overflow: "hidden",
  zIndex: 2147483000,
  fontFamily: "system-ui, sans-serif",
  fontSize: 14,
};

function authorLabel(authorType: SupportMessage["authorType"]): string {
  if (authorType === "agent") return "Support";
  if (authorType === "ai") return "Assistant";
  if (authorType === "system") return "System";
  return "You";
}

function isOutbound(authorType: SupportMessage["authorType"]): boolean {
  return authorType === "user" || authorType === "visitor";
}

export function SupportChatWidget(props: SupportChatWidgetProps): React.ReactElement {
  const {
    client,
    title = "Support",
    greeting = "Hi! How can we help?",
    placeholder = "Type a message…",
    pollIntervalMs,
    accentColor = "#2563eb",
  } = props;

  const chat = useSupportChat({ client, ...(pollIntervalMs ? { pollIntervalMs } : {}) });
  const [draft, setDraft] = React.useState("");
  const listRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages]);

  const submit = React.useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const text = draft.trim();
      if (!text || chat.sending) return;
      setDraft("");
      await chat.sendMessage(text);
    },
    [draft, chat],
  );

  if (!chat.open) {
    return (
      <button
        type="button"
        aria-label="Open support chat"
        style={bubbleStyle(accentColor)}
        onClick={() => chat.setOpen(true)}
      >
        {"\u{1F4AC}"}
      </button>
    );
  }

  return (
    <div style={panelStyle} role="dialog" aria-label={title}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 14px",
          background: accentColor,
          color: "#fff",
        }}
      >
        <strong>{title}</strong>
        <button
          type="button"
          aria-label="Close support chat"
          onClick={() => chat.setOpen(false)}
          style={{
            border: "none",
            background: "transparent",
            color: "#fff",
            fontSize: 18,
            cursor: "pointer",
          }}
        >
          {"×"}
        </button>
      </div>

      <div ref={listRef} style={{ flex: 1, overflowY: "auto", padding: 12, minHeight: 160 }}>
        {chat.messages.length === 0 ? (
          <p style={{ color: "#6b7280", margin: 0 }}>{greeting}</p>
        ) : (
          chat.messages.map((message) => {
            const outbound = isOutbound(message.authorType);
            return (
              <div
                key={message.id}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: outbound ? "flex-end" : "flex-start",
                  marginBottom: 10,
                }}
              >
                <span style={{ fontSize: 11, color: "#9ca3af", marginBottom: 2 }}>
                  {authorLabel(message.authorType)}
                </span>
                <span
                  style={{
                    maxWidth: "80%",
                    padding: "8px 10px",
                    borderRadius: 10,
                    background: outbound ? accentColor : "#f3f4f6",
                    color: outbound ? "#fff" : "#111",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {message.body}
                </span>
              </div>
            );
          })
        )}
      </div>

      {chat.error ? (
        <div style={{ padding: "6px 12px", color: "#b91c1c", fontSize: 12 }}>{chat.error}</div>
      ) : null}

      <form
        onSubmit={submit}
        style={{ display: "flex", gap: 8, padding: 10, borderTop: "1px solid #e5e7eb" }}
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={placeholder}
          aria-label="Message"
          style={{
            flex: 1,
            padding: "8px 10px",
            border: "1px solid #d1d5db",
            borderRadius: 8,
            fontSize: 14,
          }}
        />
        <button
          type="submit"
          disabled={chat.sending || draft.trim().length === 0}
          style={{
            border: "none",
            borderRadius: 8,
            padding: "0 14px",
            background: accentColor,
            color: "#fff",
            cursor: "pointer",
            opacity: chat.sending || draft.trim().length === 0 ? 0.6 : 1,
          }}
        >
          {chat.sending ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Reference agent inbox                                                      */
/* -------------------------------------------------------------------------- */

export interface AgentInboxProps {
  /** Must be a client whose plugin exposes the `agent` namespace. */
  client: SupportClient;
  pollIntervalMs?: number;
}

export function AgentInbox(props: AgentInboxProps): React.ReactElement {
  const { client, pollIntervalMs = 5000 } = props;
  const agent = client.agent;

  const [items, setItems] = React.useState<InboxItem[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [thread, setThread] = React.useState<ConversationThread | null>(null);
  const [draft, setDraft] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const loadInbox = React.useCallback(async () => {
    if (!agent) return;
    const res = await agent.inbox();
    if (res.error) {
      setError(res.error.message ?? "Failed to load inbox");
      return;
    }
    setError(null);
    if (res.data) setItems(res.data.conversations);
  }, [agent]);

  const loadThread = React.useCallback(
    async (conversationId: string) => {
      if (!agent) return;
      const res = await agent.conversation({ conversationId });
      if (res.error) {
        setError(res.error.message ?? "Failed to load conversation");
        return;
      }
      setError(null);
      if (res.data) setThread(res.data);
    },
    [agent],
  );

  React.useEffect(() => {
    void loadInbox();
    const id = setInterval(() => void loadInbox(), pollIntervalMs);
    return () => clearInterval(id);
  }, [loadInbox, pollIntervalMs]);

  React.useEffect(() => {
    if (!selectedId) return;
    void loadThread(selectedId);
    const id = setInterval(() => void loadThread(selectedId), pollIntervalMs);
    return () => clearInterval(id);
  }, [selectedId, loadThread, pollIntervalMs]);

  const sendReply = React.useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const text = draft.trim();
      if (!text || !agent || !selectedId) return;
      setDraft("");
      const res = await agent.reply({ conversationId: selectedId, body: text });
      if (res.error) {
        setError(res.error.message ?? "Failed to send reply");
        return;
      }
      setError(null);
      await loadThread(selectedId);
    },
    [draft, agent, selectedId, loadThread],
  );

  const closeConversation = React.useCallback(async () => {
    if (!agent || !selectedId) return;
    const res = await agent.close({ conversationId: selectedId });
    if (res.error) {
      setError(res.error.message ?? "Failed to close conversation");
      return;
    }
    setError(null);
    await loadInbox();
    await loadThread(selectedId);
  }, [agent, selectedId, loadInbox, loadThread]);

  if (!agent) {
    return (
      <div style={{ padding: 16, fontFamily: "system-ui, sans-serif" }}>
        This client has no agent actions. Configure <code>supportClient()</code> and sign in as an
        agent.
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        height: "100%",
        minHeight: 400,
        fontFamily: "system-ui, sans-serif",
        fontSize: 14,
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <div style={{ width: 260, borderRight: "1px solid #e5e7eb", overflowY: "auto" }}>
        <div style={{ padding: "10px 12px", fontWeight: 600, borderBottom: "1px solid #e5e7eb" }}>
          Inbox
        </div>
        {items.length === 0 ? (
          <div style={{ padding: 12, color: "#6b7280" }}>No conversations yet.</div>
        ) : (
          items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelectedId(item.id)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "10px 12px",
                border: "none",
                borderBottom: "1px solid #f3f4f6",
                background: item.id === selectedId ? "#eff6ff" : "transparent",
                cursor: "pointer",
              }}
            >
              <div style={{ fontWeight: 600 }}>
                {item.user?.email || item.visitorEmail || item.visitorId || "Visitor"}
              </div>
              <div style={{ fontSize: 12, color: "#6b7280" }}>
                {item.status}
                {item.subject ? ` · ${item.subject}` : ""}
              </div>
            </button>
          ))
        )}
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        {error ? (
          <div style={{ padding: "6px 12px", color: "#b91c1c", fontSize: 12 }}>{error}</div>
        ) : null}

        {!selectedId || !thread?.conversation ? (
          <div style={{ padding: 16, color: "#6b7280" }}>Select a conversation.</div>
        ) : (
          <>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "10px 12px",
                borderBottom: "1px solid #e5e7eb",
              }}
            >
              <strong>
                {thread.conversation.subject || thread.conversation.visitorEmail || "Conversation"}
              </strong>
              <button
                type="button"
                onClick={() => void closeConversation()}
                style={{
                  border: "1px solid #d1d5db",
                  borderRadius: 6,
                  background: "#fff",
                  padding: "4px 10px",
                  cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
              {thread.messages.map((message) => {
                const fromAgent = message.authorType === "agent" || message.authorType === "ai";
                return (
                  <div
                    key={message.id}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: fromAgent ? "flex-end" : "flex-start",
                      marginBottom: 10,
                    }}
                  >
                    <span style={{ fontSize: 11, color: "#9ca3af" }}>{message.authorType}</span>
                    <span
                      style={{
                        maxWidth: "75%",
                        padding: "8px 10px",
                        borderRadius: 10,
                        background: fromAgent ? "#2563eb" : "#f3f4f6",
                        color: fromAgent ? "#fff" : "#111",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {message.body}
                    </span>
                  </div>
                );
              })}
            </div>

            <form
              onSubmit={sendReply}
              style={{ display: "flex", gap: 8, padding: 10, borderTop: "1px solid #e5e7eb" }}
            >
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Reply…"
                aria-label="Reply"
                style={{
                  flex: 1,
                  padding: "8px 10px",
                  border: "1px solid #d1d5db",
                  borderRadius: 8,
                }}
              />
              <button
                type="submit"
                disabled={draft.trim().length === 0}
                style={{
                  border: "none",
                  borderRadius: 8,
                  padding: "0 14px",
                  background: "#2563eb",
                  color: "#fff",
                  cursor: "pointer",
                  opacity: draft.trim().length === 0 ? 0.6 : 1,
                }}
              >
                Send
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Agent-side headless hook                                                   */
/* -------------------------------------------------------------------------- */

/** Inbox status filter — the three conversation statuses plus `"all"`. */
export type InboxStatusFilter = ConversationStatus | "all";

export interface UseSupportInboxOptions {
  /** A Better Auth client whose plugin exposes the `agent` namespace. */
  client: SupportClient;
  /** Initial status filter (default `"open"`). */
  status?: InboxStatusFilter;
  /** Poll cadence in ms for the list + stats + open thread (default 5000). */
  pollIntervalMs?: number;
  /** Conversations to request per page (default 50). */
  pageSize?: number;
}

export interface UseSupportInboxResult {
  items: InboxItem[];
  stats: SupportStats | null;
  /** Total conversations matching the current filter (for pagination). */
  total: number;
  status: InboxStatusFilter;
  setStatus: (status: InboxStatusFilter) => void;
  selectedId: string | null;
  /** Select a conversation to load its thread (pass `null` to clear). */
  select: (conversationId: string | null) => void;
  thread: ConversationThread | null;
  loading: boolean;
  error: string | null;
  sending: boolean;
  reply: (body: string) => Promise<void>;
  /** Assign the selected conversation (defaults to the acting agent). */
  assign: (agentId?: string) => Promise<void>;
  close: () => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * Headless core for the agent console: loads the inbox + overview stats,
 * tracks the selected conversation's thread, and exposes reply/assign/close.
 * Poll-based like the visitor hook. `<SupportDashboard/>` is built on it.
 */
export function useSupportInbox(options: UseSupportInboxOptions): UseSupportInboxResult {
  const { client, pollIntervalMs = 5000, pageSize = 50 } = options;
  const agent = client.agent;

  const [items, setItems] = React.useState<InboxItem[]>([]);
  const [stats, setStats] = React.useState<SupportStats | null>(null);
  const [total, setTotal] = React.useState(0);
  const [status, setStatus] = React.useState<InboxStatusFilter>(options.status ?? "open");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [thread, setThread] = React.useState<ConversationThread | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sending, setSending] = React.useState(false);

  const loadInbox = React.useCallback(async () => {
    if (!agent) return;
    setLoading(true);
    const query = status === "all" ? { limit: pageSize } : { status, limit: pageSize };
    const res = await agent.inbox(query);
    setLoading(false);
    if (res.error) {
      setError(res.error.message ?? "Failed to load inbox");
      return;
    }
    setError(null);
    if (res.data) {
      setItems(res.data.conversations);
      setTotal(res.data.total ?? res.data.conversations.length);
    }
  }, [agent, status, pageSize]);

  const loadStats = React.useCallback(async () => {
    if (!agent) return;
    const res = await agent.stats();
    if (res.data) setStats(res.data);
  }, [agent]);

  const loadThread = React.useCallback(
    async (conversationId: string) => {
      if (!agent) return;
      const res = await agent.conversation({ conversationId });
      if (res.error) {
        setError(res.error.message ?? "Failed to load conversation");
        return;
      }
      setError(null);
      if (res.data) setThread(res.data);
    },
    [agent],
  );

  const refresh = React.useCallback(async () => {
    await Promise.all([loadInbox(), loadStats()]);
  }, [loadInbox, loadStats]);

  const select = React.useCallback((conversationId: string | null) => {
    setSelectedId(conversationId);
    if (!conversationId) setThread(null);
  }, []);

  React.useEffect(() => {
    void loadInbox();
    void loadStats();
    const id = setInterval(() => {
      void loadInbox();
      void loadStats();
    }, pollIntervalMs);
    return () => clearInterval(id);
  }, [loadInbox, loadStats, pollIntervalMs]);

  React.useEffect(() => {
    if (!selectedId) return;
    void loadThread(selectedId);
    const id = setInterval(() => void loadThread(selectedId), pollIntervalMs);
    return () => clearInterval(id);
  }, [selectedId, loadThread, pollIntervalMs]);

  const reply = React.useCallback(
    async (body: string) => {
      const text = body.trim();
      if (!text || !agent || !selectedId) return;
      setSending(true);
      const res = await agent.reply({ conversationId: selectedId, body: text });
      setSending(false);
      if (res.error) {
        setError(res.error.message ?? "Failed to send reply");
        return;
      }
      setError(null);
      await loadThread(selectedId);
      await loadInbox();
    },
    [agent, selectedId, loadThread, loadInbox],
  );

  const assign = React.useCallback(
    async (agentId?: string) => {
      if (!agent || !selectedId) return;
      const res = await agent.assign(
        agentId ? { conversationId: selectedId, agentId } : { conversationId: selectedId },
      );
      if (res.error) {
        setError(res.error.message ?? "Failed to assign conversation");
        return;
      }
      setError(null);
      await loadThread(selectedId);
      await loadInbox();
    },
    [agent, selectedId, loadThread, loadInbox],
  );

  const close = React.useCallback(async () => {
    if (!agent || !selectedId) return;
    const res = await agent.close({ conversationId: selectedId });
    if (res.error) {
      setError(res.error.message ?? "Failed to close conversation");
      return;
    }
    setError(null);
    await loadThread(selectedId);
    await loadInbox();
    await loadStats();
  }, [agent, selectedId, loadThread, loadInbox, loadStats]);

  return {
    items,
    stats,
    total,
    status,
    setStatus,
    selectedId,
    select,
    thread,
    loading,
    error,
    sending,
    reply,
    assign,
    close,
    refresh,
  };
}

/* -------------------------------------------------------------------------- */
/* Support dashboard (full agent console)                                     */
/* -------------------------------------------------------------------------- */

/** Restyle hooks for `<SupportDashboard/>`. All optional; defaults are neutral. */
export interface SupportDashboardTheme {
  accent?: string;
  background?: string;
  surface?: string;
  border?: string;
  text?: string;
  mutedText?: string;
}

export interface SupportDashboardProps {
  /** A Better Auth client whose plugin exposes the `agent` namespace. */
  client: SupportClient;
  title?: string;
  pollIntervalMs?: number;
  /** Initial status filter (default `"open"`). */
  initialStatus?: InboxStatusFilter;
  /** Applied to the root element for external styling. */
  className?: string;
  /** Merged onto the root element's inline styles. */
  style?: React.CSSProperties;
  /** Color overrides; merged over the neutral defaults. */
  theme?: SupportDashboardTheme;
}

const DEFAULT_DASHBOARD_THEME: Required<SupportDashboardTheme> = {
  accent: "#2563eb",
  background: "#f9fafb",
  surface: "#ffffff",
  border: "#e5e7eb",
  text: "#111827",
  mutedText: "#6b7280",
};

const STATUS_FILTERS: InboxStatusFilter[] = ["all", "open", "pending", "closed"];

function inboxIdentity(item: InboxItem): string {
  return (
    item.user?.email ||
    item.user?.name ||
    item.visitorEmail ||
    item.visitorName ||
    item.visitorId ||
    "Anonymous visitor"
  );
}

function assignedAgentLabel(item: InboxItem): string | null {
  if (!item.assignedAgentId) return null;
  return item.assignedAgent?.name || item.assignedAgent?.email || "an agent";
}

function statusColor(status: ConversationStatus, theme: Required<SupportDashboardTheme>): string {
  if (status === "open") return theme.accent;
  if (status === "pending") return "#d97706";
  return theme.mutedText;
}

export function SupportDashboard(props: SupportDashboardProps): React.ReactElement {
  const { client, title = "Support", pollIntervalMs, initialStatus, className, style } = props;
  const theme = { ...DEFAULT_DASHBOARD_THEME, ...props.theme };

  const inbox = useSupportInbox({
    client,
    ...(pollIntervalMs ? { pollIntervalMs } : {}),
    ...(initialStatus ? { status: initialStatus } : {}),
  });

  const [draft, setDraft] = React.useState("");
  const listRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [inbox.thread]);

  const submitReply = React.useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const text = draft.trim();
      if (!text || inbox.sending) return;
      setDraft("");
      await inbox.reply(text);
    },
    [draft, inbox],
  );

  if (!client.agent) {
    return (
      <div
        className={className}
        style={{
          padding: 16,
          fontFamily: "system-ui, sans-serif",
          color: theme.text,
          ...style,
        }}
      >
        This client has no agent actions. Configure <code>supportClient()</code> and sign in as an
        agent.
      </div>
    );
  }

  const conversation = inbox.thread?.conversation ?? null;
  const stat = (label: string, value: number | string, color: string) => (
    <div
      key={label}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        padding: "6px 14px 6px 0",
        marginRight: 14,
        borderRight: `1px solid ${theme.border}`,
      }}
    >
      <span style={{ fontSize: 20, fontWeight: 700, color }}>{value}</span>
      <span style={{ fontSize: 11, textTransform: "uppercase", color: theme.mutedText }}>
        {label}
      </span>
    </div>
  );

  return (
    <div
      className={className}
      role="region"
      aria-label={`${title} dashboard`}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 480,
        fontFamily: "system-ui, sans-serif",
        fontSize: 14,
        color: theme.text,
        background: theme.background,
        border: `1px solid ${theme.border}`,
        borderRadius: 10,
        overflow: "hidden",
        ...style,
      }}
    >
      {/* Overview / stat row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "12px 16px",
          background: theme.surface,
          borderBottom: `1px solid ${theme.border}`,
        }}
      >
        <strong style={{ fontSize: 15, marginRight: 20 }}>{title}</strong>
        {stat("Open", inbox.stats?.open ?? "–", theme.accent)}
        {stat("Pending", inbox.stats?.pending ?? "–", "#d97706")}
        {stat("Closed", inbox.stats?.closed ?? "–", theme.mutedText)}
        {stat("Total", inbox.stats?.total ?? "–", theme.text)}
      </div>

      {inbox.error ? (
        <div
          role="alert"
          style={{ padding: "6px 16px", color: "#b91c1c", fontSize: 12, background: theme.surface }}
        >
          {inbox.error}
        </div>
      ) : null}

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* Conversation list pane */}
        <div
          style={{
            width: 300,
            display: "flex",
            flexDirection: "column",
            borderRight: `1px solid ${theme.border}`,
            background: theme.surface,
          }}
        >
          <div
            role="tablist"
            aria-label="Filter conversations by status"
            style={{ display: "flex", gap: 4, padding: 8, borderBottom: `1px solid ${theme.border}` }}
          >
            {STATUS_FILTERS.map((filter) => {
              const active = inbox.status === filter;
              return (
                <button
                  key={filter}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => inbox.setStatus(filter)}
                  style={{
                    flex: 1,
                    padding: "5px 8px",
                    fontSize: 12,
                    textTransform: "capitalize",
                    border: "none",
                    borderRadius: 6,
                    cursor: "pointer",
                    background: active ? theme.accent : "transparent",
                    color: active ? "#fff" : theme.mutedText,
                    fontWeight: active ? 600 : 400,
                  }}
                >
                  {filter}
                </button>
              );
            })}
          </div>

          <div style={{ flex: 1, overflowY: "auto" }} aria-busy={inbox.loading}>
            <div
              style={{
                padding: "6px 12px",
                fontSize: 11,
                color: theme.mutedText,
                borderBottom: `1px solid ${theme.border}`,
              }}
            >
              {inbox.items.length} of {inbox.total}
            </div>
            {inbox.items.length === 0 ? (
              <div style={{ padding: 14, color: theme.mutedText }}>No conversations.</div>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {inbox.items.map((item) => {
                  const selected = item.id === inbox.selectedId;
                  const agentLabel = assignedAgentLabel(item);
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        aria-current={selected}
                        onClick={() => inbox.select(item.id)}
                        style={{
                          display: "block",
                          width: "100%",
                          textAlign: "left",
                          padding: "10px 12px",
                          border: "none",
                          borderLeft: `3px solid ${selected ? theme.accent : "transparent"}`,
                          borderBottom: `1px solid ${theme.border}`,
                          background: selected ? "#eff6ff" : "transparent",
                          cursor: "pointer",
                          color: theme.text,
                        }}
                      >
                        <div
                          style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}
                        >
                          {item.unread ? (
                            <span
                              aria-label="Unread"
                              title="Awaiting reply"
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: "50%",
                                background: theme.accent,
                                flex: "0 0 auto",
                              }}
                            />
                          ) : null}
                          <span
                            style={{
                              fontWeight: item.unread ? 700 : 600,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {inboxIdentity(item)}
                          </span>
                        </div>
                        {item.lastMessagePreview ? (
                          <div
                            style={{
                              fontSize: 12,
                              color: theme.mutedText,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {item.lastMessagePreview}
                          </div>
                        ) : null}
                        <div style={{ display: "flex", gap: 6, marginTop: 4, fontSize: 11 }}>
                          <span
                            style={{
                              color: "#fff",
                              background: statusColor(item.status, theme),
                              borderRadius: 4,
                              padding: "1px 6px",
                              textTransform: "capitalize",
                            }}
                          >
                            {item.status}
                          </span>
                          {agentLabel ? (
                            <span style={{ color: theme.mutedText }}>· {agentLabel}</span>
                          ) : null}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Thread pane */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          {!conversation ? (
            <div style={{ padding: 20, color: theme.mutedText }}>
              Select a conversation to view the thread.
            </div>
          ) : (
            <>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 14px",
                  background: theme.surface,
                  borderBottom: `1px solid ${theme.border}`,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 600,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {conversation.subject || conversation.visitorEmail || "Conversation"}
                  </div>
                  <div style={{ fontSize: 12, color: theme.mutedText }}>
                    {conversation.status}
                    {conversation.assignedAgentId ? " · assigned" : " · unassigned"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flex: "0 0 auto" }}>
                  <button
                    type="button"
                    onClick={() => void inbox.assign()}
                    style={{
                      border: `1px solid ${theme.border}`,
                      borderRadius: 6,
                      background: theme.surface,
                      color: theme.text,
                      padding: "4px 10px",
                      cursor: "pointer",
                    }}
                  >
                    Assign to me
                  </button>
                  <button
                    type="button"
                    onClick={() => void inbox.close()}
                    disabled={conversation.status === "closed"}
                    style={{
                      border: `1px solid ${theme.border}`,
                      borderRadius: 6,
                      background: theme.surface,
                      color: theme.text,
                      padding: "4px 10px",
                      cursor: conversation.status === "closed" ? "default" : "pointer",
                      opacity: conversation.status === "closed" ? 0.5 : 1,
                    }}
                  >
                    Close
                  </button>
                </div>
              </div>

              <div ref={listRef} style={{ flex: 1, overflowY: "auto", padding: 14 }}>
                {inbox.thread?.messages.map((message) => {
                  const fromAgentSide =
                    message.authorType === "agent" || message.authorType === "ai";
                  return (
                    <div
                      key={message.id}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: fromAgentSide ? "flex-end" : "flex-start",
                        marginBottom: 10,
                      }}
                    >
                      <span style={{ fontSize: 11, color: theme.mutedText, marginBottom: 2 }}>
                        {message.authorType}
                      </span>
                      <span
                        style={{
                          maxWidth: "75%",
                          padding: "8px 10px",
                          borderRadius: 10,
                          background: fromAgentSide ? theme.accent : "#f3f4f6",
                          color: fromAgentSide ? "#fff" : "#111",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                        }}
                      >
                        {message.body}
                      </span>
                    </div>
                  );
                })}
              </div>

              <form
                onSubmit={submitReply}
                style={{
                  display: "flex",
                  gap: 8,
                  padding: 10,
                  background: theme.surface,
                  borderTop: `1px solid ${theme.border}`,
                }}
              >
                <input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Reply to the customer…"
                  aria-label="Reply"
                  style={{
                    flex: 1,
                    padding: "8px 10px",
                    border: `1px solid ${theme.border}`,
                    borderRadius: 8,
                    fontSize: 14,
                    color: theme.text,
                  }}
                />
                <button
                  type="submit"
                  disabled={inbox.sending || draft.trim().length === 0}
                  style={{
                    border: "none",
                    borderRadius: 8,
                    padding: "0 16px",
                    background: theme.accent,
                    color: "#fff",
                    cursor: "pointer",
                    opacity: inbox.sending || draft.trim().length === 0 ? 0.6 : 1,
                  }}
                >
                  {inbox.sending ? "…" : "Send"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
