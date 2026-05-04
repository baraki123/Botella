/**
 * Link-code redemption: claim ownership of an existing account on another
 * transport (e.g. an iOS-anonymous user typing a code minted by /link on
 * Telegram). The server merges the caller's identities into the target
 * account and returns a fresh JWT for that account.
 */
import { product } from "../config/product";

export interface LinkRedeemResult {
  jwt: string;
  userId: string;
  auth: string;
}

export async function redeemLinkCode(args: {
  jwt: string;
  code: string;
}): Promise<LinkRedeemResult> {
  const code = args.code.trim().toUpperCase();
  const r = await fetch(`${product.apiUrl}/v1/account/link/redeem`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.jwt}`,
    },
    body: JSON.stringify({ code }),
  });
  if (!r.ok) {
    let detail = "";
    try {
      const body = await r.json();
      detail = body?.detail ?? "";
    } catch {
      detail = `HTTP ${r.status}`;
    }
    throw new Error(detail || `redeem failed: ${r.status}`);
  }
  const body = await r.json();
  return { jwt: body.jwt, userId: body.user_id, auth: body.auth };
}
