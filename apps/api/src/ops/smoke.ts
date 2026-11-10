export interface SmokeResult {
  name: string;
  ok: boolean;
  detail: string;
}

export interface SmokeOptions {
  baseUrl: string;
  secret?: string;
  fetch?: typeof fetch;
}

// Render's free plan can take up to about a minute to wake from sleep.
const TIMEOUT_MS = 60_000;

function secretMaySend(baseUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  return (
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname)
  );
}

export async function runSmoke(opts: SmokeOptions): Promise<SmokeResult[]> {
  const doFetch = opts.fetch ?? fetch;

  if (opts.secret !== undefined && !secretMaySend(opts.baseUrl)) {
    return [
      {
        name: "secure-url",
        ok: false,
        detail: "the secret is only sent over https (or to localhost); use an https:// base URL",
      },
    ];
  }

  async function check(
    name: string,
    path: string,
    method: "GET" | "POST",
    expected: number,
    headers: Record<string, string> = {},
  ): Promise<SmokeResult> {
    try {
      const res = await doFetch(`${opts.baseUrl}${path}`, {
        method,
        headers,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const ok = res.status === expected;
      return { name, ok, detail: `${method} ${path} expected ${expected}, got ${res.status}` };
    } catch {
      return {
        name,
        ok: false,
        detail: `${method} ${path} could not connect (expected ${expected})`,
      };
    }
  }

  const results = [
    await check("health", "/health", "GET", 200),
    await check("tick-rejects-no-auth", "/internal/tick", "POST", 401),
  ];
  if (opts.secret !== undefined) {
    results.push(
      await check("tick-accepts-secret", "/internal/tick", "POST", 200, {
        Authorization: `Bearer ${opts.secret}`,
      }),
    );
  }
  return results;
}
