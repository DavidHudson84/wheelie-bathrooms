// Hire agreement:
//   POST {action:"send", hire_id}          admin only: emails the customer their signing link
//   POST {action:"get", t}                 public with token: hire details for the signing page
//   POST {action:"sign", t, ...}           public with token: records signature + licence, emails a copy
import { admin, clip, cors, esc, fmtDate, json, layout, requireAdmin, sendEmail, setting } from "../_shared/common.ts";

const TERMS_VERSION = "WB T&C 13-08-2025 (rev Nov 2026)";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const money = (n: number | null) => (n == null ? "" : "$" + Number(n).toFixed(2));

async function hireByToken(t: string) {
  if (!UUID.test(t || "")) return null;
  const { data } = await admin.from("hires").select("*, units(code,type,name)").eq("agreement_token", t).maybeSingle();
  return data;
}

function summary(h: any) {
  const unit = h.units ? `${h.units.name || h.units.type} (${h.units.code})` : "Portable bathroom";
  return {
    customer_name: h.customer_name, company: h.company, email: h.email, phone: h.phone,
    site_address: h.site_address, billing_ref: h.billing_ref, unit,
    start_date: h.start_date, end_date: h.end_date,
    weekly_rate_ex_gst: h.weekly_rate_ex_gst, delivery_fee_ex_gst: h.delivery_fee_ex_gst,
    status: h.agreement_status, signed_at: h.signed_at, signed_name: h.signed_name,
  };
}

