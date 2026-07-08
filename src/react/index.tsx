/**
 * `better-auth-support/react` — headless hook + reference UI.
 *
 * `useSupportChat()` is the headless core (state + poll-based realtime). The
 * `<SupportWidget/>` (floating bubble) and `<AgentInbox/>` components are
 * intentionally minimal and lightly styled so consumers can restyle or replace
 * them. React is the only runtime dependency.
 *
 * All components take a `client` prop — pass your Better Auth client configured
 * with `supportChatClient()`; it structurally satisfies `SupportClient`.
 */
import * as React from "react";

import type {
  ConversationThread,
  InboxItem,
  SendMessageInput,
  SupportClient,
  SupportConversation,
  SupportMessage,
} from "../types.js";

export type {
  ConversationThread,
  InboxItem,
  SupportClient,
  SupportConversation,
  SupportMessage,
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
    const res = await client.getConversation(query);
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
      const res = await client.sendMessage(input);
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

export interface SupportWidgetProps {
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

export function SupportWidget(props: SupportWidgetProps): React.ReactElement {
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
      const res = await client.getConversation({ conversationId });
      if (res.error) {
        setError(res.error.message ?? "Failed to load conversation");
        return;
      }
      setError(null);
      if (res.data) setThread(res.data);
    },
    [client],
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
        This client has no agent actions. Configure <code>supportChatClient()</code> and sign in as
        an agent.
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
