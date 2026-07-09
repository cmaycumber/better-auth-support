/**
 * End-to-end human-support-flow smoke test (no test framework, run with Bun).
 *
 *   bun scripts/human-flow.ts
 *
 * Spins up a real Better Auth instance backed by the in-memory adapter with the
 * `admin`, `support` (NO `aiResponder` — human-first default) and `test-utils`
 * plugins, then drives the whole flow through the actual plugin endpoints:
 *
 *   1. Visitor sends a message  → conversation is created as `open` (human-first)
 *   2. Agent inbox              → the conversation shows up, unread, awaiting reply
 *   3. Agent replies            → stored as `authorType: "agent"`, conversation assigned
 *   4. Visitor polls the stream → the agent's reply is returned to the widget
 *   5. Agent closes             → conversation transitions to `closed`
 *
 * A second, compact scenario confirms the opt-in `aiResponder` still works
 * (auto-answer keeps `open`; `null` escalates to `pending`).
 *
 * Exits non-zero on the first failed assertion.
 */
import { betterAuth } from "better-auth";
import { admin, testUtils } from "better-auth/plugins";
import { memoryAdapter } from "better-auth/adapters/memory";

import { support } from "../src/server/index.ts";
import type { GenericEndpointContext } from "@better-auth/core";

/* --------------------------------- helpers -------------------------------- */

let passed = 0;
function assert(cond: unknown, message: string): void {
  if (!cond) {
    console.error(`\x1b[31m✗ FAIL:\x1b[0m ${message}`);
    process.exit(1);
  }
  passed += 1;
  console.log(`\x1b[32m✓\x1b[0m ${message}`);
}

/** Replay every Set-Cookie from a response as a single request Cookie header. */
function setCookiesFrom(headers: Headers): string[] {
  const anyHeaders = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof anyHeaders.getSetCookie === "function") return anyHeaders.getSetCookie();
  const raw = headers.get("set-cookie");
  return raw ? [raw] : [];
}
function toCookieHeader(setCookies: string[]): string {
  return setCookies
    .map((c) => c.split(";")[0]?.trim())
    .filter((v): v is string => Boolean(v))
    .join("; ");
}

function makeAuth(opts: Parameters<typeof support>[0] = {}) {
  // The in-memory adapter reads tables eagerly, so seed every model the flow
  // touches (core Better Auth tables + the two support tables).
  const db: Record<string, unknown[]> = {
    user: [],
    session: [],
    account: [],
    verification: [],
    supportConversation: [],
    supportMessage: [],
  };
  return betterAuth({
    baseURL: "http://localhost:3000",
    secret: "human-flow-test-secret-please-ignore-0000",
    database: memoryAdapter(db),
    emailAndPassword: { enabled: true },
    plugins: [admin(), support(opts), testUtils()],
  });
}

async function makeAgent(auth: ReturnType<typeof makeAuth>): Promise<Headers> {
  const ctx = await auth.$context;
  const test = (ctx as unknown as { test: any }).test;
  const user = test.createUser({
    email: "agent@example.com",
    name: "Alex Agent",
    emailVerified: true,
    role: "admin",
  });
  await test.saveUser(user);
  // Belt-and-suspenders: ensure the agent role is persisted for the guard.
  await ctx.adapter.update({
    model: "user",
    where: [{ field: "id", value: user.id }],
    update: { role: "admin" },
  });
  const login = await test.login({ userId: user.id });
  return login.headers as Headers;
}

/* --------------------------- 1) human-first flow -------------------------- */

