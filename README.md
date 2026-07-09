# better-auth-support

A self-hosted, embeddable **support chat + agent dashboard** that plugs directly into a
[Better Auth](https://better-auth.com) app. Identity, users and agent roles come from Better Auth
itself — no separate user system, no HMAC identity bridge. It composes with the Better Auth
**admin plugin** for agent roles and exposes an **AI-first-responder hook** so an AI agent can answer
first and escalate to a human, with the visitor's email/plan/usage already attached.

- **Headless core** — a Better Auth server plugin + client plugin (endpoints + typed actions).
- **Reference UI** — an unstyled floating `<SupportWidget/>` for visitors and a full two-pane
  `<SupportDashboard/>` support console for agents, React-only.
- **AI-first-responder** — bring your own `aiResponder`; reply to auto-answer, `null` to escalate.
- **Admin-plugin gating** — agent endpoints are role-gated (`agentRole`, default `"admin"`).

> **Status: v0.** The core message / conversation / inbox / stats / reply / assign / close flow,
> admin-role gating, anonymous visitors (signed cookie), and the `aiResponder` hook are fully
> implemented. Realtime is **poll-based** in v0 (see [Caveats](#caveats)). File uploads, a help
> center, canned replies, and typing indicators are out of scope.

MIT © Automatons, LLC.

## Install

```bash
npm install better-auth-support
# peer deps you already have: better-auth (and react, for the /react entry)
```

Sub-path exports:

| Import | What it provides |
| --- | --- |
| `better-auth-support/server` | `support(opts?)` — the Better Auth server plugin + option/model types |
| `better-auth-support/client` | `supportClient()` — the Better Auth client plugin (typed actions) |
| `better-auth-support/react` | `useSupportChat()` + `<SupportWidget/>` (visitor); `useSupportInbox()` + `<SupportDashboard/>` + `<AgentInbox/>` (agent) |

## Quick start

### 1. Server — add the plugin

`support` composes with the `admin` plugin (which supplies the `role` field the agent guard
checks). Add both, then regenerate your schema.

```ts
// src/lib/auth.ts
import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { support } from "better-auth-support/server";

import { myAiResponder } from "@/lib/support/ai-responder";
import { notifyAgents } from "@/lib/support/notify";

export const auth = betterAuth({
  // ...database, emailAndPassword, other plugins...
  plugins: [
    admin(), // provides user.role — the agent guard reads it
    support({
      agentRole: "admin",           // who can use the agent dashboard
      aiResponder: myAiResponder,   // AI answers first; return null to escalate to a human
      notify: { onNewConversation: notifyAgents },
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
import { supportClient } from "better-auth-support/client";

export const authClient = createAuthClient({
  plugins: [supportClient()],
});

// authClient.sendMessage(...), authClient.getConversation(...), authClient.subscribe(...)
// authClient.agent.inbox() / stats() / reply() / assign() / close()
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

Agent-facing console — see [Support dashboard](#support-dashboard):

```tsx
"use client";
import { SupportDashboard } from "better-auth-support/react";
import { authClient } from "@/lib/auth-client";

export default function InboxPage() {
  return <SupportDashboard client={authClient} />;
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
const myAiResponder = async (message: string) => {
  const answer = await assistant.tryAnswer(message); // your AI
  return answer ?? null; // null → escalate to the agent queue
};
```

## Support dashboard

`<SupportDashboard/>` is a full, self-hosted agent console (think of the Better Auth dashboard
plugin, but for support). It is built on the `useSupportInbox()` hook and the agent client actions.

```tsx
"use client";
import { SupportDashboard } from "better-auth-support/react";
import { authClient } from "@/lib/auth-client";

export default function SupportConsole() {
  return <SupportDashboard client={authClient} title="Support" />;
}
```

What it renders:

- **Overview stat row** — open / pending / closed / total conversation counts (from `/support/stats`).
- **Conversation list** — status filter tabs (all / open / pending / closed), an unread indicator
  (the latest message is inbound and awaiting a reply), the visitor's identity/email, a
  last-message preview, and the assigned agent.
- **Conversation thread** — the full message history, a reply composer, and **assign** (to yourself)
  / **close** actions.

It is React-only, inline-styled, and restyle-able:

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `client` | `SupportClient` | — | A client configured with `supportClient()`. |
| `title` | `string` | `"Support"` | Header label. |
| `initialStatus` | `"all" \| "open" \| "pending" \| "closed"` | `"open"` | Initial list filter. |
| `pollIntervalMs` | `number` | `5000` | Refresh cadence for the list, stats, and open thread. |
| `className` | `string` | — | Applied to the root element. |
| `style` | `CSSProperties` | — | Merged onto the root element's inline styles. |
| `theme` | `SupportDashboardTheme` | neutral | `{ accent, background, surface, border, text, mutedText }` color overrides. |

Prefer to build your own console UI? Use the headless hook directly:

```tsx
const {
  items, stats, total, status, setStatus,
  selectedId, select, thread, loading, error, sending,
  reply, assign, close, refresh,
} = useSupportInbox({ client: authClient, pollIntervalMs: 5000 });
```

`<AgentInbox/>` remains available as a minimal two-pane alternative if you don't need the stats row
and status filters.

## Configuration (`SupportOptions`)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `agentRole` | `string` | `"admin"` | Role permitted on the agent endpoints. Checked against `session.user.role` (comma-separated roles supported). Composes with the admin plugin. |
| `aiResponder` | `(msg, ctx) => Promise<string \| null>` | — | AI first-responder. String → auto-reply; `null` → escalate. |
| `notify` | `{ onNewConversation?, onNewMessage? }` | — | Out-of-band agent notifications (email/Slack/Discord/webhook). Failures are logged, never fatal. |
| `realtime` | `"poll" \| "sse"` | `"poll"` | v0 implements polling only; `"sse"` is accepted for forward-compat and currently behaves like `"poll"`. |
| `anonymous` | `boolean` | `true` | Allow pre-auth visitors via a signed cookie (`support_visitor`). |

## Endpoints

Visitor/user (session **or** signed visitor cookie):

- `POST /support/message` — send a message (find-or-create the caller's conversation).
- `GET  /support/conversation` — the caller's conversation + messages.
- `POST /support/identify` — attach an email/name to an anonymous visitor.

Agent (role-gated by `agentRole`):

- `GET  /support/inbox` — conversations joined to the Better Auth `user`, enriched with the assigned
  agent, a last-message preview, and an unread flag. Supports `status` filtering plus `limit`/`offset`
  pagination; returns `{ conversations, total }`.
- `GET  /support/stats` — conversation counts by status (`{ open, pending, closed, total }`).
- `POST /support/reply` — reply (auto-assigns the conversation to the replying agent).
- `POST /support/assign` — assign a conversation to an agent (defaults to self).
- `POST /support/close` — close a conversation.

`/support/message` and `/support/identify` are rate-limited via the plugin's `rateLimit` rules.

## Headless hook

Skip the reference components and build your own visitor UI with `useSupportChat`:

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

For the agent side, use `useSupportInbox` (see [Support dashboard](#support-dashboard)).

## Data model

Two tables are added to your Better Auth schema:

- **`supportConversation`** — `userId?`, `visitorId?`, `status` (`open`|`pending`|`closed`),
  `subject?`, `assignedAgentId?`, `visitorEmail?`, `visitorName?`, `lastMessageAt`, `createdAt`.
- **`supportMessage`** — `conversationId`, `authorType` (`visitor`|`user`|`agent`|`ai`|`system`),
  `authorId?`, `body`, `readAt?`, `createdAt`.

Conversations link to `user.id` so the inbox can join to the user's email/plan/role natively.

## Caveats

- **Realtime is polling in v0.** Clients re-fetch `/support/conversation` (and the dashboard
  re-fetches `/support/inbox` + `/support/stats`) on an interval. This is deliberately
  **serverless-safe** — long-lived SSE connections are awkward on Lambda/SST/Vercel. A pluggable
  SSE + pub-sub (Redis/Ably) transport is planned for self-hosters who can run persistent
  connections; `realtime: "sse"` is reserved for it and currently polls.
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
