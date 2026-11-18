// Daily (pg_cron, 8am Melbourne): reminds customers 7 days and 2 days before their hire's end date,
// and moves booked hires to "on hire" once their start date arrives. Called with x-cron-secret.
import { admin, esc, fmtDate, json, layout, melbourneToday, sendEmail, setting } from "../_shared/common.ts";

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);

Deno.serve(async (req) => {
  const secret = await setting("cron_secret");
  if (req.headers.get("x-cron-secret") !== secret) return json({ error: "forbidden" }, 403);
  let dry = false;
  try { dry = !!(await req.json()).dry_run; } catch { /* no body */ }
  const today = melbourneToday();
  const notify = await setting("notify_email");

  if (!dry) await admin.from("hires").update({ status: "on_hire" }).eq("status", "booked").lte("start_date", today);

  const { data: hires } = await admin.from("hires")
    .select("id, customer_name, email, site_address, end_date, reminder_7_sent_at, reminder_2_sent_at")
    .in("status", ["booked", "on_hire"]).eq("reminders_enabled", true).not("end_date", "is", null).not("email", "is", null);

  const sent: { id: number; kind: string; days: number }[] = [];
  for (const h of hires ?? []) {
    const days = daysBetween(today, h.end_date);
    let kind: "7" | "2" | null = null;
    if (days >= 0 && days <= 2 && !h.reminder_2_sent_at) kind = "2";
    else if (days > 2 && days <= 7 && !h.reminder_7_sent_at) kind = "7";
    if (!kind) continue;
    sent.push({ id: h.id, kind, days });
    if (dry) continue;
    const first = esc(h.customer_name.split(" ")[0]);
    const when = days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
    const ok = await sendEmail({
      to: h.email, bcc: [notify], replyTo: notify,
      subject: `Your Wheelie Bathrooms hire ends ${when} (${fmtDate(h.end_date)})`,
      html: layout(`Your hire ends ${when}`, `
        <p>Hi ${first},</p>
        <p>Your portable bathroom at <strong>${esc(h.site_address)}</strong> is booked to finish on <strong>${fmtDate(h.end_date)}</strong>.</p>
        <p><strong>Need it longer?</strong> Reply to this email or call 0448 882 995 and we'll extend the hire. Extending is easy, we just need to know before the end date.</p>
        <p><strong>All finished?</strong> You don't need to do anything. We'll contact you to arrange collection. Please keep clear access to the unit and take out any personal items.</p>
        <p>Thanks for choosing Wheelie Bathrooms.</p>`),
    }, { kind: `reminder-${kind}`, hire_id: h.id });
    if (ok) {
      const col = kind === "7" ? "reminder_7_sent_at" : "reminder_2_sent_at";
      // a 2-day reminder also covers the 7-day one, so a short-notice hire never gets both on consecutive days
      const patch: Record<string, string> = { [col]: new Date().toISOString() };
      if (kind === "2" && !h.reminder_7_sent_at) patch.reminder_7_sent_at = patch[col];
      await admin.from("hires").update(patch).eq("id", h.id);
    }
  }
  return json({ ok: true, today, dry_run: dry, reminders: sent });
});
