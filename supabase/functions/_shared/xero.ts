// Xero access for the Wheelie Bathrooms org only. Tokens live in private.settings.
// Standing rule: invoices and credit notes are only ever created as DRAFT. A person approves in Xero.
import { admin } from "./common.ts";

export const XERO_SCOPES = "offline_access accounting.invoices accounting.contacts accounting.settings.read";
export const callbackUrl = () => `${Deno.env.get("SUPABASE_URL")}/functions/v1/xero-callback`;

async function opt(k: string) { const { data } = await admin.rpc("get_setting", { k }); return (data as string) || null; }
async function put(k: string, v: string) { const { error } = await admin.rpc("set_setting", { k, v }); if (error) throw error; }

export async function xeroStatus() {
  return {
    app_configured: !!(await opt("xero_client_id")) && !!(await opt("xero_client_secret")),
    connected: !!(await opt("xero_refresh_token")) && !!(await opt("xero_tenant_id")),
    tenant_name: await opt("xero_tenant_name"),
    connected_at: await opt("xero_connected_at"),
    callback_url: callbackUrl(),
  };
}

export async function saveApp(clientId: string, clientSecret: string) {
  await put("xero_client_id", clientId.trim());
  await put("xero_client_secret", clientSecret.trim());
}

export async function authUrl() {
  const state = crypto.randomUUID();
  await put("xero_oauth_state", state);
  const u = new URL("https://login.xero.com/identity/connect/authorize");
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", (await opt("xero_client_id")) || "");
  u.searchParams.set("redirect_uri", callbackUrl());
  u.searchParams.set("scope", (await opt("xero_scopes")) || XERO_SCOPES);
  u.searchParams.set("state", state);
  return u.toString();
}

async function tokenRequest(body: Record<string, string>) {
  const id = await opt("xero_client_id"), secret = await opt("xero_client_secret");
  if (!id || !secret) throw new Error("Add the Xero app Client ID and Secret first.");
  const r = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: { Authorization: "Basic " + btoa(`${id}:${secret}`), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error("Xero token error: " + (j.error || r.status));
  await put("xero_access_token", j.access_token);
  await put("xero_access_expires", String(Date.now() + (j.expires_in - 60) * 1000));
  if (j.refresh_token) await put("xero_refresh_token", j.refresh_token);
  return j.access_token as string;
}

/** Exchanges the code, keeps only the Wheelie Bathrooms connection, disconnects any other org ticked by mistake. */
export async function finishAuth(code: string, state: string) {
  if (!state || state !== (await opt("xero_oauth_state"))) throw new Error("This Xero sign-in link has expired. Start again from the admin page.");
  await put("xero_oauth_state", "");
  const token = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: callbackUrl() });
  const r = await fetch("https://api.xero.com/connections", { headers: { Authorization: `Bearer ${token}` } });
  const conns = (await r.json()) as { id: string; tenantId: string; tenantName: string; tenantType: string }[];
  const wheelie = conns.filter((c) => c.tenantType === "ORGANISATION" && /wheelie/i.test(c.tenantName));
  if (wheelie.length !== 1) throw new Error(`Expected exactly one Wheelie Bathrooms org, got: ${conns.map((c) => c.tenantName).join(", ") || "none"}`);
  for (const c of conns) if (c.id !== wheelie[0].id) await fetch(`https://api.xero.com/connections/${c.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
  await put("xero_tenant_id", wheelie[0].tenantId);
  await put("xero_tenant_name", wheelie[0].tenantName);
  await put("xero_connected_at", new Date().toISOString());
  return wheelie[0].tenantName;
}

async function accessToken() {
  const exp = Number((await opt("xero_access_expires")) || 0);
  const tok = await opt("xero_access_token");
  if (tok && exp > Date.now()) return tok;
  const refresh = await opt("xero_refresh_token");
  if (!refresh) throw new Error("Xero isn't connected yet. Connect it in admin > Billing.");
  return tokenRequest({ grant_type: "refresh_token", refresh_token: refresh });
}

export async function xero(method: string, path: string, body?: unknown) {
  const tenant = await opt("xero_tenant_id");
  if (!tenant) throw new Error("Xero isn't connected yet.");
  const r = await fetch(`https://api.xero.com/api.xro/2.0/${path}`, {
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, "Xero-tenant-id": tenant, Accept: "application/json", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let j: any = null; try { j = JSON.parse(text); } catch { /* not json */ }
  if (!r.ok) {
    const msg = j?.Elements?.[0]?.ValidationErrors?.map((e: any) => e.Message).join("; ") || j?.Message || j?.Detail || text.slice(0, 300);
    throw new Error(`Xero ${r.status}: ${msg}`);
  }
  return j;
}

export async function ensureContact(c: { id: number; name: string; email: string | null; phone: string | null; xero_contact_id: string | null }) {
  if (c.xero_contact_id) return c.xero_contact_id;
  const found = await xero("GET", `Contacts?where=${encodeURIComponent(`Name=="${c.name.replace(/"/g, "")}"`)}`);
  let id = found?.Contacts?.[0]?.ContactID;
  if (!id) {
    const made = await xero("POST", "Contacts", { Contacts: [{ Name: c.name, EmailAddress: c.email || undefined, Phones: c.phone ? [{ PhoneType: "MOBILE", PhoneNumber: c.phone }] : undefined }] });
    id = made.Contacts[0].ContactID;
  }
  await admin.from("customers").update({ xero_contact_id: id }).eq("id", c.id);
  return id as string;
}
