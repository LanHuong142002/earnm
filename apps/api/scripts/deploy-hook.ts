const hook = process.env["RENDER_DEPLOY_HOOK_URL"];
if (!hook) {
  console.error("RENDER_DEPLOY_HOOK_URL is not set. Copy the deploy hook URL from the Render service settings.");
  process.exit(1);
}

try {
  const res = await fetch(hook, { method: "POST", signal: AbortSignal.timeout(30_000) });
  if (!res.ok) {
    console.error(`Deploy hook failed: HTTP ${res.status}`);
    process.exit(1);
  }
  console.log(`Deploy triggered (HTTP ${res.status}). Watch it in the Render dashboard.`);
} catch {
  console.error("Deploy hook failed: could not reach the deploy hook URL.");
  process.exit(1);
}
