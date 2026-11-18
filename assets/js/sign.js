(function () {
  var WB = window.WB;
  var t = new URLSearchParams(location.search).get("t");
  var $ = function (id) { return document.getElementById(id); };
  var form = $("sign-form"), status = form.querySelector(".form-status");

  function call(body) {
    return fetch(WB.fn + "/agreement", {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: WB.key, Authorization: "Bearer " + WB.key },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "Something went wrong"); return j; }); });
  }
  function fail(msg) { $("sign-load").hidden = true; var e = $("sign-error"); e.hidden = false; e.innerHTML = "<p>" + msg + "</p>"; }
  var fmt = function (d) { return d ? new Date(d + "T00:00:00").toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "long", year: "numeric" }) : ""; };
  var money = function (n) { return n == null ? "" : "$" + Number(n).toFixed(2) + " + GST"; };
  var escH = function (s) { var d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; };

  if (!t) return fail("This link is incomplete. Please use the link in your email, or call 0448 882 995.");
  call({ action: "get", t: t }).then(function (j) {
    var h = j.hire;
    $("sign-load").hidden = true;
    if (h.status === "signed") { $("sign-done").hidden = false; return; }
    var rows = [["Hirer", h.company ? h.customer_name + " (" + h.company + ")" : h.customer_name], ["Equipment", h.unit], ["Site address", h.site_address],
      ["Reference", h.billing_ref], ["Hire starts", fmt(h.start_date)], ["Expected end", h.end_date ? fmt(h.end_date) : "Open (3 business days' notice to end)"],
      ["Weekly hire", h.weekly_rate_ex_gst != null ? money(h.weekly_rate_ex_gst) : ""], ["Delivery, set-up and collection", h.delivery_fee_ex_gst != null ? money(h.delivery_fee_ex_gst) : ""]];
    $("schedule").innerHTML = rows.filter(function (r) { return r[1]; }).map(function (r) { return "<dt>" + r[0] + "</dt><dd>" + escH(r[1]) + "</dd>"; }).join("");
    form.signed_name.value = h.customer_name || "";
    form.hidden = false;
  }).catch(function (e) { fail(e.message); });

  // signature pad
  var c = $("sig"), ctx = c.getContext("2d"), drawing = false, inked = 0, last = null;
  ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#111";
  function pos(e) { var r = c.getBoundingClientRect(); return { x: (e.clientX - r.left) * c.width / r.width, y: (e.clientY - r.top) * c.height / r.height }; }
  c.addEventListener("pointerdown", function (e) { drawing = true; last = pos(e); c.setPointerCapture(e.pointerId); });
  c.addEventListener("pointermove", function (e) {
    if (!drawing) return; var p = pos(e);
    ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    inked += Math.abs(p.x - last.x) + Math.abs(p.y - last.y); last = p;
  });
  ["pointerup", "pointercancel", "pointerleave"].forEach(function (ev) { c.addEventListener(ev, function () { drawing = false; }); });
  $("sig-clear").addEventListener("click", function () { ctx.clearRect(0, 0, c.width, c.height); inked = 0; });

  // shrink large photos before upload
  function readLicence(file) {
    return new Promise(function (resolve, reject) {
      if (!file) return reject(new Error("Please add a photo of your driver's licence"));
      var canShrink = /^image\/(jpeg|png|webp)$/.test(file.type);
      if (!canShrink) {
        if (file.size > 10 * 1024 * 1024) return reject(new Error("That file is over 10MB. Please take a smaller photo."));
        var fr = new FileReader();
        fr.onload = function () { resolve({ type: file.type || "image/heic", data: String(fr.result).split(",")[1] }); };
        fr.onerror = reject; fr.readAsDataURL(file); return;
      }
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var s = Math.min(1, 1800 / Math.max(img.width, img.height));
        var cv = document.createElement("canvas"); cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url);
        resolve({ type: "image/jpeg", data: cv.toDataURL("image/jpeg", 0.85).split(",")[1] });
      };
      img.onerror = function () { reject(new Error("Couldn't read that photo. Try another.")); };
      img.src = url;
    });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    status.textContent = ""; status.className = "form-status";
    var err = !form.agree.checked ? "Please tick to accept the terms." : !form.insurance_ack.checked ? "Please tick the insurance acknowledgement." :
      form.signed_name.value.trim().length < 3 ? "Please type your full name." : inked < 60 ? "Please sign in the box." : !form.licence.files[0] ? "Please add a photo of your licence." : "";
    if (err) { status.textContent = err; status.classList.add("err"); return; }
    var btn = form.querySelector("button[type=submit]"); btn.disabled = true; btn.textContent = "Signing…";
    readLicence(form.licence.files[0]).then(function (lic) {
      return call({ action: "sign", t: t, signed_name: form.signed_name.value.trim(), licence_number: form.licence_number.value.trim(),
        agree: true, insurance_ack: true, signature_png: c.toDataURL("image/png"), licence_file: lic });
    }).then(function () { form.hidden = true; $("sign-done").hidden = false; window.scrollTo(0, 0); })
      .catch(function (e) { btn.disabled = false; btn.textContent = "Sign agreement"; status.textContent = e.message; status.classList.add("err"); });
  });
})();
