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

const TIMEOUT_MS = 15_000;

export async function runSmoke(opts: SmokeOptions): Promise<SmokeResult[]> {
  const doFetch = opts.fetch ?? fetch;

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
