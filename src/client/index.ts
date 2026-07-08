/**
 * `better-auth-support/client` — the Better Auth client plugin.
 *
 * Exposes typed actions on the auth client: `sendMessage`, `getConversation`,
 * a poll-based `subscribe`, `identify`, and the agent namespace
 * (`agent.{inbox,reply,assign,close}`). Types are inferred from the server
 * plugin via `$InferServerPlugin`.
 */
import type { BetterAuthClientPlugin } from "@better-auth/core";

import type { supportChat } from "../server/index.js";
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
  Unsubscribe,
} from "../types.js";

const DEFAULT_POLL_MS = 3000;

export const supportChatClient = () => {
  return {
    id: "support-chat",
    $InferServerPlugin: {} as ReturnType<typeof supportChat>,
    // Force the HTTP method for endpoints the client infers from the server plugin.
    pathMethods: {
      "/support-chat/conversation": "GET",
      "/support-chat/inbox": "GET",
      "/support-chat/message": "POST",
      "/support-chat/identify": "POST",
      "/support-chat/reply": "POST",
      "/support-chat/assign": "POST",
      "/support-chat/close": "POST",
    },
    getActions: ($fetch) => ({
      sendMessage: (input: SendMessageInput) =>
        $fetch<ConversationThread>("/support-chat/message", {
          method: "POST",
          body: input,
        }),

      getConversation: (query?: ConversationQuery) =>
        $fetch<ConversationThread>("/support-chat/conversation", {
          method: "GET",
          query,
        }),

      identify: (input: IdentifyInput) =>
        $fetch<ConversationResult>("/support-chat/identify", {
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
            const res = (await $fetch<ConversationThread>("/support-chat/conversation", {
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
          $fetch<InboxResult>("/support-chat/inbox", { method: "GET", query }),
        reply: (input: ReplyInput) =>
          $fetch<ReplyResult>("/support-chat/reply", { method: "POST", body: input }),
        assign: (input: AssignInput) =>
          $fetch<ConversationResult>("/support-chat/assign", { method: "POST", body: input }),
        close: (input: CloseInput) =>
          $fetch<ConversationResult>("/support-chat/close", { method: "POST", body: input }),
      },
    }),
  } satisfies BetterAuthClientPlugin;
};

export type SupportChatClient = ReturnType<typeof supportChatClient>;
