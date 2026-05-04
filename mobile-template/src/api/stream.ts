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

  const emitStatus = (s: "connecting" | "open" | "closed") => {
    for (const fn of statusListeners) fn(s);
  };

  const open = () => {
    if (closed) return;
    emitStatus("connecting");
    ws = new WebSocket(wsUrl(jwt));
    ws.onopen = () => {
      backoff = 500;
      emitStatus("open");
    };
    ws.onmessage = (evt) => {
      try {
        const parsed = JSON.parse(evt.data) as BotEvent;
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
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.warn("ws not open; dropping message");
        return;
      }
      ws.send(JSON.stringify({ transport: "ios", ...message }));
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
