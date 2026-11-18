import { Expo, type ExpoPushMessage, type ExpoPushTicket } from "expo-server-sdk";

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
}

export interface PushSender {
  /** Sends every message. `invalidTokens` lists tokens the push service says no longer work. */
  send(messages: PushMessage[]): Promise<{ invalidTokens: string[] }>;
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
      const valid: ExpoPushMessage[] = [];
      for (const m of messages) {
        if (Expo.isExpoPushToken(m.to)) valid.push({ ...m, sound: "default" });
        else invalidTokens.push(m.to);
      }
      for (const chunk of expo.chunkPushNotifications(valid)) {
        try {
          const tickets = await expo.sendPushNotificationsAsync(chunk);
          invalidTokens.push(...invalidTokensFromTickets(chunk as { to: string }[], tickets));
        } catch {
          console.error("push: a chunk of notifications could not be sent");
        }
      }
      return { invalidTokens };
    },
  };
}

/** A sender for tests: records everything and reports `invalid` tokens as gone. */
export function createFakeSender(invalid: Iterable<string> = []): PushSender & {
  sent: PushMessage[];
  invalid: Set<string>;
} {
  const sent: PushMessage[] = [];
  const invalidSet = new Set(invalid);
  return {
    sent,
    invalid: invalidSet,
    async send(messages) {
      sent.push(...messages);
      return { invalidTokens: messages.map((m) => m.to).filter((t) => invalidSet.has(t)) };
    },
  };
}
