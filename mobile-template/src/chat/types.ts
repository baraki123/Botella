export type Role = "user" | "bot";

export interface Message {
  id: string;
  role: Role;
  text: string;
  /** True while the bot bubble is still being streamed in. */
  streaming?: boolean;
  /** Quick-reply chips attached to a bot message. */
  quickReplies?: string[];
}
