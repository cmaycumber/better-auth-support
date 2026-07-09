/**
 * `better-auth-support/react` — headless hooks + polished reference UI.
 *
 * Visitor side: `useSupportChat()` is the headless core (state + poll-based
 * realtime) and `<SupportChatWidget/>` is an Intercom-style floating messenger.
 *
 * Agent side: `useSupportInbox()` is the headless console core and
 * `<SupportDashboard/>` is a Chatwoot-style two-pane support console (list +
 * thread + stats + assign/close). `<AgentInbox/>` remains as a minimal
 * alternative.
 *
 * The reference components are genuinely styled out of the box — a single
 * runtime stylesheet is injected once and every color/surface/radius is driven
 * by CSS custom properties, so consumers restyle purely through the `theme`
 * prop (no CSS dependency, no build step, React is the only runtime dep). The
 * static rules (layout, hover, focus rings, animations, responsive/mobile
 * behaviour, `prefers-reduced-motion`) live in that stylesheet; per-instance
 * theme values are set inline as `--bas-*` variables on each root.
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
/* Runtime stylesheet (injected once)                                         */
/* -------------------------------------------------------------------------- */

const STYLE_ID = "better-auth-support-styles";

/**
 * All structural styling for the reference components. Colors/radii are read
 * from `--bas-*` custom properties set inline per instance, so a single shared
 * stylesheet themes every widget/dashboard on the page.
 */
