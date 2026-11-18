// Xero sends the browser back here after David approves access. Public by necessity;
// protected by the one-time state value created by the admin-only auth_url action.
import { setting } from "../_shared/common.ts";
import { finishAuth } from "../_shared/xero.ts";

Deno.serve(async (req) => {
  const u = new URL(req.url);
  const site = await setting("site_url");
  const back = (msg: string, ok: boolean) =>
    Response.redirect(`${site}/admin/?xero=${ok ? "connected" : "error"}&msg=${encodeURIComponent(msg)}#billing`, 302);
  if (u.searchParams.get("error")) return back(u.searchParams.get("error_description") || u.searchParams.get("error")!, false);
  try {
    const name = await finishAuth(u.searchParams.get("code") || "", u.searchParams.get("state") || "");
    return back(`Connected to ${name}`, true);
  } catch (e) {
    return back(String((e as Error).message || e), false);
  }
});
