/**
 * `better-auth-support/client` — the Better Auth client plugin.
 *
 * Exposes two namespaced action groups on the auth client:
 * - `chat.{send,conversation,identify,subscribe}` — visitor/user actions.
 * - `agent.{inbox,conversation,stats,reply,assign,close}` — role-gated agent
 *   actions.
 * Types are inferred from the server plugin via `$InferServerPlugin`.
 */
import type { BetterAuthClientPlugin } from "@better-auth/core";

import type { support } from "../server/index.js";
import type {
  AssignInput,
  CloseInput,
  ConversationQuery,
  ConversationResult,
  ConversationThread,
  FetchResult,
  IdentifyInput,
  InboxQuery,
  InboxResult,
  ReplyInput,
  ReplyResult,
  SendMessageInput,
  SubscribeOptions,
  SupportStats,
  Unsubscribe,
} from "../types.js";

export type {
  AssignInput,
  CloseInput,
  ConversationQuery,
  ConversationResult,
  ConversationThread,
  FetchResult,
  IdentifyInput,
  InboxItem,
  InboxQuery,
  InboxResult,
  ReplyInput,
  ReplyResult,
  SendMessageInput,
  SubscribeOptions,
  SupportAgentActions,
  SupportChatActions,
  SupportClient,
  SupportConversation,
  SupportMessage,
  SupportStats,
  Unsubscribe,
} from "../types.js";

const DEFAULT_POLL_MS = 3000;

export const supportClient = () => {
  return {
    id: "support",
    $InferServerPlugin: {} as ReturnType<typeof support>,
    // Force the HTTP method for endpoints the client infers from the server plugin.
    pathMethods: {
      "/support/chat/conversation": "GET",
      "/support/chat/stream": "GET",
      "/support/chat/message": "POST",
      "/support/chat/identify": "POST",
      "/support/agent/inbox": "GET",
      "/support/agent/conversation": "GET",
      "/support/agent/stats": "GET",
      "/support/agent/reply": "POST",
      "/support/agent/assign": "POST",
      "/support/agent/close": "POST",
    },
    getActions: ($fetch) => ({
      chat: {
        send: (input: SendMessageInput) =>
          $fetch<ConversationThread>("/support/chat/message", {
            method: "POST",
            body: input,
          }),

        conversation: (query?: ConversationQuery) =>
          $fetch<ConversationThread>("/support/chat/conversation", {
            method: "GET",
            query,
          }),

        identify: (input: IdentifyInput) =>
          $fetch<ConversationResult>("/support/chat/identify", {
            method: "POST",
            body: input,
          }),

        /**
         * Poll-based realtime for v0. Polls `/support/chat/stream` every
         * `intervalMs` and calls `onThread` with each snapshot. Returns an
         * unsubscribe function; also honors `options.signal`.
         */
        subscribe: (options: SubscribeOptions): Unsubscribe => {
          const interval = options.intervalMs ?? DEFAULT_POLL_MS;
          let active = true;
          let timer: ReturnType<typeof setTimeout> | undefined;

          const stop: Unsubscribe = () => {
            active = false;
            if (timer !== undefined) clearTimeout(timer);
          };

          const tick = async (): Promise<void> => {
            if (!active) return;
            try {
              const res = (await $fetch<ConversationThread>("/support/chat/stream", {
                method: "GET",
                query: options.conversationId
                  ? { conversationId: options.conversationId }
                  : undefined,
              })) as FetchResult<ConversationThread>;
              if (active && res.data) options.onThread(res.data);
            } catch (error) {
              if (active) options.onError?.(error);
            }
            if (active) timer = setTimeout(() => void tick(), interval);
          };

          void tick();
          options.signal?.addEventListener("abort", stop, { once: true });
          return stop;
        },
      },

      agent: {
        inbox: (query?: InboxQuery) =>
          $fetch<InboxResult>("/support/agent/inbox", { method: "GET", query }),
        conversation: (query?: ConversationQuery) =>
          $fetch<ConversationThread>("/support/agent/conversation", { method: "GET", query }),
        stats: () => $fetch<SupportStats>("/support/agent/stats", { method: "GET" }),
        reply: (input: ReplyInput) =>
          $fetch<ReplyResult>("/support/agent/reply", { method: "POST", body: input }),
        assign: (input: AssignInput) =>
          $fetch<ConversationResult>("/support/agent/assign", { method: "POST", body: input }),
        close: (input: CloseInput) =>
          $fetch<ConversationResult>("/support/agent/close", { method: "POST", body: input }),
      },
    }),
  } satisfies BetterAuthClientPlugin;
};

export type SupportClientPlugin = ReturnType<typeof supportClient>;
