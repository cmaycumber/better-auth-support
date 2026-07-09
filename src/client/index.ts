/**
 * `better-auth-support/client` — the Better Auth client plugin.
 *
 * Exposes typed actions on the auth client: `sendMessage`, `getConversation`,
 * a poll-based `subscribe`, `identify`, and the agent namespace
 * (`agent.{inbox,stats,reply,assign,close}`). Types are inferred from the
 * server plugin via `$InferServerPlugin`.
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
      "/support/conversation": "GET",
      "/support/inbox": "GET",
      "/support/stats": "GET",
      "/support/message": "POST",
      "/support/identify": "POST",
      "/support/reply": "POST",
      "/support/assign": "POST",
      "/support/close": "POST",
    },
    getActions: ($fetch) => ({
      sendMessage: (input: SendMessageInput) =>
        $fetch<ConversationThread>("/support/message", {
          method: "POST",
          body: input,
        }),

      getConversation: (query?: ConversationQuery) =>
        $fetch<ConversationThread>("/support/conversation", {
          method: "GET",
          query,
        }),

      identify: (input: IdentifyInput) =>
        $fetch<ConversationResult>("/support/identify", {
          method: "POST",
          body: input,
        }),

      /**
       * Poll-based realtime for v0. Re-fetches the conversation every
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
            const res = (await $fetch<ConversationThread>("/support/conversation", {
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

      agent: {
        inbox: (query?: InboxQuery) =>
          $fetch<InboxResult>("/support/inbox", { method: "GET", query }),
        stats: () => $fetch<SupportStats>("/support/stats", { method: "GET" }),
        reply: (input: ReplyInput) =>
          $fetch<ReplyResult>("/support/reply", { method: "POST", body: input }),
        assign: (input: AssignInput) =>
          $fetch<ConversationResult>("/support/assign", { method: "POST", body: input }),
        close: (input: CloseInput) =>
          $fetch<ConversationResult>("/support/close", { method: "POST", body: input }),
      },
    }),
  } satisfies BetterAuthClientPlugin;
};

export type SupportClientPlugin = ReturnType<typeof supportClient>;
