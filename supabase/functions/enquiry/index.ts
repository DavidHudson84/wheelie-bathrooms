// Public: website quote form. Saves the enquiry, emails info@ and sends the customer an acknowledgement.
import { admin, clip, cors, esc, json, layout, sendEmail, setting } from "../_shared/common.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let b: Record<string, string>;
  try { b = await req.json(); } catch { return json({ error: "bad request" }, 400); }

  // Honeypot: bots fill the hidden "website" field. Pretend it worked.
  if (b.website) return json({ ok: true });

  const row = {
    name: clip(b.name, 120), phone: clip(b.phone, 40), email: clip(b.email, 200),
    customer_type: clip(b.customer_type, 60), company: clip(b.company, 200),
    suburb: clip(b.suburb, 120), unit_interest: clip(b.unit_interest, 60),
    start_date: /^\d{4}-\d{2}-\d{2}$/.test(b.start_date || "") ? b.start_date : null,
    duration: clip(b.duration, 60), message: clip(b.message, 3000),
    source_page: clip(b.page_url || b.source_page, 300),
  };
  if (!row.name || !row.phone || (row.phone.replace(/\D/g, "").length < 8)) return json({ error: "Name and phone are required" }, 400);
  if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) row.email = null;

  // Basic flood protection: same phone more than 3 times in 10 minutes.
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { count } = await admin.from("enquiries").select("id", { count: "exact", head: true }).eq("phone", row.phone).gte("created_at", since);
  if ((count ?? 0) >= 3) return json({ ok: true });

  const { data, error } = await admin.from("enquiries").insert(row).select("id").single();
  if (error) return json({ error: "Could not save" }, 500);
  const id = data.id as number;

  const notify = await setting("notify_email");
  const site = await setting("site_url");
  const rows = [
    ["Name", row.name], ["Phone", row.phone], ["Email", row.email], ["Customer type", row.customer_type],
    ["Company / claim / job", row.company], ["Suburb", row.suburb], ["Unit", row.unit_interest || "Not sure"],
    ["Start date", row.start_date], ["Duration", row.duration], ["Message", row.message], ["Page", row.source_page],
  ].filter(([, v]) => v);
  const table = `<table cellpadding="6" style="border-collapse:collapse;width:100%">${rows.map(([k, v]) =>
    `<tr><td style="color:#5a6168;width:150px;vertical-align:top">${k}</td><td><strong>${esc(v).replace(/\n/g, "<br>")}</strong></td></tr>`).join("")}</table>`;
  const tel = (row.phone || "").replace(/[^\d+]/g, "");
  await sendEmail({
    to: notify,
    replyTo: row.email || undefined,
    subject: `New enquiry: ${row.name}, ${row.suburb || "no suburb"}${row.unit_interest ? ", " + row.unit_interest : ""}`,
    html: layout("New website enquiry", `${table}<p style="margin-top:18px"><a href="tel:${tel}" style="background:#1373a0;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none">Call ${esc(row.phone)}</a>
      &nbsp; <a href="${site}/admin/#enquiry-${id}">Open in admin</a></p>`),
  }, { kind: "enquiry-notify", enquiry_id: id });

  if (row.email) {
    await sendEmail({
      to: row.email,
      replyTo: notify,
      subject: "We've got your enquiry - Wheelie Bathrooms",
      html: layout(`Thanks ${row.name!.split(" ")[0]}, we've got your enquiry`, `
        <p>We'll be in touch shortly with availability and a price, usually within a couple of hours during business hours.</p>
        <p>If it helps, reply to this email with a photo or two of where the unit would go and the path to get there (for example the side gate). It lets us confirm which unit fits.</p>
        <p>Need us sooner? Call <a href="tel:+61448882995">0448 882 995</a>.</p>
        <p>The Wheelie Bathrooms team</p>`),
    }, { kind: "enquiry-ack", enquiry_id: id });
  }
  return json({ ok: true, id });
});
