# better-auth-support

A self-hosted, embeddable **support chat + agent inbox** that plugs directly into a
[Better Auth](https://better-auth.com) app. Identity, users and agent roles come from Better Auth
itself — no separate user system, no HMAC identity bridge. It composes with the Better Auth
**admin plugin** for agent roles and exposes an **AI-first-responder hook** so an AI agent can answer
first and escalate to a human, with the visitor's email/plan/usage already attached.

- **Headless core** — a Better Auth server plugin + client plugin (endpoints + typed actions).
- **Reference UI** — an unstyled floating `<SupportWidget/>` and an `<AgentInbox/>`, React-only.
- **AI-first-responder** — bring your own `aiResponder`; reply to auto-answer, `null` to escalate.
- **Admin-plugin gating** — agent endpoints are role-gated (`agentRole`, default `"admin"`).

> **Status: v0.** The core message / conversation / inbox / reply / assign / close flow, admin-role
> gating, anonymous visitors (signed cookie), and the `aiResponder` hook are fully implemented and
> tested. Realtime is **poll-based** in v0 (see [Caveats](#caveats)). File uploads, a help center,
> canned replies, and typing indicators are out of scope.

MIT © Automatons, LLC.

## Install

```bash
npm install better-auth-support
# peer deps you already have: better-auth (and react, for the /react entry)
```

Sub-path exports:

| Import | What it provides |
| --- | --- |
| `better-auth-support/server` | `supportChat(opts?)` — the Better Auth server plugin + option/model types |
| `better-auth-support/client` | `supportChatClient()` — the Better Auth client plugin (typed actions) |
| `better-auth-support/react` | `useSupportChat()` hook + `<SupportWidget/>` + `<AgentInbox/>` |

## Quick start

### 1. Server — add the plugin

`supportChat` composes with the `admin` plugin (which supplies the `role` field the agent guard
checks). Add both, then regenerate your schema.

```ts
// src/lib/auth.ts
import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { supportChat } from "better-auth-support/server";

import { tractsAnalyst } from "@/lib/ai/support-analyst";
import { emailFounder } from "@/lib/notify";

export const auth = betterAuth({
  // ...database, emailAndPassword, other plugins...
  plugins: [
    admin(), // provides user.role — the agent guard reads it
    supportChat({
      agentRole: "admin",           // who can use the agent inbox
      aiResponder: tractsAnalyst,   // AI answers first; return null to escalate to a human
      notify: { onNewConversation: emailFounder },
      anonymous: true,              // allow pre-auth visitors via a signed cookie (default)
    }),
    nextCookies(), // must be last
  ],
});
```

Then generate the two new tables (`supportConversation`, `supportMessage`):

```bash
npx @better-auth/cli generate   # or `migrate` for the built-in adapters
```

### 2. Client — add the client plugin

```ts
// src/lib/auth-client.ts
import { createAuthClient } from "better-auth/react";
import { supportChatClient } from "better-auth-support/client";

export const authClient = createAuthClient({
  plugins: [supportChatClient()],
});

// authClient.sendMessage(...), authClient.getConversation(...), authClient.subscribe(...)
// authClient.agent.inbox() / reply() / assign() / close()
```

### 3. UI — drop in the reference widget

```tsx
// app/layout.tsx (or anywhere in your tree)
"use client";
import { SupportWidget } from "better-auth-support/react";
import { authClient } from "@/lib/auth-client";

export function ChatBubble() {
  return <SupportWidget client={authClient} title="Support" accentColor="#2563eb" />;
}
```

Agent-facing page:

```tsx
"use client";
import { AgentInbox } from "better-auth-support/react";
import { authClient } from "@/lib/auth-client";

export default function InboxPage() {
  return <AgentInbox client={authClient} />;
}
```

## The AI-first-responder

`aiResponder(message, ctx) => Promise<string | null>` runs on every inbound message while the
conversation is **unassigned**:

- return a **string** → it's posted as an `authorType: "ai"` message and the visitor gets an
  immediate reply; the conversation stays `open`.
- return **`null`** → the conversation is marked `pending` and your `notify` hooks fire so a human
  can take over.

Once a human agent replies (or the conversation is assigned), the AI responder is skipped — the
human owns the thread.

```ts
const tractsAnalyst = async (message: string) => {
  const answer = await analyst.tryAnswer(message); // your AI
  return answer ?? null; // null → escalate to the founder's inbox
};
```

## Configuration (`SupportChatOptions`)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `agentRole` | `string` | `"admin"` | Role permitted on the agent endpoints. Checked against `session.user.role` (comma-separated roles supported). Composes with the admin plugin. |
| `aiResponder` | `(msg, ctx) => Promise<string \| null>` | — | AI first-responder. String → auto-reply; `null` → escalate. |
| `notify` | `{ onNewConversation?, onNewMessage? }` | — | Out-of-band agent notifications (email/Slack/Discord/webhook). Failures are logged, never fatal. |
| `realtime` | `"poll" \| "sse"` | `"poll"` | v0 implements polling only; `"sse"` is accepted for forward-compat and currently behaves like `"poll"`. |
| `anonymous` | `boolean` | `true` | Allow pre-auth visitors via a signed cookie (`support_visitor`). |

## Endpoints

Visitor/user (session **or** signed visitor cookie):

- `POST /support-chat/message` — send a message (find-or-create the caller's conversation).
- `GET  /support-chat/conversation` — the caller's conversation + messages.
- `POST /support-chat/identify` — attach an email/name to an anonymous visitor.

Agent (role-gated by `agentRole`):

- `GET  /support-chat/inbox` — conversations joined to the Better Auth `user`.
- `POST /support-chat/reply` — reply (auto-assigns the conversation to the replying agent).
- `POST /support-chat/assign` — assign a conversation to an agent (defaults to self).
- `POST /support-chat/close` — close a conversation.

`/support-chat/message` and `/support-chat/identify` are rate-limited via the plugin's `rateLimit`
rules.

## Headless hook

Skip the reference components and build your own UI with `useSupportChat`:

```tsx
const {
  conversation, messages, status, error, sending,
  open, setOpen, sendMessage, refresh,
} = useSupportChat({ client: authClient, pollIntervalMs: 3000 });
```

The client plugin also exposes a poll-based `subscribe`:

```ts
const unsubscribe = authClient.subscribe({
  conversationId,
  intervalMs: 3000,
  onThread: (thread) => render(thread),
});
```

## Data model

Two tables are added to your Better Auth schema:

- **`supportConversation`** — `userId?`, `visitorId?`, `status` (`open`|`pending`|`closed`),
  `subject?`, `assignedAgentId?`, `visitorEmail?`, `visitorName?`, `lastMessageAt`, `createdAt`.
- **`supportMessage`** — `conversationId`, `authorType` (`visitor`|`user`|`agent`|`ai`|`system`),
  `authorId?`, `body`, `readAt?`, `createdAt`.

Conversations link to `user.id` so the inbox can join to the user's email/plan/role natively.

## Caveats

- **Realtime is polling in v0.** Clients re-fetch `/support-chat/conversation` on an interval.
  This is deliberately **serverless-safe** — long-lived SSE connections are awkward on
  Lambda/SST/Vercel. A pluggable SSE + pub-sub (Redis/Ably) transport is planned for self-hosters
  who can run persistent connections; `realtime: "sse"` is reserved for it and currently polls.
- **Admin plugin is a prerequisite** for the default agent gating: it supplies the `user.role`
  field. If you use a different roles mechanism, set `agentRole` to match your role string.
- **Anonymous → user merge** (linking a visitor's history to their account on sign-in) is planned
  for v1; v0 keeps visitor and user conversations separate.
- Out of scope for v0/v1: file uploads, a help center, and campaigns.

## Development

```bash
bun install
bun run typecheck   # tsc --noEmit
bun run build       # tsup -> dist/ (esm + d.ts for all three entries)
```
