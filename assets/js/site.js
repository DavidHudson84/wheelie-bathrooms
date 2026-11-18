(function () {
  var WB = window.WB || {};

  // Menu: always open on desktop, a toggle on mobile. Close submenus when clicking elsewhere.
  var menu = document.querySelector("details.menu");
  var mq = window.matchMedia("(min-width: 1000px)");
  function syncMenu() { if (menu) menu.open = mq.matches; }
  syncMenu();
  mq.addEventListener ? mq.addEventListener("change", syncMenu) : mq.addListener(syncMenu);
  document.addEventListener("click", function (e) {
    document.querySelectorAll(".has-sub details[open]").forEach(function (d) {
      if (!d.contains(e.target)) d.open = false;
    });
  });

  // YouTube facade: load the player only when someone presses play
  document.querySelectorAll(".video[data-yt]").forEach(function (box) {
    box.querySelector("button").addEventListener("click", function () {
      var f = document.createElement("iframe");
      f.src = "https://www.youtube-nocookie.com/embed/" + box.dataset.yt + "?autoplay=1&rel=0";
      f.title = box.dataset.title || "Video";
      f.allow = "accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture";
      f.allowFullscreen = true;
      box.innerHTML = "";
      box.appendChild(f);
    });
  });

  // Quote forms
  document.querySelectorAll("form[data-quote]").forEach(function (form) {
    var status = form.querySelector(".form-status");
    var btn = form.querySelector("button[type=submit]");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      status.textContent = ""; status.className = "form-status";
      var bad = [];
      form.querySelectorAll("[required]").forEach(function (el) {
        var ok = el.value.trim().length > 1;
        el.classList.toggle("invalid", !ok);
        if (!ok) bad.push(el);
      });
      var phone = form.elements.phone.value.replace(/[^\d+]/g, "");
      if (phone.length < 8) { form.elements.phone.classList.add("invalid"); bad.push(form.elements.phone); }
      if (bad.length) { status.textContent = "Please fill in your name, phone and suburb."; status.classList.add("err"); bad[0].focus(); return; }
      var data = {};
      new FormData(form).forEach(function (v, k) { data[k] = String(v).trim(); });
      data.page_url = location.href;
      btn.disabled = true; btn.textContent = "Sending…";
      fetch(WB.fn + "/enquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: WB.key, Authorization: "Bearer " + WB.key },
        body: JSON.stringify(data)
      }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "Failed"); return j; }); })
        .then(function () {
          try { window.dataLayer && window.dataLayer.push({ event: "generate_lead" }); } catch (_) {}
          location.href = (WB.base || "") + "/thank-you/";
        })
        .catch(function () {
          btn.disabled = false; btn.textContent = "Send my enquiry";
          status.innerHTML = 'Sorry, that didn’t send. Please call <a href="tel:+61448882995">0448 882 995</a> or email <a href="mailto:info@wheeliebathrooms.com.au">info@wheeliebathrooms.com.au</a>.';
          status.classList.add("err");
        });
    });
  });
})();