const STYLESHEET = `
.bas-root, .bas-root * { box-sizing: border-box; }
.bas-root {
  --bas-accent: #2563eb;
  --bas-accent-contrast: #ffffff;
  --bas-bg: #ffffff;
  --bas-surface: #ffffff;
  --bas-incoming: #f1f5f9;
  --bas-border: #e5e7eb;
  --bas-text: #0f172a;
  --bas-muted: #64748b;
  --bas-radius: 16px;
  --bas-shadow: 0 24px 48px -12px rgba(15, 23, 42, 0.28), 0 8px 20px -8px rgba(15, 23, 42, 0.16);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  color: var(--bas-text);
  line-height: 1.45;
}
.bas-root button { font-family: inherit; }
.bas-root :focus-visible { outline: 2px solid var(--bas-accent); outline-offset: 2px; border-radius: 6px; }

/* ---- Avatars ---- */
.bas-avatar {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px; height: 28px;
  border-radius: 50%;
  font-size: 11px; font-weight: 700;
  letter-spacing: 0.2px;
  user-select: none;
  color: var(--bas-accent-contrast);
  background: var(--bas-accent);
}
.bas-avatar[data-kind="visitor"] { background: #334155; color: #fff; }
.bas-avatar[data-kind="system"] { background: var(--bas-incoming); color: var(--bas-muted); }
.bas-avatar-spacer { flex: 0 0 auto; width: 28px; height: 1px; }

/* ---- Message transcript (shared by widget + dashboard) ---- */
.bas-day {
  display: flex; align-items: center; justify-content: center;
  margin: 14px 0 10px; gap: 8px;
}
.bas-day::before, .bas-day::after {
  content: ""; height: 1px; flex: 1; background: var(--bas-border);
}
.bas-day span {
  font-size: 11px; font-weight: 600; color: var(--bas-muted);
  text-transform: uppercase; letter-spacing: 0.4px;
}
.bas-msg {
  display: flex; align-items: flex-end; gap: 8px;
  margin: 3px 0;
  animation: bas-in 0.26s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.bas-msg[data-out] { flex-direction: row-reverse; }
.bas-msg-col { display: flex; flex-direction: column; max-width: 78%; min-width: 0; }
.bas-msg[data-out] .bas-msg-col { align-items: flex-end; }
.bas-bubble {
  padding: 9px 13px;
  border-radius: 16px;
  background: var(--bas-incoming);
  color: var(--bas-text);
  font-size: 14px;
  white-space: pre-wrap;
  word-break: break-word;
  box-shadow: 0 1px 1px rgba(15, 23, 42, 0.04);
}
.bas-msg:not([data-out]) .bas-bubble { border-bottom-left-radius: 5px; }
.bas-msg[data-out] .bas-bubble {
  background: var(--bas-accent);
  color: var(--bas-accent-contrast);
  border-bottom-right-radius: 5px;
}
.bas-msg-meta {
  display: flex; align-items: center; gap: 5px;
  margin: 3px 2px 0;
  font-size: 11px; color: var(--bas-muted);
}
.bas-msg-author { font-weight: 600; }
.bas-msg-meta time { opacity: 0.85; }

/* ---- Typing indicator ---- */
.bas-typing { display: inline-flex; gap: 4px; align-items: center; padding: 12px 14px; }
.bas-typing span {
  width: 6px; height: 6px; border-radius: 50%;
  background: currentColor; opacity: 0.4;
  animation: bas-blink 1.3s infinite ease-in-out;
}
.bas-typing span:nth-child(2) { animation-delay: 0.18s; }
.bas-typing span:nth-child(3) { animation-delay: 0.36s; }

/* ---- Composer (shared) ---- */
.bas-composer {
  display: flex; align-items: flex-end; gap: 8px;
  padding: 10px 12px;
  background: var(--bas-surface);
  border-top: 1px solid var(--bas-border);
}
.bas-composer textarea {
  flex: 1; min-width: 0;
  resize: none;
  max-height: 120px;
  padding: 10px 12px;
  border: 1px solid var(--bas-border);
  border-radius: 12px;
  font-family: inherit; font-size: 14px; line-height: 1.4;
  color: var(--bas-text); background: var(--bas-bg);
  transition: border-color 0.15s, box-shadow 0.15s;
}
.bas-composer textarea::placeholder { color: var(--bas-muted); }
.bas-composer textarea:focus {
  outline: none;
  border-color: var(--bas-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--bas-accent) 18%, transparent);
}
.bas-send {
  flex: 0 0 auto;
  display: inline-flex; align-items: center; justify-content: center;
  width: 40px; height: 40px;
  border: none; border-radius: 12px;
  background: var(--bas-accent); color: var(--bas-accent-contrast);
  cursor: pointer;
  transition: transform 0.12s ease, opacity 0.15s, background 0.15s;
}
.bas-send:hover:not(:disabled) { background: color-mix(in srgb, var(--bas-accent) 88%, #000); }
.bas-send:active:not(:disabled) { transform: scale(0.94); }
.bas-send:disabled { opacity: 0.45; cursor: default; }
.bas-send svg { width: 18px; height: 18px; }

/* ---- Widget: launcher ---- */
.bas-widget {
  position: fixed; right: 20px; bottom: 20px;
  z-index: 2147483000;
}
.bas-launcher {
  position: absolute; right: 0; bottom: 0;
  width: 56px; height: 56px;
  border: none; border-radius: 50%;
  background: var(--bas-accent); color: var(--bas-accent-contrast);
  cursor: pointer;
  box-shadow: 0 12px 24px -6px color-mix(in srgb, var(--bas-accent) 55%, transparent), 0 6px 12px -4px rgba(15,23,42,0.25);
  display: inline-flex; align-items: center; justify-content: center;
  transition: transform 0.18s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 0.18s;
}
.bas-launcher:hover { transform: scale(1.06); }
.bas-launcher:active { transform: scale(0.95); }
.bas-launcher svg {
  position: absolute; width: 26px; height: 26px;
  transition: opacity 0.2s ease, transform 0.24s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.bas-launcher .bas-ic-close { opacity: 0; transform: rotate(-90deg) scale(0.6); }
.bas-launcher .bas-ic-chat { opacity: 1; transform: rotate(0) scale(1); }
.bas-widget[data-open] .bas-launcher .bas-ic-close { opacity: 1; transform: rotate(0) scale(1); }
.bas-widget[data-open] .bas-launcher .bas-ic-chat { opacity: 0; transform: rotate(90deg) scale(0.6); }

/* ---- Widget: panel ---- */
.bas-panel {
  position: absolute; right: 0; bottom: 72px;
  width: 380px; max-width: calc(100vw - 32px);
  height: min(640px, calc(100vh - 120px));
  display: flex; flex-direction: column;
  background: var(--bas-bg);
  border: 1px solid var(--bas-border);
  border-radius: var(--bas-radius);
  box-shadow: var(--bas-shadow);
  overflow: hidden;
  transform-origin: bottom right;
  opacity: 0; transform: translateY(12px) scale(0.98);
  transition: opacity 0.2s ease, transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.bas-panel[data-open] { opacity: 1; transform: translateY(0) scale(1); }
.bas-panel-header {
  flex: 0 0 auto;
  display: flex; align-items: center; gap: 12px;
  padding: 16px 16px 18px;
  color: var(--bas-accent-contrast);
  background: var(--bas-accent);
  background-image: linear-gradient(135deg, color-mix(in srgb, var(--bas-accent) 92%, #fff), color-mix(in srgb, var(--bas-accent) 78%, #000));
}
.bas-panel-header .bas-avatar {
  width: 40px; height: 40px; font-size: 15px;
  background: rgba(255,255,255,0.22); color: #fff;
  box-shadow: 0 0 0 1px rgba(255,255,255,0.25) inset;
}
.bas-head-text { flex: 1; min-width: 0; }
.bas-head-title { font-size: 16px; font-weight: 700; letter-spacing: -0.01em; }
.bas-head-sub {
  display: flex; align-items: center; gap: 6px;
  font-size: 12.5px; opacity: 0.9; margin-top: 2px;
}
.bas-status-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: #4ade80; box-shadow: 0 0 0 3px rgba(74,222,128,0.25);
  flex: 0 0 auto;
}
.bas-head-close {
  flex: 0 0 auto;
  display: inline-flex; align-items: center; justify-content: center;
  width: 30px; height: 30px;
  border: none; border-radius: 8px;
  background: rgba(255,255,255,0.14); color: inherit;
  cursor: pointer; transition: background 0.15s;
}
.bas-head-close:hover { background: rgba(255,255,255,0.26); }
.bas-messages {
  flex: 1 1 auto; overflow-y: auto;
  padding: 14px 14px 6px;
  background: var(--bas-bg);
  scrollbar-width: thin;
}
.bas-messages::-webkit-scrollbar { width: 8px; }
.bas-messages::-webkit-scrollbar-thumb { background: var(--bas-border); border-radius: 8px; }
.bas-greeting {
  display: flex; gap: 10px; align-items: flex-start;
  padding: 4px 2px 10px;
}
.bas-greeting .bas-avatar { width: 34px; height: 34px; }
.bas-greeting-body {
  background: var(--bas-incoming); color: var(--bas-text);
  padding: 12px 14px; border-radius: 16px; border-bottom-left-radius: 5px;
  font-size: 14px; box-shadow: 0 1px 1px rgba(15,23,42,0.04);
}
.bas-error {
  padding: 8px 14px; margin: 0;
  color: #b91c1c; font-size: 12.5px;
  background: color-mix(in srgb, #b91c1c 8%, var(--bas-bg));
}
.bas-poweredby {
  padding: 8px 12px; text-align: center;
  font-size: 11px; color: var(--bas-muted);
  background: var(--bas-surface);
  border-top: 1px solid var(--bas-border);
}
.bas-poweredby a { color: inherit; font-weight: 600; text-decoration: none; }

/* ---- Dashboard ---- */
.bas-dash {
  display: flex; flex-direction: column;
  height: 100%; min-height: 520px;
  background: var(--bas-bg);
  border: 1px solid var(--bas-border);
  border-radius: var(--bas-radius);
  overflow: hidden;
  font-size: 14px;
}
.bas-dash-top {
  display: flex; align-items: center; gap: 16px;
  padding: 14px 18px;
  background: var(--bas-surface);
  border-bottom: 1px solid var(--bas-border);
}
.bas-dash-title { font-size: 16px; font-weight: 700; letter-spacing: -0.01em; margin-right: 4px; }
.bas-stats { display: flex; gap: 8px; flex-wrap: wrap; }
.bas-stat {
  display: flex; flex-direction: column; gap: 1px;
  padding: 6px 14px;
  border: 1px solid var(--bas-border); border-radius: 10px;
  background: var(--bas-bg);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  min-width: 66px;
}
.bas-stat:hover { border-color: color-mix(in srgb, var(--bas-accent) 45%, var(--bas-border)); }
.bas-stat[data-active] { border-color: var(--bas-accent); background: color-mix(in srgb, var(--bas-accent) 8%, var(--bas-bg)); }
.bas-stat-num { font-size: 19px; font-weight: 700; line-height: 1.1; }
.bas-stat-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--bas-muted); }
.bas-dash-body { display: flex; flex: 1; min-height: 0; }

.bas-list {
  width: 320px; flex: 0 0 320px;
  display: flex; flex-direction: column;
  border-right: 1px solid var(--bas-border);
  background: var(--bas-surface);
  min-height: 0;
}
.bas-tabs { display: flex; gap: 4px; padding: 10px; border-bottom: 1px solid var(--bas-border); }
.bas-tab {
  flex: 1; padding: 6px 8px;
  font-size: 12.5px; text-transform: capitalize; font-weight: 500;
  border: none; border-radius: 8px; cursor: pointer;
  background: transparent; color: var(--bas-muted);
  transition: background 0.15s, color 0.15s;
}
.bas-tab:hover { background: var(--bas-incoming); }
.bas-tab[data-active] { background: var(--bas-accent); color: var(--bas-accent-contrast); font-weight: 600; }
.bas-list-count { padding: 8px 14px; font-size: 11px; color: var(--bas-muted); border-bottom: 1px solid var(--bas-border); }
.bas-list-scroll { flex: 1; overflow-y: auto; min-height: 0; scrollbar-width: thin; }
.bas-list-scroll::-webkit-scrollbar { width: 8px; }
.bas-list-scroll::-webkit-scrollbar-thumb { background: var(--bas-border); border-radius: 8px; }
.bas-empty { padding: 28px 18px; color: var(--bas-muted); text-align: center; font-size: 13px; }

.bas-row {
  display: flex; align-items: flex-start; gap: 10px;
  width: 100%; text-align: left;
  padding: 12px 14px;
  border: none; border-left: 3px solid transparent;
  border-bottom: 1px solid var(--bas-border);
  background: transparent; cursor: pointer;
  transition: background 0.12s;
}
.bas-row:hover { background: var(--bas-incoming); }
.bas-row[data-selected] {
  background: color-mix(in srgb, var(--bas-accent) 9%, var(--bas-bg));
  border-left-color: var(--bas-accent);
}
.bas-row-main { flex: 1; min-width: 0; }
.bas-row-top { display: flex; align-items: baseline; gap: 8px; }
.bas-row-name { font-weight: 600; color: var(--bas-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.bas-row[data-unread] .bas-row-name { font-weight: 700; }
.bas-row-time { font-size: 11px; color: var(--bas-muted); flex: 0 0 auto; }
.bas-row-preview {
  font-size: 12.5px; color: var(--bas-muted);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  margin-top: 2px;
}
.bas-row[data-unread] .bas-row-preview { color: var(--bas-text); }
.bas-row-meta { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
.bas-unread-dot {
  flex: 0 0 auto; width: 9px; height: 9px; border-radius: 50%;
  background: var(--bas-accent); margin-top: 4px;
}
.bas-pill {
  font-size: 10.5px; font-weight: 600; text-transform: capitalize;
  padding: 2px 8px; border-radius: 999px;
  color: #fff; background: var(--bas-muted);
}
.bas-pill[data-status="open"] { background: var(--bas-accent); }
.bas-pill[data-status="pending"] { background: #d97706; }
.bas-pill[data-status="closed"] { background: #64748b; }
.bas-pill-agent { font-size: 11px; color: var(--bas-muted); }

.bas-thread { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.bas-thread-head {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 16px;
  background: var(--bas-surface);
  border-bottom: 1px solid var(--bas-border);
}
.bas-thread-id { flex: 1; min-width: 0; }
.bas-thread-name { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bas-thread-sub { font-size: 12px; color: var(--bas-muted); margin-top: 1px; }
.bas-actions { display: flex; gap: 8px; flex: 0 0 auto; }
.bas-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 12px;
  border: 1px solid var(--bas-border); border-radius: 9px;
  background: var(--bas-bg); color: var(--bas-text);
  font-size: 13px; font-weight: 500; cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.bas-btn:hover:not(:disabled) { background: var(--bas-incoming); border-color: color-mix(in srgb, var(--bas-accent) 40%, var(--bas-border)); }
.bas-btn:disabled { opacity: 0.5; cursor: default; }
.bas-btn-primary { background: var(--bas-accent); color: var(--bas-accent-contrast); border-color: transparent; }
.bas-btn-primary:hover:not(:disabled) { background: color-mix(in srgb, var(--bas-accent) 88%, #000); border-color: transparent; }
.bas-transcript {
  flex: 1; overflow-y: auto; min-height: 0;
  padding: 16px; background: var(--bas-bg);
  scrollbar-width: thin;
}
.bas-transcript::-webkit-scrollbar { width: 8px; }
.bas-transcript::-webkit-scrollbar-thumb { background: var(--bas-border); border-radius: 8px; }
.bas-back { display: none; }

/* ---- Animations ---- */
@keyframes bas-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: none; }
}
@keyframes bas-blink {
  0%, 80%, 100% { opacity: 0.3; transform: translateY(0); }
  40% { opacity: 1; transform: translateY(-2px); }
}

/* ---- Responsive ---- */
@media (max-width: 480px) {
  .bas-widget { right: 16px; bottom: 16px; }
  .bas-panel {
    position: fixed; inset: 0;
    width: 100%; max-width: 100%; height: 100%;
    border-radius: 0; border: none;
  }
  .bas-widget[data-open] .bas-launcher { display: none; }
}
@media (max-width: 640px) {
  .bas-list { flex-basis: 100%; width: 100%; }
  .bas-dash[data-selected] .bas-list { display: none; }
  .bas-dash:not([data-selected]) .bas-thread { display: none; }
  .bas-back { display: inline-flex; }
}

/* ---- Reduced motion ---- */
@media (prefers-reduced-motion: reduce) {
  .bas-msg, .bas-launcher, .bas-launcher svg, .bas-panel, .bas-send, .bas-typing span { animation: none !important; transition: none !important; }
}
`;

