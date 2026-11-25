import type { PrismaClient } from "../../generated/prisma/client.js";
import type { PushMessage, PushSender } from "./sender.js";

export interface DeliveryResult {
  /** `delivered[i]` is true when the push service accepted `messages[i]`. */
  delivered: boolean[];
  /** Tokens the push service says are gone; their DevicePushToken rows are already deleted. */
  invalidTokens: string[];
}

/**
 * Sends `messages` through `sender` and deletes the device tokens the push service reports as
 * gone. A sender that throws delivers nothing and deletes nothing, so the caller can retry.
 * The result lines up with `messages` by index, so the caller can settle its own claims.
 */
export async function deliverPushes(
  prisma: Pick<PrismaClient, "devicePushToken">,
  sender: PushSender,
  messages: PushMessage[],
): Promise<DeliveryResult> {
  if (messages.length === 0) return { delivered: [], invalidTokens: [] };

  let invalidTokens: string[] = [];
  let delivered: boolean[] = messages.map(() => false);
  try {
    ({ invalidTokens, delivered } = await sender.send(messages));
  } catch (err) {
    // Nothing was delivered: the caller's claims stay unsent and a later tick retries them.
    console.error("push: sending failed", err instanceof Error ? err.name : "unknown");
  }
  if (invalidTokens.length > 0) {
    await prisma.devicePushToken.deleteMany({ where: { token: { in: invalidTokens } } });
  }
  return { delivered, invalidTokens };
}
