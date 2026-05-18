/** Mirrors botella.contract.OutboundEvent. Keep in sync. */
export type EventType =
  | "typing"
  | "text"
  | "token"
  | "complete"
  | "quick_replies"
  | "media"
  | "paginated_read"
  | "turn_end"
  | "error";

export interface BotEvent {
  type: EventType;
  payload: Record<string, any>;
}
