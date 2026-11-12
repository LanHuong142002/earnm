export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export type Config = {
  databaseUrl: string;
  trustProxy: number;
  internalSecret: string;
  port: number;
  /** Where an invitee installs the app; null when not configured. Always https. */
  inviteInstallUrl: string | null;
  /** Optional separate key for invite codes; null means they use INTERNAL_SECRET. */
  inviteCodeKey: string | null;
};

const MIN_SECRET_LENGTH = 32;

/** Error messages name the variable only; they never include a value. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const databaseUrl = env["DATABASE_URL"];
  if (!databaseUrl) {
    throw new ConfigError("DATABASE_URL is not set.");
  }

  const trustProxyRaw = env["TRUST_PROXY"] ?? "0";
  if (!/^\d+$/.test(trustProxyRaw)) {
    throw new ConfigError(
      "TRUST_PROXY must be a non-negative integer (the number of proxy hops).",
    );
  }

  const internalSecret = env["INTERNAL_SECRET"];
  if (!internalSecret) {
    throw new ConfigError("INTERNAL_SECRET is not set.");
  }
  if (internalSecret.length < MIN_SECRET_LENGTH) {
    throw new ConfigError(
      `INTERNAL_SECRET must be at least ${MIN_SECRET_LENGTH} characters.`,
    );
  }

  if (/\s/.test(internalSecret)) {
    throw new ConfigError("INTERNAL_SECRET must not contain spaces or line breaks.");
  }

  const inviteInstallRaw = env["INVITE_INSTALL_URL"] ?? "";
  let inviteInstallUrl: string | null = null;
  if (inviteInstallRaw !== "") {
    let parsed: URL | null = null;
    try {
      parsed = new URL(inviteInstallRaw);
    } catch {
      parsed = null;
    }
    if (!parsed || parsed.protocol !== "https:") {
      throw new ConfigError("INVITE_INSTALL_URL must be a valid https:// URL.");
    }
    inviteInstallUrl = inviteInstallRaw;
  }

  const inviteCodeKeyRaw = env["INVITE_CODE_KEY"] ?? "";
  let inviteCodeKey: string | null = null;
  if (inviteCodeKeyRaw !== "") {
    if (inviteCodeKeyRaw.length < MIN_SECRET_LENGTH) {
      throw new ConfigError(`INVITE_CODE_KEY must be at least ${MIN_SECRET_LENGTH} characters.`);
    }
    if (/\s/.test(inviteCodeKeyRaw)) {
      throw new ConfigError("INVITE_CODE_KEY must not contain spaces or line breaks.");
    }
    inviteCodeKey = inviteCodeKeyRaw;
  }

  return {
    databaseUrl,
    trustProxy: Number(trustProxyRaw),
    internalSecret,
    port: Number(env["PORT"] ?? 3000),
    inviteInstallUrl,
    inviteCodeKey,
  };
}