let stylesInjected = false;

function ensureStyles(): void {
  if (stylesInjected || typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) {
    stylesInjected = true;
    return;
  }
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = STYLESHEET;
  document.head.appendChild(el);
  stylesInjected = true;
}

// `useInsertionEffect` is React's dedicated hook for injecting styles before
// paint; fall back to `useEffect` on older runtimes.
const useStyleEffect = React.useInsertionEffect ?? React.useEffect;

function useSupportStyles(): void {
  useStyleEffect(() => {
    ensureStyles();
  }, []);
}

/* -------------------------------------------------------------------------- */
/* Theme                                                                      */
/* -------------------------------------------------------------------------- */

/** Color/surface overrides shared by the reference components. */
export interface SupportTheme {
  /** Brand color: launcher, outbound bubbles, primary buttons. */
  accent?: string;
  /** Text/icon color on top of `accent`. Default `#ffffff`. */
  accentContrast?: string;
  /** Panel/console background. */
  background?: string;
  /** Header/composer/list surface (slightly distinct from `background`). */
  surface?: string;
  /** Incoming bubble + subtle hover surface. */
  incoming?: string;
  border?: string;
  text?: string;
  mutedText?: string;
  /** Base corner radius in px for panels/console. Default `16`. */
  radius?: number;
}

