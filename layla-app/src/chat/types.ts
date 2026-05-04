export type Role = "user" | "bot";

/** A quick-reply option. Plain string → tapping sends that string back as
 *  a user message. Dict-form options support URL launching (share links)
 *  and label/value separation. */
export type QuickReplyOption =
  | string
  | { label: string; url: string }
  | { label: string; value: string };

export interface Message {
  id: string;
  role: Role;
  text: string;
  /** True while the bot bubble is still being streamed in. */
  streaming?: boolean;
  /** Quick-reply chips attached to a bot message. */
  quickReplies?: QuickReplyOption[];
  /** Inline image — data URL or remote URL. */
  imageUrl?: string;
}
