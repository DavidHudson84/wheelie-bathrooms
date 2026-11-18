// node supabase/functions/_shared/billing.test.mjs
import assert from "node:assert/strict";
import { planHire, hireLineText, addDays } from "./billing.ts";

const H = (o = {}) => ({ id: 1, hire_type: "trade", bill_mode: "arrears", billing_cycle_days: 28, terms_days: 14, end_date: null, status: "on_hire", billing_ref: "RCV1", delivery_fee_ex_gst: 300, mobilisation_billed: false, ...o });
const I = (o = {}) => ({ id: 10, unit_code: "CMP4", rate_per_day: 60, on_date: "2026-10-16", off_date: null, billed_until: null, ...o });
let n = 0; const t = (name, fn) => { fn(); n++; console.log("ok", name); };

t("line text matches Stay on Hire layout", () => {
  assert.equal(hireLineText("BATH BOX 2", 60, "2026-10-16", "2026-11-13"),
    "Hire for #BATH BOX 2\nRate: $60.00 / day\nBillable usage: 28d 0h 0m\nDates: 16 Oct - 13 Nov 2026");
});

t("arrears: nothing before the cycle ends", () => {
  assert.equal(planHire(H(), [I()], [], "2026-11-12").length, 0);
});

t("arrears: 28 days + mobilisation on day 28, due in 14 days", () => {
  const [p] = planHire(H(), [I()], [], "2026-11-13");
  assert.equal(p.kind, "arrears");
  assert.equal(p.lines[0].quantity, 28);
  assert.equal(p.lines[1].description, "Mobilisation");
  assert.equal(p.subtotal, 28 * 60 + 300);
  assert.equal(p.due_date, "2026-11-27");
  assert.deepEqual(p.advance.items["10"], [null, "2026-11-13"]);
});

t("arrears: early off-hire gives a final pro-rata invoice", () => {
  const [p] = planHire(H({ mobilisation_billed: true }), [I({ off_date: "2026-10-22" })], [], "2026-10-23");
  assert.equal(p.kind, "final");
  assert.equal(p.lines[0].quantity, 6);
  assert.equal(p.subtotal, 360);
});

t("advance trade: bills the coming 28 days once the period starts", () => {
  const [p] = planHire(H({ bill_mode: "advance", mobilisation_billed: true }), [I({ billed_until: "2026-11-13" })], [], "2026-11-13");
  assert.equal(p.kind, "advance");
  assert.equal(p.period_from, "2026-11-13");
  assert.equal(p.period_to, "2026-12-11");
});

t("advance trade: early return makes a credit note for unused days", () => {
  const plans = planHire(H({ bill_mode: "advance", mobilisation_billed: true }), [I({ billed_until: "2026-11-13", off_date: "2026-11-03" })], [], "2026-11-04");
  assert.equal(plans.length, 1);
  assert.equal(plans[0].kind, "credit");
  assert.equal(plans[0].lines[0].quantity, 10);
  assert.equal(plans[0].subtotal, 600);
});

t("residential: billed up front to the booked end date, due same day, no credit on early return", () => {
  const h = H({ hire_type: "residential", end_date: "2026-11-30", terms_days: 0 });
  const [p] = planHire(h, [I({ on_date: "2026-11-25" })], [], "2026-11-19");
  assert.equal(p.kind, "advance");
  assert.equal(p.lines[0].quantity, 5);
  assert.equal(p.due_date, "2026-11-19");
  assert.equal(p.subtotal, 300 + 300);
  const back = planHire({ ...h, mobilisation_billed: true }, [I({ on_date: "2026-11-25", billed_until: "2026-11-30", off_date: "2026-11-27" })], [], "2026-11-28");
  assert.equal(back.length, 0);
});

t("residential extension bills the extra days in advance", () => {
  const h = H({ hire_type: "residential", end_date: "2026-12-07", mobilisation_billed: true });
  const [p] = planHire(h, [I({ on_date: "2026-11-25", billed_until: "2026-11-30" })], [], "2026-11-28");
  assert.equal(p.lines[0].quantity, 7);
});

t("charges ride on the next invoice, or go alone when the hire is finished", () => {
  const ch = [{ id: 5, description: "IBC pump out", amount_ex_gst: 180, charge_date: "2026-11-01" }];
  assert.equal(planHire(H({ mobilisation_billed: true }), [I()], ch, "2026-11-05").length, 0);
  const done = planHire(H({ mobilisation_billed: true }), [I({ off_date: "2026-10-30", billed_until: "2026-10-30" })], ch, "2026-11-05");
  assert.equal(done[0].kind, "charges");
  assert.equal(done[0].subtotal, 180);
});

t("two assets on one hire share an invoice", () => {
  const [p] = planHire(H(), [I(), I({ id: 11, unit_code: "Site Toilet 1", rate_per_day: 6 })], [], "2026-11-13");
  assert.equal(p.lines.filter((l) => l.kind === "hire").length, 2);
  assert.equal(p.subtotal, 28 * 60 + 28 * 6 + 300);
});

console.log(`\n${n} billing tests passed`);