const DEFAULT_THEME: Required<SupportTheme> = {
  accent: "#2563eb",
  accentContrast: "#ffffff",
  background: "#ffffff",
  surface: "#ffffff",
  incoming: "#f1f5f9",
  border: "#e5e7eb",
  text: "#0f172a",
  mutedText: "#64748b",
  radius: 16,
};

function themeVars(theme: Required<SupportTheme>): React.CSSProperties {
  return {
    "--bas-accent": theme.accent,
    "--bas-accent-contrast": theme.accentContrast,
    "--bas-bg": theme.background,
    "--bas-surface": theme.surface,
    "--bas-incoming": theme.incoming,
    "--bas-border": theme.border,
    "--bas-text": theme.text,
    "--bas-muted": theme.mutedText,
    "--bas-radius": `${theme.radius}px`,
  } as unknown as React.CSSProperties;
}

/* -------------------------------------------------------------------------- */
/* Formatting helpers                                                         */
/* -------------------------------------------------------------------------- */

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function clock(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function dayLabel(d: Date): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
  });
}

function relativeTime(value: string | Date): string {
  const d = toDate(value);
  const diffMs = Date.now() - d.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function initialOf(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0]! + parts[1][0]!).toUpperCase();
  }
  return trimmed[0]!.toUpperCase();
}