async function humanFlow(): Promise<void> {
  console.log("\n\x1b[1m— Human-first flow (no aiResponder) —\x1b[0m");
  const auth = makeAuth(); // no aiResponder → human-first
  const api = auth.api as any;
  const agentHeaders = await makeAgent(auth);

  // 1. Visitor (no session) sends the first message.
  const sent = await api.chatMessage({
    body: { body: "Hi, my invoice looks wrong — can a person take a look?" },
    returnHeaders: true,
  });
  const visitorCookie = toCookieHeader(setCookiesFrom(sent.headers));
  assert(visitorCookie.length > 0, "visitor receives a signed visitor cookie");
  const conversationId = sent.response.conversation.id as string;
  assert(Boolean(conversationId), "a conversation is created for the visitor");
  assert(
    sent.response.conversation.status === "open",
    `new conversation is 'open' (human-first), got '${sent.response.conversation.status}'`,
  );
  assert(
    sent.response.messages.every((m: any) => m.authorType !== "ai"),
    "no AI message is generated without an aiResponder",
  );

  const visitorHeaders = new Headers({ cookie: visitorCookie });

  // 2. Agent inbox shows the conversation, unread and awaiting a reply.
  const inbox = await api.agentInbox({ headers: agentHeaders, query: { status: "open" } });
  const inboxItem = inbox.conversations.find((c: any) => c.id === conversationId);
  assert(Boolean(inboxItem), "conversation appears in the agent's open inbox");
  assert(inboxItem.unread === true, "conversation is flagged unread (awaiting agent reply)");
  assert(
    typeof inboxItem.lastMessagePreview === "string" && inboxItem.lastMessagePreview.length > 0,
    "inbox row has a last-message preview",
  );

  // 3. Agent replies.
  const reply = await api.agentReply({
    headers: agentHeaders,
    body: { conversationId, body: "Hi! I'm Alex, happy to help. Can you share the invoice number?" },
  });
  assert(reply.message.authorType === "agent", "agent reply is stored as authorType 'agent'");
  assert(Boolean(reply.conversation.assignedAgentId), "replying assigns the conversation to the agent");

  // 4. Visitor polls the stream and sees the agent's reply.
  const stream = await api.chatStream({ headers: visitorHeaders, query: { conversationId } });
  const bodies = stream.messages.map((m: any) => m.body);
  const agentMsg = stream.messages.find((m: any) => m.authorType === "agent");
  assert(Boolean(agentMsg), "visitor's polled thread contains the agent reply");
  assert(
    bodies.includes("Hi! I'm Alex, happy to help. Can you share the invoice number?"),
    "the agent's exact reply text is delivered to the visitor",
  );

  // Visitor replies again → conversation is unread again for the agent.
  await api.chatMessage({
    headers: visitorHeaders,
    body: { conversationId, body: "Sure, it's #A-1042." },
  });
  const inbox2 = await api.agentInbox({ headers: agentHeaders, query: { status: "open" } });
  const item2 = inbox2.conversations.find((c: any) => c.id === conversationId);
  assert(item2?.unread === true, "a new visitor message re-flags the conversation unread");

  // 5. Agent closes the conversation.
  await api.agentClose({ headers: agentHeaders, body: { conversationId } });
  const stream2 = await api.chatStream({ headers: visitorHeaders, query: { conversationId } });
  assert(stream2.conversation.status === "closed", "agent close transitions status to 'closed'");
}

/* --------------------------- 2) AI opt-in checks -------------------------- */

async function aiOptIn(): Promise<void> {
  console.log("\n\x1b[1m— AI opt-in (aiResponder) —\x1b[0m");

  // (a) aiResponder that answers → an `ai` message is posted, stays `open`.
  const answering = makeAuth({
    aiResponder: async (_msg: string, _ctx: GenericEndpointContext) => "Auto-answer: try clearing your cache.",
  });
  const a = answering.api as any;
  const r1 = await a.chatMessage({ body: { body: "app is blank" }, returnHeaders: true });
  assert(
    r1.response.messages.some((m: any) => m.authorType === "ai"),
    "aiResponder string answer is posted as an 'ai' message",
  );
  assert(r1.response.conversation.status === "open", "AI auto-answer keeps the conversation 'open'");

  // (b) aiResponder that returns null → escalate to `pending`.
  const escalating = makeAuth({
    aiResponder: async () => null,
  });
  const e = escalating.api as any;
  const r2 = await e.chatMessage({ body: { body: "I want a refund now" }, returnHeaders: true });
  assert(
    r2.response.messages.every((m: any) => m.authorType !== "ai"),
    "aiResponder null posts no AI message",
  );
  assert(
    r2.response.conversation.status === "pending",
    `aiResponder null escalates to 'pending', got '${r2.response.conversation.status}'`,
  );
}

/* ---------------------------------- main ---------------------------------- */

async function main(): Promise<void> {
  await humanFlow();
  await aiOptIn();
  console.log(`\n\x1b[32m\x1b[1mAll ${passed} assertions passed.\x1b[0m`);
}

main().catch((error) => {
  console.error("\x1b[31mUnexpected error:\x1b[0m", error);
  process.exit(1);
});
