// Billing for Wheelie Bathrooms hires (admin page > Billing).
//   status | save_app | auth_url | disconnect   Xero connection (admin)
//   preview                                    what's due to invoice today (admin)
//   raise {hire_ids, mode:"xero"|"manual"}     create DRAFT invoices/credit notes in Xero, or record as billed elsewhere (admin)
//   sync                                       pull status and payments back from Xero (admin, or cron with x-cron-secret)
// Standing rule: never approves, never edits an approved invoice, one Xero org only.
import { admin, cors, json, melbourneToday, requireAdmin, setting } from "../_shared/common.ts";
import { planHire, type Plan } from "../_shared/billing.ts";
import { authUrl, ensureContact, saveApp, xero, xeroStatus } from "../_shared/xero.ts";

async function opt(k: string, d: string) { const { data } = await admin.rpc("get_setting", { k }); return (data as string) || d; }

async function load(hireIds?: number[]) {
  let q = admin.from("hires").select("*, customers(*), hire_items(*, units(code)), hire_charges(*)").in("status", ["booked", "on_hire", "ended"]);
  if (hireIds?.length) q = q.in("id", hireIds);
  const { data, error } = await q;
  if (error) throw error;
  return data as any[];
}

function plansFor(h: any, today: string): Plan[] {
  const items = (h.hire_items || []).map((it: any) => ({ ...it, unit_code: it.units?.code || "UNIT", rate_per_day: Number(it.rate_per_day) }));
  const charges = (h.hire_charges || []).filter((c: any) => !c.invoice_id);
  return planHire(h, items, charges, today);
}

async function applyAdvance(h: any, p: Plan, invoiceId: number) {
  for (const [id, [, after]] of Object.entries(p.advance.items)) await admin.from("hire_items").update({ billed_until: after }).eq("id", +id);
  for (const [id, [, after]] of Object.entries(p.advance.credits)) await admin.from("hire_items").update({ credited_until: after }).eq("id", +id);
  if (p.advance.charges.length) await admin.from("hire_charges").update({ invoice_id: invoiceId }).in("id", p.advance.charges);
  if (p.advance.mobilisation) await admin.from("hires").update({ mobilisation_billed: true }).eq("id", h.id);
}

async function rollback(inv: any) {
  const a = inv.advance || {};
  for (const [id, [before, after]] of Object.entries(a.items || {}) as [string, [string | null, string]][])
    await admin.from("hire_items").update({ billed_until: before }).eq("id", +id).eq("billed_until", after);
  for (const [id, [before, after]] of Object.entries(a.credits || {}) as [string, [string | null, string]][])
    await admin.from("hire_items").update({ credited_until: before }).eq("id", +id).eq("credited_until", after);
  if (a.charges?.length) await admin.from("hire_charges").update({ invoice_id: null }).in("id", a.charges).eq("invoice_id", inv.id);
  if (a.mobilisation) await admin.from("hires").update({ mobilisation_billed: false }).eq("id", inv.hire_id);
}