type AvatarKind = "agent" | "visitor" | "system";

function avatarKind(authorType: SupportMessage["authorType"]): AvatarKind {
  if (authorType === "agent" || authorType === "ai") return "agent";
  if (authorType === "system") return "system";
  return "visitor";
}

/* -------------------------------------------------------------------------- */
/* Shared subcomponents                                                       */
/* -------------------------------------------------------------------------- */

function Avatar(props: { label: string; kind: AvatarKind; className?: string }): React.ReactElement {
  return (
    <span className={`bas-avatar${props.className ? ` ${props.className}` : ""}`} data-kind={props.kind} aria-hidden="true">
      {initialOf(props.label)}
    </span>
  );
}

const SendIcon = (): React.ReactElement => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M3.4 20.5 21 12 3.4 3.5c-.8-.4-1.6.4-1.3 1.2L4.5 11l7 1-7 1-2.4 6.3c-.3.8.5 1.6 1.3 1.2Z" />
  </svg>
);

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  sending: boolean;
  disabled?: boolean;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  ariaLabel: string;
}

/** Auto-growing textarea + send button. Enter sends, Shift+Enter inserts a newline. */
function Composer(props: ComposerProps): React.ReactElement {
  const { value, onChange, onSubmit, placeholder, sending, disabled, textareaRef, ariaLabel } = props;
  const innerRef = React.useRef<HTMLTextAreaElement | null>(null);
  const ref = textareaRef ?? innerRef;
  const canSend = value.trim().length > 0 && !sending && !disabled;

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [value, ref]);

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    if (!canSend) return;
    onSubmit();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSend) onSubmit();
    }
  };

  return (
    <form className="bas-composer" onSubmit={submit}>
      <textarea
        ref={ref}
        rows={1}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        aria-label={ariaLabel}
        disabled={disabled}
      />
      <button type="submit" className="bas-send" disabled={!canSend} aria-label="Send message">
        {sending ? (
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeOpacity="0.3" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite" />
            </path>
          </svg>
        ) : (
          <SendIcon />
        )}
      </button>
    </form>
  );
}

interface TranscriptProps {
  messages: SupportMessage[];
  outbound: (message: SupportMessage) => boolean;
  labelFor: (message: SupportMessage) => string;
  variant: "widget" | "dash";
  scrollRef: React.RefObject<HTMLDivElement | null>;
  intro?: React.ReactNode;
  emptyState?: React.ReactNode;
  typing?: boolean;
}

