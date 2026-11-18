import { Expo, type ExpoPushMessage, type ExpoPushTicket } from "expo-server-sdk";

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
}

export interface PushSender {
  /**
   * Sends every message. `delivered[i]` is true when the push service accepted `messages[i]`.
   * `invalidTokens` lists tokens the push service says no longer work (never delivered).
   */
  send(messages: PushMessage[]): Promise<{ invalidTokens: string[]; delivered: boolean[] }>;
}

/** Tokens whose ticket says the device is gone. Tickets line up with `messages` by index. */
export function invalidTokensFromTickets(
  messages: readonly { to: string }[],
  tickets: readonly ExpoPushTicket[],
): string[] {
  const out: string[] = [];
  tickets.forEach((ticket, i) => {
    const message = messages[i];
    if (message && ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered") {
      out.push(message.to);
    }
  });
  return out;
}

/**
 * Sends through Expo's push service. A token that is not an Expo token counts as invalid. A
 * failed request loses only its own chunk; it is logged without tokens or message text.
 */
export function createExpoSender(options: { accessToken: string | null }): PushSender {
  const expo = new Expo(options.accessToken ? { accessToken: options.accessToken } : {});
  return {
    async send(messages) {
      const invalidTokens: string[] = [];
      const delivered: boolean[] = messages.map(() => false);
      const valid: ExpoPushMessage[] = [];
      const validAt: number[] = [];
      messages.forEach((m, i) => {
        if (Expo.isExpoPushToken(m.to)) {
          valid.push({ ...m, sound: "default" });
          validAt.push(i);
        } else invalidTokens.push(m.to);
      });
      let offset = 0;
      for (const chunk of expo.chunkPushNotifications(valid)) {
        try {
          const tickets = await expo.sendPushNotificationsAsync(chunk);
          invalidTokens.push(...invalidTokensFromTickets(chunk as { to: string }[], tickets));
          tickets.forEach((ticket, j) => {
            const at = validAt[offset + j];
            if (at !== undefined && ticket.status === "ok") delivered[at] = true;
          });
        } catch (err) {
          // Only this chunk fails; its messages stay undelivered so the caller can retry them.
          console.error("push: a chunk of notifications could not be sent", err instanceof Error ? err.name : "unknown");
        }
        offset += chunk.length;
      }
      return { invalidTokens, delivered };
    },
  };
}

/**
 * A sender for tests: records every message it was asked to send, reports `invalid` tokens as
 * gone, and fails (without delivering) the tokens in `failing`.
 */
export function createFakeSender(invalid: Iterable<string> = []): PushSender & {
  sent: PushMessage[];
  invalid: Set<string>;
  failing: Set<string>;
} {
  const sent: PushMessage[] = [];
  const invalidSet = new Set(invalid);
  const failing = new Set<string>();
  return {
    sent,
    invalid: invalidSet,
    failing,
    async send(messages) {
      sent.push(...messages);
      return {
        invalidTokens: messages.map((m) => m.to).filter((t) => invalidSet.has(t)),
        delivered: messages.map((m) => !invalidSet.has(m.to) && !failing.has(m.to)),
      };
    },
  };
}
