// Shared helpers for the Wheelie Bathrooms edge functions.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

export const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const cache: Record<string, string> = {};
export async function setting(k: string): Promise<string> {
  if (cache[k]) return cache[k];
  const { data, error } = await admin.rpc("get_setting", { k });
  if (error || !data) throw new Error("missing setting " + k);
  cache[k] = data as string;
  return cache[k];
}

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

export const esc = (s: unknown = "") =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const clip = (s: unknown, n: number) => (s == null ? null : String(s).trim().slice(0, n) || null);

export function melbourneToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(new Date());
}
export const fmtDate = (d: string | null) =>
  d ? new Date(d + "T00:00:00").toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "";

export function layout(title: string, inner: string) {
  return `<!doctype html><html><body style="margin:0;background:#f2f7fa;font-family:Segoe UI,Arial,sans-serif;color:#1d1b1c">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" style="max-width:600px;background:#fff;border-radius:12px" cellpadding="0" cellspacing="0">
<tr><td style="padding:24px 28px 8px"><strong style="font-size:20px;color:#1373a0">Wheelie Bathrooms</strong></td></tr>
<tr><td style="padding:8px 28px 28px;font-size:15px;line-height:1.6"><h1 style="font-size:20px;margin:0 0 12px">${esc(title)}</h1>${inner}</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #dfe5ea;font-size:12px;color:#5a6168">Wheelie Bathrooms · 0448 882 995 · info@wheeliebathrooms.com.au · 55 Derrimut Drive, Derrimut VIC 3026</td></tr>
</table></td></tr></table></body></html>`;
}

export async function sendEmail(
  opts: { to: string | string[]; subject: string; html: string; replyTo?: string; bcc?: string[]; attachments?: { filename: string; content: string }[] },
  log: { kind: string; hire_id?: number; enquiry_id?: number },
) {
  const key = await setting("resend_api_key");
  const from = await setting("from_email");
  const to = Array.isArray(opts.to) ? opts.to : [opts.to];
  let ok = false, detail = "";
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject: opts.subject, html: opts.html, reply_to: opts.replyTo, bcc: opts.bcc, attachments: opts.attachments }),
    });
    detail = (await r.text()).slice(0, 500);
    ok = r.ok;
  } catch (e) {
    detail = String(e).slice(0, 500);
  }
  await admin.from("email_log").insert({ kind: log.kind, hire_id: log.hire_id, enquiry_id: log.enquiry_id, to_email: to.join(","), ok, detail });
  return ok;
}

// Confirms the caller is signed in and on the admins list.
export async function requireAdmin(req: Request) {
  const auth = req.headers.get("Authorization") || "";
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data, error } = await userClient.rpc("is_admin");
  if (error || data !== true) throw new Error("not authorised");
}