/** Message list with day dividers, grouped author labels, avatars and timestamps. */
function Transcript(props: TranscriptProps): React.ReactElement {
  const { messages, outbound, labelFor, variant, scrollRef, intro, emptyState, typing } = props;

  const rows: React.ReactNode[] = [];
  let lastDay = "";
  let lastAuthor: SupportMessage["authorType"] | null = null;

  for (const message of messages) {
    const d = toDate(message.createdAt);
    const key = dayKey(d);
    const dayChanged = key !== lastDay;
    if (dayChanged) {
      lastDay = key;
      lastAuthor = null;
      rows.push(
        <div className="bas-day" key={`day-${key}-${message.id}`}>
          <span>{dayLabel(d)}</span>
        </div>,
      );
    }
    const out = outbound(message);
    const label = labelFor(message);
    const startsGroup = message.authorType !== lastAuthor;
    lastAuthor = message.authorType;

    rows.push(
      <div className="bas-msg" data-out={out || undefined} key={message.id}>
        {!out ? (
          startsGroup ? (
            <Avatar label={label} kind={avatarKind(message.authorType)} />
          ) : (
            <span className="bas-avatar-spacer" aria-hidden="true" />
          )
        ) : null}
        <div className="bas-msg-col">
          <div className="bas-bubble">{message.body}</div>
          {startsGroup ? (
            <div className="bas-msg-meta">
              <span className="bas-msg-author">{label}</span>
              <span aria-hidden="true">·</span>
              <time dateTime={d.toISOString()}>{clock(d)}</time>
            </div>
          ) : null}
        </div>
      </div>,
    );
  }

  return (
    <div className={variant === "widget" ? "bas-messages" : "bas-transcript"} ref={scrollRef} aria-live="polite">
      {intro}
      {messages.length === 0 ? emptyState : rows}
      {typing ? (
        <div className="bas-msg" key="__typing">
          <span className="bas-avatar" data-kind="agent" aria-hidden="true">
            {"…"}
          </span>
          <div className="bas-msg-col">
            <div className="bas-bubble bas-typing" role="status" aria-label="typing">
              <span />
              <span />
              <span />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Visitor headless hook                                                      */
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
  /** Initial open state for the widget. Default `false`. */
  defaultOpen?: boolean;
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

  const [open, setOpen] = React.useState(options.defaultOpen ?? false);
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
/* SupportChatWidget — Intercom-style messenger                               */
/* -------------------------------------------------------------------------- */

/** @deprecated alias kept for back-compat; use {@link SupportTheme}. */
export type SupportChatTheme = SupportTheme;

export interface SupportChatWidgetProps {
  client: SupportClient;
  title?: string;
  /** Header subtitle. Default: "We typically reply in a few minutes". */
  subtitle?: string;
  /** Greeting shown as the first incoming bubble before any messages exist. */
  greeting?: string;
  placeholder?: string;
  pollIntervalMs?: number;
  /** @deprecated use `theme.accent`. Shortcut for the brand color. */
  accentColor?: string;
  /** Color/surface/radius overrides; merged over strong defaults. */
  theme?: SupportTheme;
  /** Optional avatar/team element rendered in the header. */
  avatar?: React.ReactNode;
  /** Footer line (e.g. "Powered by …"). Omit to hide. */
  poweredBy?: React.ReactNode;
  /** Show the incoming typing indicator (drive from your own AI/agent state). */
  typing?: boolean;
  /** Start with the panel open. */
  defaultOpen?: boolean;
  /** Applied to the widget root element. */
  className?: string;
  /** Merged onto the widget root's inline styles (after theme variables). */
  style?: React.CSSProperties;
}

const CHAT_ICON = (
  <svg className="bas-ic-chat" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 3C6.5 3 2 6.6 2 11c0 2.1 1 4 2.8 5.4-.1 1.3-.6 2.6-1.6 3.8 1.7-.2 3.3-.8 4.6-1.8 1.3.4 2.7.6 4.2.6 5.5 0 10-3.6 10-8s-4.5-8-10-8Z" />
  </svg>
);

const CLOSE_ICON = (
  <svg className="bas-ic-close" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);

function widgetLabel(authorType: SupportMessage["authorType"], agentName: string): string {
  if (authorType === "agent") return agentName;
  if (authorType === "ai") return "Assistant";
  if (authorType === "system") return "System";
  return "You";
}

function widgetOutbound(authorType: SupportMessage["authorType"]): boolean {
  return authorType === "user" || authorType === "visitor";
}

/** Small unmount-after-transition helper so open AND close both animate. */
function useMountTransition(active: boolean, durationMs: number): { mounted: boolean; visible: boolean } {
  const [mounted, setMounted] = React.useState(active);
  const [visible, setVisible] = React.useState(active);

  React.useEffect(() => {
    if (active) {
      setMounted(true);
      const frame = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(frame);
    }
    setVisible(false);
    const timer = setTimeout(() => setMounted(false), durationMs);
    return () => clearTimeout(timer);
  }, [active, durationMs]);

  return { mounted, visible };
}

export function SupportChatWidget(props: SupportChatWidgetProps): React.ReactElement {
  useSupportStyles();
  const {
    client,
    title = "Support",
    subtitle = "We typically reply in a few minutes",
    greeting = "Hi there 👋 How can we help?",
    placeholder = "Type your message…",
    pollIntervalMs,
    accentColor,
    avatar,
    poweredBy,
    typing,
    defaultOpen,
    className,
    style,
  } = props;

  const theme: Required<SupportTheme> = {
    ...DEFAULT_THEME,
    ...(accentColor ? { accent: accentColor } : {}),
    ...props.theme,
  };

  const chat = useSupportChat({
    client,
    ...(pollIntervalMs ? { pollIntervalMs } : {}),
    ...(defaultOpen ? { defaultOpen } : {}),
  });
  const [draft, setDraft] = React.useState("");
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const composerRef = React.useRef<HTMLTextAreaElement | null>(null);
  const { mounted, visible } = useMountTransition(chat.open, 240);

  React.useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages, typing, mounted]);

  React.useEffect(() => {
    if (visible) composerRef.current?.focus();
  }, [visible]);

  const submit = React.useCallback(async () => {
    const text = draft.trim();
    if (!text || chat.sending) return;
    setDraft("");
    await chat.sendMessage(text);
  }, [draft, chat]);

  const rootStyle: React.CSSProperties = { ...themeVars(theme), ...style };

  const greetingBlock = (
    <div className="bas-greeting">
      <Avatar label={title} kind="agent" />
      <div className="bas-greeting-body">{greeting}</div>
    </div>
  );

  return (
    <div
      className={`bas-root bas-widget${className ? ` ${className}` : ""}`}
      data-open={chat.open || undefined}
      style={rootStyle}
    >
      {mounted ? (
        <div
          className="bas-panel"
          data-open={visible || undefined}
          role="dialog"
          aria-label={title}
          onKeyDown={(event) => {
            if (event.key === "Escape") chat.setOpen(false);
          }}
        >
          <div className="bas-panel-header">
            {avatar ?? <Avatar label={title} kind="agent" />}
            <div className="bas-head-text">
              <div className="bas-head-title">{title}</div>
              <div className="bas-head-sub">
                <span className="bas-status-dot" aria-hidden="true" />
                {subtitle}
              </div>
            </div>
            <button
              type="button"
              className="bas-head-close"
              aria-label="Minimize support chat"
              onClick={() => chat.setOpen(false)}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
                <path d="M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <Transcript
            messages={chat.messages}
            outbound={(m) => widgetOutbound(m.authorType)}
            labelFor={(m) => widgetLabel(m.authorType, title)}
            variant="widget"
            scrollRef={listRef}
            emptyState={greetingBlock}
            {...(typing ? { typing: true } : {})}
          />

          {chat.error ? (
            <div className="bas-error" role="alert">
              {chat.error}
            </div>
          ) : null}

          <Composer
            value={draft}
            onChange={setDraft}
            onSubmit={submit}
            placeholder={placeholder}
            sending={chat.sending}
            textareaRef={composerRef}
            ariaLabel="Message"
          />

          {poweredBy ? <div className="bas-poweredby">{poweredBy}</div> : null}
        </div>
      ) : null}

      <button
        type="button"
        className="bas-launcher"
        aria-label={chat.open ? "Close support chat" : "Open support chat"}
        aria-expanded={chat.open}
        onClick={() => chat.setOpen(!chat.open)}
      >
        {CHAT_ICON}
        {CLOSE_ICON}
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Reference agent inbox (minimal alternative)                                */
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
/* SupportDashboard — Chatwoot-style agent console                            */
/* -------------------------------------------------------------------------- */

/** @deprecated alias kept for back-compat; use {@link SupportTheme}. */
export type SupportDashboardTheme = SupportTheme;

export interface SupportDashboardProps {
  /** A Better Auth client whose plugin exposes the `agent` namespace. */
  client: SupportClient;
  title?: string;
  pollIntervalMs?: number;
  /** Initial status filter (default `"open"`). */
  initialStatus?: InboxStatusFilter;
  /** Applied to the root element for external styling. */
  className?: string;
  /** Merged onto the root element's inline styles (after theme variables). */
  style?: React.CSSProperties;
  /** Color/surface/radius overrides; merged over strong defaults. */
  theme?: SupportTheme;
}

const STATUS_FILTERS: InboxStatusFilter[] = ["all", "open", "pending", "closed"];

function inboxIdentity(item: InboxItem): string {
  return (
    item.user?.name ||
    item.user?.email ||
    item.visitorName ||
    item.visitorEmail ||
    item.visitorId ||
    "Anonymous visitor"
  );
}

function assignedAgentLabel(item: InboxItem): string | null {
  if (!item.assignedAgentId) return null;
  return item.assignedAgent?.name || item.assignedAgent?.email || "an agent";
}

export function SupportDashboard(props: SupportDashboardProps): React.ReactElement {
  useSupportStyles();
  const { client, title = "Support", pollIntervalMs, initialStatus, className, style } = props;
  const theme: Required<SupportTheme> = { ...DEFAULT_THEME, ...props.theme };

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

  const submitReply = React.useCallback(async () => {
    const text = draft.trim();
    if (!text || inbox.sending) return;
    setDraft("");
    await inbox.reply(text);
  }, [draft, inbox]);

  const rootStyle: React.CSSProperties = { ...themeVars(theme), ...style };

  if (!client.agent) {
    return (
      <div className={`bas-root${className ? ` ${className}` : ""}`} style={{ padding: 16, ...rootStyle }}>
        This client has no agent actions. Configure <code>supportClient()</code> and sign in as an
        agent.
      </div>
    );
  }

  const conversation = inbox.thread?.conversation ?? null;
  const identity = conversation ? inboxIdentity({ ...conversation } as InboxItem) : "";
  const agentDisplayName =
    inbox.thread?.messages.find((m) => m.authorType === "agent") &&
    inbox.items.find((i) => i.id === conversation?.id)?.assignedAgent?.name;

  const dashLabel = (message: SupportMessage): string => {
    if (message.authorType === "agent") return agentDisplayName || "You";
    if (message.authorType === "ai") return "Assistant";
    if (message.authorType === "system") return "System";
    return identity || "Visitor";
  };

  const stats: Array<{ key: InboxStatusFilter; label: string; value: number | string }> = [
    { key: "open", label: "Open", value: inbox.stats?.open ?? "–" },
    { key: "pending", label: "Pending", value: inbox.stats?.pending ?? "–" },
    { key: "closed", label: "Closed", value: inbox.stats?.closed ?? "–" },
    { key: "all", label: "Total", value: inbox.stats?.total ?? "–" },
  ];

  return (
    <div
      className={`bas-root bas-dash${className ? ` ${className}` : ""}`}
      data-selected={inbox.selectedId ? "true" : undefined}
      role="region"
      aria-label={`${title} dashboard`}
      style={rootStyle}
    >
      <div className="bas-dash-top">
        <span className="bas-dash-title">{title}</span>
        <div className="bas-stats">
          {stats.map((s) => (
            <button
              key={s.key}
              type="button"
              className="bas-stat"
              data-active={inbox.status === s.key || undefined}
              onClick={() => inbox.setStatus(s.key)}
            >
              <span
                className="bas-stat-num"
                style={
                  s.key === "open"
                    ? { color: "var(--bas-accent)" }
                    : s.key === "pending"
                      ? { color: "#d97706" }
                      : undefined
                }
              >
                {s.value}
              </span>
              <span className="bas-stat-label">{s.label}</span>
            </button>
          ))}
        </div>
      </div>

      {inbox.error ? (
        <div className="bas-error" role="alert">
          {inbox.error}
        </div>
      ) : null}

      <div className="bas-dash-body">
        <aside className="bas-list" aria-label="Conversations">
          <div className="bas-tabs" role="tablist" aria-label="Filter conversations by status">
            {STATUS_FILTERS.map((filter) => (
              <button
                key={filter}
                type="button"
                role="tab"
                aria-selected={inbox.status === filter}
                className="bas-tab"
                data-active={inbox.status === filter || undefined}
                onClick={() => inbox.setStatus(filter)}
              >
                {filter}
              </button>
            ))}
          </div>

          <div className="bas-list-count">
            {inbox.items.length} of {inbox.total}
          </div>

          <div className="bas-list-scroll" aria-busy={inbox.loading}>
            {inbox.items.length === 0 ? (
              <div className="bas-empty">
                {inbox.loading ? "Loading conversations…" : "No conversations here yet."}
              </div>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {inbox.items.map((item) => {
                  const selected = item.id === inbox.selectedId;
                  const name = inboxIdentity(item);
                  const agentLabel = assignedAgentLabel(item);
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="bas-row"
                        data-selected={selected || undefined}
                        data-unread={item.unread || undefined}
                        aria-current={selected}
                        onClick={() => inbox.select(item.id)}
                      >
                        <Avatar label={name} kind="visitor" />
                        <span className="bas-row-main">
                          <span className="bas-row-top">
                            <span className="bas-row-name">{name}</span>
                            <span className="bas-row-time">{relativeTime(item.lastMessageAt)}</span>
                          </span>
                          {item.lastMessagePreview ? (
                            <span className="bas-row-preview">{item.lastMessagePreview}</span>
                          ) : null}
                          <span className="bas-row-meta">
                            <span className="bas-pill" data-status={item.status}>
                              {item.status}
                            </span>
                            {agentLabel ? (
                              <span className="bas-pill-agent">· {agentLabel}</span>
                            ) : null}
                          </span>
                        </span>
                        {item.unread ? (
                          <span className="bas-unread-dot" aria-label="Unread" title="Awaiting reply" />
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        <section className="bas-thread" aria-label="Conversation">
          {!conversation ? (
            <div className="bas-empty" style={{ margin: "auto" }}>
              Select a conversation to view the thread.
            </div>
          ) : (
            <>
              <div className="bas-thread-head">
                <button
                  type="button"
                  className="bas-btn bas-back"
                  aria-label="Back to inbox"
                  onClick={() => inbox.select(null)}
                >
                  ←
                </button>
                <Avatar label={identity} kind="visitor" />
                <div className="bas-thread-id">
                  <div className="bas-thread-name">{identity}</div>
                  <div className="bas-thread-sub">
                    <span className="bas-pill" data-status={conversation.status}>
                      {conversation.status}
                    </span>{" "}
                    {conversation.assignedAgentId ? "· assigned" : "· unassigned"}
                    {conversation.visitorEmail ? ` · ${conversation.visitorEmail}` : ""}
                  </div>
                </div>
                <div className="bas-actions">
                  <button type="button" className="bas-btn" onClick={() => void inbox.assign()}>
                    Assign to me
                  </button>
                  <button
                    type="button"
                    className="bas-btn"
                    onClick={() => void inbox.close()}
                    disabled={conversation.status === "closed"}
                  >
                    Close
                  </button>
                </div>
              </div>

              <Transcript
                messages={inbox.thread?.messages ?? []}
                outbound={(m) => m.authorType === "agent" || m.authorType === "ai"}
                labelFor={dashLabel}
                variant="dash"
                scrollRef={listRef}
              />

              <Composer
                value={draft}
                onChange={setDraft}
                onSubmit={submitReply}
                placeholder="Reply to the customer…"
                sending={inbox.sending}
                disabled={conversation.status === "closed"}
                ariaLabel="Reply"
              />
            </>
          )}
        </section>
      </div>
    </div>
  );
}