function scheduleHtml(s: ReturnType<typeof summary>) {
  const rows = [
    ["Hirer", s.company ? `${s.customer_name} (${s.company})` : s.customer_name],
    ["Equipment", s.unit], ["Site address", s.site_address], ["Reference", s.billing_ref],
    ["Hire starts", fmtDate(s.start_date)], ["Expected end", s.end_date ? fmtDate(s.end_date) : "Open, 3 business days' notice to end"],
    ["Weekly hire", s.weekly_rate_ex_gst != null ? money(s.weekly_rate_ex_gst) + " + GST" : null],
    ["Delivery, set-up and collection", s.delivery_fee_ex_gst != null ? money(s.delivery_fee_ex_gst) + " + GST" : null],
  ].filter(([, v]) => v);
  return `<table cellpadding="6" style="border-collapse:collapse;width:100%">${rows.map(([k, v]) => `<tr><td style="color:#5a6168;width:170px">${k}</td><td><strong>${esc(v)}</strong></td></tr>`).join("")}</table>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let b: any;
  try { b = await req.json(); } catch { return json({ error: "bad request" }, 400); }
  const site = await setting("site_url");
  const notify = await setting("notify_email");

  if (b.action === "send") {
    try { await requireAdmin(req); } catch { return json({ error: "Not authorised" }, 401); }
    const { data: h } = await admin.from("hires").select("*, units(code,type,name)").eq("id", b.hire_id).maybeSingle();
    if (!h) return json({ error: "Hire not found" }, 404);
    if (!h.email) return json({ error: "Add the customer's email to the hire first" }, 400);
    if (h.agreement_status === "signed") return json({ error: "Already signed" }, 400);
    const link = `${site}/sign/?t=${h.agreement_token}`;
    const ok = await sendEmail({
      to: h.email, replyTo: notify,
      subject: "Your Wheelie Bathrooms hire agreement - please sign",
      html: layout("Please sign your hire agreement", `
        <p>Hi ${esc(h.customer_name.split(" ")[0])},</p>
        <p>Here are the details of your portable bathroom hire. Please check them, then sign online and upload a photo of your driver's licence. It takes about two minutes on your phone.</p>
        ${scheduleHtml(summary(h))}
        <p style="margin:22px 0"><a href="${link}" style="background:#1373a0;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:bold">Review and sign</a></p>
        <p style="font-size:13px;color:#5a6168">If the button doesn't work, copy this link: ${link}</p>
        <p>Questions? Reply to this email or call 0448 882 995.</p>`),
    }, { kind: "agreement-sent", hire_id: h.id });
    if (!ok) return json({ error: "Email failed to send. Check the email log." }, 502);
    await admin.from("hires").update({ agreement_status: "sent", agreement_sent_at: new Date().toISOString() }).eq("id", h.id);
    return json({ ok: true, link });
  }

  if (b.action === "get") {
    const h = await hireByToken(b.t);
    if (!h) return json({ error: "This link isn't valid. Please call 0448 882 995." }, 404);
    if (h.status === "cancelled") return json({ error: "This hire has been cancelled." }, 410);
    return json({ ok: true, hire: summary(h) });
  }

  if (b.action === "sign") {
    const h = await hireByToken(b.t);
    if (!h) return json({ error: "This link isn't valid." }, 404);
    if (h.agreement_status === "signed") return json({ error: "This agreement has already been signed." }, 409);
    const name = clip(b.signed_name, 120);
    const sig = String(b.signature_png || "");
    if (!name || name.length < 3) return json({ error: "Type your full name" }, 400);
    if (!b.agree) return json({ error: "Please accept the terms and conditions" }, 400);
    if (!b.insurance_ack) return json({ error: "Please confirm the insurance requirement" }, 400);
    if (!sig.startsWith("data:image/png;base64,") || sig.length < 2000 || sig.length > 400000) return json({ error: "Please sign in the box" }, 400);

    let licencePath: string | null = null;
    if (b.licence_file?.data) {
      const type = String(b.licence_file.type || "");
      const ext = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "application/pdf": "pdf" } as Record<string, string>)[type];
      if (!ext) return json({ error: "Licence must be a photo (JPG, PNG, HEIC) or PDF" }, 400);
      const bytes = Uint8Array.from(atob(String(b.licence_file.data)), (c) => c.charCodeAt(0));
      if (bytes.length > 10 * 1024 * 1024) return json({ error: "Licence photo is too large (10MB max)" }, 400);
      licencePath = `${h.id}/licence-${Date.now()}.${ext}`;
      const up = await admin.storage.from("licences").upload(licencePath, bytes, { contentType: type, upsert: false });
      if (up.error) return json({ error: "Couldn't save the licence photo, please try again" }, 500);
    } else {
      return json({ error: "Please add a photo of your driver's licence" }, 400);
    }

    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;
    const signedAt = new Date().toISOString();
    const { error } = await admin.from("hires").update({
      agreement_status: "signed", signed_at: signedAt, signed_name: name, signed_ip: ip,
      signature_png: sig, licence_number: clip(b.licence_number, 40), licence_path: licencePath,
      insurance_ack: true, terms_version: TERMS_VERSION,
    }).eq("id", h.id).neq("agreement_status", "signed");
    if (error) return json({ error: "Couldn't save, please try again" }, 500);

    const s = summary({ ...h, signed_name: name, signed_at: signedAt });
    const body = `${scheduleHtml(s)}
      <p>Signed by <strong>${esc(name)}</strong> on ${new Date(signedAt).toLocaleString("en-AU", { timeZone: "Australia/Melbourne" })} (Melbourne time), accepting the Wheelie Bathrooms terms and conditions (${TERMS_VERSION}): <a href="${site}/terms/">${site}/terms/</a></p>
      <p><img src="${sig}" alt="Signature" style="max-width:320px;border:1px solid #dfe5ea;border-radius:8px"></p>`;
    if (h.email) {
      await sendEmail({ to: h.email, replyTo: notify, subject: "Signed: your Wheelie Bathrooms hire agreement",
        html: layout("Thanks, your hire agreement is signed", `<p>Keep this email as your copy.</p>${body}<p>We'll be in touch about delivery. Call 0448 882 995 any time.</p>`) },
        { kind: "agreement-signed-customer", hire_id: h.id });
    }
    await sendEmail({ to: notify, subject: `Agreement signed: ${h.customer_name}, ${h.site_address}`,
      html: layout("Hire agreement signed", `${body}<p><a href="${site}/admin/#hire-${h.id}">Open the hire in admin</a> to view the licence.</p>`) },
      { kind: "agreement-signed-notify", hire_id: h.id });
    return json({ ok: true });
  }

  return json({ error: "unknown action" }, 400);
});