async function sync() {
  const { data: rows } = await admin.from("invoices").select("*").not("xero_invoice_id", "is", null)
    .or("xero_status.is.null,xero_status.in.(DRAFT,SUBMITTED,AUTHORISED)");
  let updated = 0;
  const invs = (rows || []).filter((r: any) => r.kind !== "credit");
  for (let i = 0; i < invs.length; i += 40) {
    const batch = invs.slice(i, i + 40);
    const j = await xero("GET", `Invoices?IDs=${batch.map((b: any) => b.xero_invoice_id).join(",")}`);
    for (const x of j.Invoices || []) {
      const mine = batch.find((b: any) => b.xero_invoice_id === x.InvoiceID);
      if (!mine) continue;
      const patch: any = { xero_status: x.Status, xero_number: x.InvoiceNumber, amount_due: x.AmountDue, amount_paid: x.AmountPaid, synced_at: new Date().toISOString(),
        due_date: x.DueDateString?.slice(0, 10) || mine.due_date };
      if (x.Status === "PAID" && x.FullyPaidOnDate) patch.paid_at = new Date(Number(String(x.FullyPaidOnDate).match(/\d+/)?.[0])).toISOString();
      if ((x.Status === "VOIDED" || x.Status === "DELETED") && !["VOIDED", "DELETED"].includes(mine.xero_status)) await rollback(mine);
      await admin.from("invoices").update(patch).eq("id", mine.id);
      updated++;
    }
  }
  for (const c of (rows || []).filter((r: any) => r.kind === "credit")) {
    const j = await xero("GET", `CreditNotes/${c.xero_invoice_id}`);
    const x = j.CreditNotes?.[0]; if (!x) continue;
    if ((x.Status === "VOIDED" || x.Status === "DELETED") && !["VOIDED", "DELETED"].includes(c.xero_status)) await rollback(c);
    await admin.from("invoices").update({ xero_status: x.Status, xero_number: x.CreditNoteNumber, amount_due: x.RemainingCredit, synced_at: new Date().toISOString() }).eq("id", c.id);
    updated++;
  }
  return updated;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  let b: any = {};
  try { b = await req.json(); } catch { /* empty */ }
  const isCron = req.headers.get("x-cron-secret") && req.headers.get("x-cron-secret") === (await setting("cron_secret"));
  let who = "cron";
  if (!isCron) {
    try { await requireAdmin(req); } catch { return json({ error: "Not authorised" }, 401); }
    const { data } = await admin.auth.getUser((req.headers.get("Authorization") || "").replace(/^Bearer /, ""));
    who = data?.user?.email || "admin";
  } else if (b.action !== "sync" && b.action !== "preview") return json({ error: "forbidden" }, 403);

  try {
    const today = melbourneToday();
    switch (b.action) {
      case "status": return json({ ok: true, today, xero: await xeroStatus() });
      case "save_app":
        if (!b.client_id || !b.client_secret) return json({ error: "Client ID and secret are both needed" }, 400);
        await saveApp(b.client_id, b.client_secret); return json({ ok: true });
      case "auth_url": return json({ ok: true, url: await authUrl() });
      case "disconnect":
        for (const k of ["xero_refresh_token", "xero_access_token", "xero_tenant_id", "xero_tenant_name"]) await admin.rpc("set_setting", { k, v: "" });
        return json({ ok: true });
      case "preview": {
        const hires = await load();
        const out = [];
        for (const h of hires) {
          const plans = plansFor(h, today);
          const warn = [];
          if (!h.customer_id) warn.push("No paying customer set");
          if (!(h.hire_items || []).length) warn.push("No assets on this hire");
          if (plans.length || warn.length) out.push({ hire_id: h.id, occupant: h.customer_name, site: h.site_address, customer: h.customers?.name || null, hire_type: h.hire_type, bill_mode: h.bill_mode, reference: h.billing_ref, plans, warnings: warn });
        }
        return json({ ok: true, today, due: out });
      }
      case "raise": {
        const mode = b.mode === "manual" ? "manual" : "xero";
        const ids: number[] = (b.hire_ids || []).map(Number).filter(Boolean);
        if (!ids.length) return json({ error: "Pick at least one hire" }, 400);
        const account = await opt("xero_sales_account", "200");
        const theme = await opt("xero_branding_theme_id", "");
        const results = [];
        for (const h of await load(ids)) {
          if (!h.customers) { results.push({ hire_id: h.id, error: "No paying customer set" }); continue; }
          for (const p of plansFor(h, today)) {
            try {
              let xid: string | null = null, xnum: string | null = null, xstatus: string | null = null;
              if (mode === "xero") {
                const contactId = await ensureContact(h.customers);
                const LineItems = p.lines.map((l) => ({ Description: l.description, Quantity: l.quantity, UnitAmount: l.unit_amount, AccountCode: account, TaxType: "OUTPUT" }));
                if (p.kind === "credit") {
                  const r = await xero("POST", "CreditNotes", { CreditNotes: [{ Type: "ACCRECCREDIT", Contact: { ContactID: contactId }, Date: p.invoice_date, Reference: p.reference || "", LineAmountTypes: "Exclusive", Status: "DRAFT", LineItems }] });
                  xid = r.CreditNotes[0].CreditNoteID; xnum = r.CreditNotes[0].CreditNoteNumber; xstatus = r.CreditNotes[0].Status;
                } else {
                  const r = await xero("POST", "Invoices", { Invoices: [{ Type: "ACCREC", Contact: { ContactID: contactId }, Date: p.invoice_date, DueDate: p.due_date, Reference: p.reference || "", LineAmountTypes: "Exclusive", Status: "DRAFT", BrandingThemeID: theme || undefined, LineItems }] });
                  xid = r.Invoices[0].InvoiceID; xnum = r.Invoices[0].InvoiceNumber; xstatus = r.Invoices[0].Status;
                }
                if (xstatus !== "DRAFT") throw new Error(`Xero returned status ${xstatus}, expected DRAFT`);
              }
              const { data: inv, error } = await admin.from("invoices").insert({
                created_by: who, hire_id: h.id, customer_id: h.customer_id, kind: mode === "manual" ? "manual" : p.kind,
                period_from: p.period_from, period_to: p.period_to, reference: p.reference, lines: p.lines, subtotal: p.kind === "credit" ? -p.subtotal : p.subtotal,
                invoice_date: p.invoice_date, due_date: p.due_date, xero_invoice_id: xid, xero_number: xnum || (mode === "manual" ? "billed elsewhere" : null), xero_status: xstatus,
                amount_due: mode === "xero" ? p.subtotal : null, advance: p.advance,
              }).select("id").single();
              if (error) throw error;
              await applyAdvance(h, p, inv.id);
              results.push({ hire_id: h.id, kind: p.kind, subtotal: p.subtotal, xero_number: xnum, ok: true });
            } catch (e) {
              results.push({ hire_id: h.id, kind: p.kind, error: String((e as Error).message || e) });
            }
          }
        }
        return json({ ok: true, results });
      }
      case "sync": return json({ ok: true, updated: await sync() });
    }
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
