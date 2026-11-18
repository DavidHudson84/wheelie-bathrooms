// Pure billing maths for Wheelie Bathrooms hires. No database or network calls, so it can be
// tested with plain Node:  node supabase/functions/_shared/billing.test.mjs
//
// Dates are ISO strings (YYYY-MM-DD). Periods are [from, to): "to" is the day the unit came
// back (or the start of the next period), matching how Stay on Hire counts billable days.

export type Item = { id: number; unit_code: string; rate_per_day: number; on_date: string; off_date: string | null; billed_until: string | null; credited_until?: string | null };
export type Charge = { id: number; description: string; amount_ex_gst: number; charge_date: string };
export type Hire = {
  id: number; hire_type: "trade" | "residential"; bill_mode: "advance" | "arrears";
  billing_cycle_days: number; terms_days: number; end_date: string | null; status: string;
  billing_ref: string | null; delivery_fee_ex_gst: number | null; mobilisation_billed: boolean;
};
export type Line = { description: string; quantity: number; unit_amount: number; kind: "hire" | "mobilisation" | "charge" | "credit"; item_id?: number; charge_id?: number; from?: string; to?: string };
export type Plan = {
  hire_id: number; kind: "advance" | "arrears" | "final" | "charges" | "credit";
  lines: Line[]; subtotal: number; invoice_date: string; due_date: string; reference: string | null;
  period_from: string | null; period_to: string | null;
  advance: { items: Record<string, [string | null, string]>; credits: Record<string, [string | null, string]>; charges: number[]; mobilisation: boolean };
};

const DAY = 86400000;
export const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);
export const diffDays = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / DAY);
const minDate = (a: string, b: string | null) => (b && b < a ? b : a);
const money = (n: number) => Math.round(n * 100) / 100;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dshort = (d: string) => `${+d.slice(8, 10)} ${MON[+d.slice(5, 7) - 1]}`;
const dlong = (d: string) => `${dshort(d)} ${d.slice(0, 4)}`;

// Same layout customers' AP teams already get from Stay on Hire.
export function hireLineText(code: string, rate: number, from: string, to: string) {
  return `Hire for #${code}\nRate: $${rate.toFixed(2)} / day\nBillable usage: ${diffDays(from, to)}d 0h 0m\nDates: ${dshort(from)} - ${dlong(to)}`;
}

/** Work out the one invoice (and, separately, any credit note) a hire needs today. */
export function planHire(h: Hire, items: Item[], charges: Charge[], today: string): Plan[] {
  const cycle = Math.max(1, h.billing_cycle_days || 28);
  const plans: Plan[] = [];
  const lines: Line[] = [];
  const adv: Plan["advance"] = { items: {}, credits: {}, charges: [], mobilisation: false };
  let pFrom: string | null = null, pTo: string | null = null;
  const advanceMode = h.hire_type === "residential" || h.bill_mode === "advance";

  for (const it of items) {
    const from = it.billed_until ?? it.on_date;
    const off = it.off_date ?? (h.status === "ended" ? h.end_date : null);
    if (off && from >= off) continue; // fully billed (or over-billed: handled by credits below)
    let to: string | null = null;
    if (advanceMode) {
      // Bill a period once it has started (residential: as soon as it's booked, so it's paid before delivery).
      const due = h.hire_type === "residential" ? true : from <= today;
      if (!due) continue;
      // Residential: bill up to the booked end date (max one cycle). Trade: one cycle, cut short by off-hire.
      const plannedEnd = off ?? (h.hire_type === "residential" ? h.end_date : null);
      to = minDate(addDays(from, cycle), plannedEnd);
    } else {
      const cycleEnd = addDays(from, cycle);
      if (off && off <= cycleEnd) { if (off <= today) to = off; }
      else if (cycleEnd <= today) to = cycleEnd;
    }
    if (!to || to <= from) continue;
    const days = diffDays(from, to);
    lines.push({ kind: "hire", item_id: it.id, from, to, quantity: days, unit_amount: it.rate_per_day, description: hireLineText(it.unit_code, it.rate_per_day, from, to) });
    adv.items[String(it.id)] = [it.billed_until, to];
    pFrom = pFrom && pFrom < from ? pFrom : from;
    pTo = pTo && pTo > to ? pTo : to;
  }

  // Mobilisation goes on the first invoice for the hire (residential: straight away, with the hire).
  const fee = Number(h.delivery_fee_ex_gst || 0);
  if (!h.mobilisation_billed && fee > 0 && (lines.length || h.hire_type === "residential")) {
    lines.push({ kind: "mobilisation", quantity: 1, unit_amount: fee, description: "Mobilisation" });
    adv.mobilisation = true;
  }

  // One-off charges ride on the next invoice, or go out alone once the hire is finished.
  const allDone = items.every((it) => { const off = it.off_date ?? (h.status === "ended" ? h.end_date : null); return off && (it.billed_until ?? it.on_date) >= off; });
  const dueCharges = charges.filter((c) => c.charge_date <= today);
  if (dueCharges.length && (lines.length || allDone || h.hire_type === "residential")) {
    for (const c of dueCharges) { lines.push({ kind: "charge", charge_id: c.id, quantity: 1, unit_amount: Number(c.amount_ex_gst), description: c.description }); adv.charges.push(c.id); }
  }

  if (lines.length) {
    const finishing = items.length > 0 && items.every((it) => {
      const off = it.off_date ?? (h.status === "ended" ? h.end_date : null);
      const until = adv.items[String(it.id)]?.[1] ?? it.billed_until ?? it.on_date;
      return off && until >= off;
    });
    const kind: Plan["kind"] = !lines.some((l) => l.kind === "hire") ? "charges" : finishing && !advanceMode ? "final" : advanceMode ? "advance" : "arrears";
    plans.push({
      hire_id: h.id, kind, lines, subtotal: money(lines.reduce((s, l) => s + l.quantity * l.unit_amount, 0)),
      invoice_date: today, due_date: addDays(today, h.hire_type === "residential" ? 0 : Math.max(0, h.terms_days)),
      reference: h.billing_ref, period_from: pFrom, period_to: pTo, advance: adv,
    });
  }

  // Trade hires billed in advance that come back early get a credit note for the unused days.
  // Residential hires don't (terms clause 4: no refunds for unused time).
  if (h.hire_type === "trade") {
    const cl: Line[] = [];
    const cadv: Plan["advance"] = { items: {}, credits: {}, charges: [], mobilisation: false };
    for (const it of items) {
      const off = it.off_date;
      if (!off || !it.billed_until || it.billed_until <= off || off > today) continue;
      const from = it.credited_until && it.credited_until > off ? it.credited_until : off;
      if (from >= it.billed_until) continue;
      const days = diffDays(from, it.billed_until);
      cl.push({ kind: "credit", item_id: it.id, from, to: it.billed_until, quantity: days, unit_amount: it.rate_per_day,
        description: `Credit: #${it.unit_code} collected ${dlong(off)}, unused hire ${dshort(from)} - ${dlong(it.billed_until)} (${days}d)` });
      cadv.credits[String(it.id)] = [it.credited_until ?? null, it.billed_until];
    }
    if (cl.length) plans.push({
      hire_id: h.id, kind: "credit", lines: cl, subtotal: money(cl.reduce((s, l) => s + l.quantity * l.unit_amount, 0)),
      invoice_date: today, due_date: today, reference: h.billing_ref, period_from: null, period_to: null, advance: cadv,
    });
  }
  return plans;
}
