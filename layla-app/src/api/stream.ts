/**
 * WebSocket client for /v1/stream.
 *
 * Manages one persistent socket per session. Reconnects with backoff on drop.
 * Caller subscribes to events via onEvent; sends user messages via send().
 */
import { product } from "../config/product";
import type { BotEvent } from "./types";

type EventHandler = (event: BotEvent) => void;

export interface OutboundFrame {
  text?: string;
  callback_data?: string;
  /** True iff this text came from a voice transcription (so the server flips
   * Layla's warmer voice-note persona). */
  voice_origin?: boolean;
}

export interface StreamClient {
  send(message: OutboundFrame): void;
  close(): void;
  onEvent(fn: EventHandler): () => void;
  onStatus(fn: (status: "connecting" | "open" | "closed") => void): () => void;
}

function wsUrl(jwt: string): string {
  const httpUrl = product.apiUrl;
  const wsScheme = httpUrl.startsWith("https://") ? "wss://" : "ws://";
  const host = httpUrl.replace(/^https?:\/\//, "");
  return `${wsScheme}${host}/v1/stream?token=${encodeURIComponent(jwt)}`;
}

export function connectStream(jwt: string): StreamClient {
  const eventListeners = new Set<EventHandler>();
  const statusListeners = new Set<(s: "connecting" | "open" | "closed") => void>();
  let ws: WebSocket | null = null;
  let closed = false;
  let backoff = 500;
  // Messages typed while WS is connecting / dropped — flushed when it opens.
  const outbox: OutboundFrame[] = [];

  // ── Lost-turn ack/retry ──────────────────────────────────────────────
  // A mobile network blip can drop the socket mid-turn: the message was
  // already sent, so it's NOT in the outbox, and the reply Layla generates
  // streams into a dead socket and is lost. On reconnect the server re-runs
  // the check-in opener, not the dropped turn — so the user's message gets
  // no answer (exactly the "offline → no response → recovered" report).
  // We track the latest free-text turn and, if it produced ZERO output
  // before a drop, re-send it once on reconnect. Scoped to plain text turns
  // (no callback_data) so we never double-advance a flow (doorway/chip/add-
  // person steps), and gated on zero-output so we never duplicate a reply
  // that had already started streaming.
  let pendingTurn: OutboundFrame | null = null;
  let pendingGotOutput = false;
  let pendingRetried = false;

  const isRetryableTurn = (m: OutboundFrame) =>
    !!(m.text && m.text.trim()) && !m.callback_data;

  const emitStatus = (s: "connecting" | "open" | "closed") => {
    for (const fn of statusListeners) fn(s);
  };

  const rawSend = (m: OutboundFrame) => {
    ws!.send(JSON.stringify({ transport: "ios", ...m }));
  };

  const flushOutbox = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    while (outbox.length) {
      rawSend(outbox.shift()!);
    }
  };

  const open = () => {
    if (closed) return;
    emitStatus("connecting");
    ws = new WebSocket(wsUrl(jwt));
    ws.onopen = () => {
      backoff = 500;
      emitStatus("open");
      flushOutbox();
      // Re-send a turn that was dropped mid-flight with no reply (see above).
      if (pendingTurn && !pendingRetried && !pendingGotOutput) {
        pendingRetried = true;
        pendingGotOutput = false;
        rawSend(pendingTurn);
      }
    };
    ws.onmessage = (evt) => {
      try {
        const parsed = JSON.parse(evt.data) as BotEvent;
        // Track the in-flight turn so a mid-turn drop can be retried.
        const t = (parsed as { type?: string }).type;
        if (t === "token" || t === "text" || t === "complete") {
          pendingGotOutput = true;
        } else if (t === "turn_end") {
          pendingTurn = null; // turn completed — nothing to retry
        }
        for (const fn of eventListeners) fn(parsed);
      } catch (e) {
        console.warn("ws bad json", e);
      }
    };
    ws.onclose = () => {
      emitStatus("closed");
      if (closed) return;
      setTimeout(open, backoff);
      backoff = Math.min(backoff * 2, 10_000);
    };
    ws.onerror = (e) => {
      console.warn("ws error", e);
    };
  };

  open();

  return {
    send(message) {
      // Track the latest plain-text turn for lost-turn retry (a new turn
      // supersedes any prior un-acked one). Callbacks / flow steps are not
      // tracked — re-sending those could double-advance a flow.
      if (isRetryableTurn(message)) {
        pendingTurn = message;
        pendingGotOutput = false;
        pendingRetried = false;
      }
      // Always accept the message. If the socket is up, send now; otherwise
      // queue it and flush on the next 'open'. Avoids the silent-failure
      // mode where typing while reconnecting drops user messages.
      if (ws && ws.readyState === WebSocket.OPEN) {
        rawSend(message);
      } else {
        outbox.push(message);
      }
    },
    close() {
      closed = true;
      ws?.close();
    },
    onEvent(fn) {
      eventListeners.add(fn);
      return () => eventListeners.delete(fn);
    },
    onStatus(fn) {
      statusListeners.add(fn);
      return () => statusListeners.delete(fn);
    },
  };
}
