// Static site generator for wheeliebathrooms.com.au. No dependencies.
// node build/build.mjs  ->  writes the whole site to _site/
// Env: BASE_PATH ("" on the real domain, "/wheelie-bathrooms" on the github.io preview)
//      INDEXABLE ("1" only once the real domain points here; otherwise every page is noindex)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FAQS as SEED_FAQS, POSTS as SEED_POSTS, AREAS, VIDEOS } from "./content.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "_site");
const BASE = (process.env.BASE_PATH || "").replace(/\/$/, "");
const INDEXABLE = process.env.INDEXABLE === "1";
const ORIGIN = "https://wheeliebathrooms.com.au";
const SUPABASE_URL = "https://qakzwoopjnbwjqnyuiuo.supabase.co";
const SUPABASE_KEY = "sb_publishable_Ru1WwN93IIT-lN7V2yXYBQ_K_0M9fxB";
const IMAGES = JSON.parse(fs.readFileSync(path.join(ROOT, "build/images.json"), "utf8"));
const TODAY = new Date().toISOString().slice(0, 10);

const BIZ = {
  name: "Wheelie Bathrooms",
  legal: "Brothers Hudson Holdings Pty Ltd",
  abn: "68 675 536 928",
  phone: "0448 882 995",
  tel: "+61448882995",
  email: "info@wheeliebathrooms.com.au",
  street: "55 Derrimut Drive",
  locality: "Derrimut",
  postcode: "3026",
};

// ---------- helpers ----------
const u = (p) => BASE + p;
const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const abs = (p) => ORIGIN + p;

function img(name, alt, { sizes = "100vw", eager = false, cls = "" } = {}) {
  const m = IMAGES[name];
  if (!m) throw new Error("missing image " + name);
  const ws = m.sizes;
  const scale = (w) => Math.min(w, m.w) ;
  const srcset = ws.map((w) => `${u(`/assets/img/${name}-${w}.webp`)} ${scale(w)}w`).join(", ");
  const dw = scale(ws[ws.length - 1]);
  const dh = Math.round((dw * m.h) / m.w);
  return `<img src="${u(`/assets/img/${name}-${ws[ws.length > 1 ? 1 : 0]}.webp`)}" srcset="${srcset}" sizes="${sizes}" width="${dw}" height="${dh}" alt="${esc(alt)}"${eager ? ' fetchpriority="high"' : ' loading="lazy" decoding="async"'}${cls ? ` class="${cls}"` : ""}>`;
}

function md(src) {
  // Small markdown subset: ## headings, paragraphs, - and 1. lists, **bold**, [links](url)
  const inline = (s) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, h) => `<a href="${h.startsWith("/") ? u(h) : h}"${h.startsWith("http") ? ' rel="noopener"' : ""}>${t}</a>`);
  const out = [];
  let list = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const block of src.replace(/\r/g, "").split(/\n{2,}/)) {
    const lines = block.split("\n");
    if (/^#{2,3} /.test(lines[0])) {
      close();
      const lvl = lines[0].startsWith("###") ? 3 : 2;
      out.push(`<h${lvl}>${inline(lines[0].replace(/^#+ /, ""))}</h${lvl}>`);
      continue;
    }
    if (lines.every((l) => /^(- |\d+\. )/.test(l))) {
      const tag = /^\d/.test(lines[0]) ? "ol" : "ul";
      close();
      out.push(`<${tag}>` + lines.map((l) => `<li>${inline(l.replace(/^(- |\d+\. )/, ""))}</li>`).join("") + `</${tag}>`);
      continue;
    }
    close();
    out.push(`<p>${inline(lines.join(" "))}</p>`);
  }
  close();
  return out.join("\n");
}

async function fetchTable(table, query) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: { apikey: SUPABASE_KEY } });
    if (!r.ok) throw new Error(r.status + " " + (await r.text()));
    return await r.json();
  } catch (e) {
    console.warn(`! could not read ${table} from Supabase (${e.message}); using starter content`);
    return null;
  }
}

// ---------- structured data ----------
const ORG = {
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "@id": ORIGIN + "/#business",
  name: BIZ.name,
  legalName: BIZ.legal,
  url: ORIGIN + "/",
  logo: ORIGIN + "/assets/img/logo.png",
  image: ORIGIN + "/assets/img/compact-driveway.jpg",
  telephone: BIZ.tel,
  email: BIZ.email,
  description: "Portable bathroom and mobile ensuite hire for renovations, insurance repairs and events across Melbourne, Geelong and Ballarat.",
  address: { "@type": "PostalAddress", streetAddress: BIZ.street, addressLocality: BIZ.locality, addressRegion: "VIC", postalCode: BIZ.postcode, addressCountry: "AU" },
  areaServed: ["Melbourne", "Geelong", "Ballarat", "Bellarine Peninsula", "Surf Coast", "Mornington Peninsula"].map((n) => ({ "@type": "Place", name: n + ", VIC" })),
  priceRange: "$$",
  sameAs: [],
};
const ld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, "\\u003c")}</script>`;
const crumbs = (items) => ld({
  "@context": "https://schema.org", "@type": "BreadcrumbList",
  itemListElement: items.map(([name, p], i) => ({ "@type": "ListItem", position: i + 1, name, item: abs(p) })),
});

// ---------- shared pieces ----------
const NAV = [
  ["Units", null, [
    ["Compact ensuite", "/mobile-ensuite-hire/"],
    ["Standard trailer ensuite", "/portable-bathroom-hire/"],
    ["Luxury bathroom", "/luxury-portable-bathroom/"],
    ["All Access ensuite (new)", "/accessible-portable-bathroom/"],
    ["Temporary kitchen", "/temporary-kitchen-hire/"],
  ]],
  ["Insurance claims", "/insurance-temporary-bathroom/"],
  ["Renovations", "/bathroom-renovation-hire/"],
  ["Areas", null, [
    ["Melbourne", "/portable-bathroom-hire-melbourne/"],
    ["Geelong", "/portable-bathroom-hire-geelong/"],
    ["Ballarat", "/portable-bathroom-hire-ballarat/"],
  ]],
  ["FAQ", "/faq/"],
  ["Blog", "/blog/"],
];

const ICON = {
  phone: '<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"/></svg>',
  check: '<svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>',
  mail: '<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 4-8 5-8-5V6l8 5 8-5z"/></svg>',
};

function header(current) {
  const link = ([label, href, kids]) => {
    if (kids) {
      return `<li class="has-sub"><details><summary>${label}</summary><ul>${kids.map(([l, h]) => `<li><a href="${u(h)}"${h === current ? ' aria-current="page"' : ""}>${l}</a></li>`).join("")}</ul></details></li>`;
    }
    return `<li><a href="${u(href)}"${href === current ? ' aria-current="page"' : ""}>${label}</a></li>`;
  };
  return `<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap header-row">
    <a class="brand" href="${u("/")}" aria-label="Wheelie Bathrooms home"><img src="${u("/assets/img/logo.webp")}" width="177" height="79" alt="Wheelie Bathrooms"></a>
    <details class="menu">
      <summary aria-label="Menu"><span></span><span></span><span></span></summary>
      <nav aria-label="Main"><ul>${NAV.map(link).join("")}<li class="nav-cta"><a class="btn btn-sm" href="${u("/contact/")}">Get a quote</a></li></ul></nav>
    </details>
    <a class="header-phone" href="tel:${BIZ.tel}">${ICON.phone}<span>${BIZ.phone}</span></a>
  </div>
</header>`;
}

function footer() {
  return `<footer class="site-footer">
  <div class="wrap footer-grid">
    <div>
      <img src="${u("/assets/img/logo.webp")}" width="140" height="62" alt="Wheelie Bathrooms" loading="lazy">
      <p>Portable bathroom and mobile ensuite hire across Melbourne, Geelong and Ballarat.</p>
      <p><a href="tel:${BIZ.tel}">${BIZ.phone}</a><br><a href="mailto:${BIZ.email}">${BIZ.email}</a><br>${BIZ.street}, ${BIZ.locality} VIC ${BIZ.postcode}</p>
    </div>
    <div><h2>Units</h2><ul>
      <li><a href="${u("/mobile-ensuite-hire/")}">Compact ensuite hire</a></li>
      <li><a href="${u("/portable-bathroom-hire/")}">Standard trailer ensuite</a></li>
      <li><a href="${u("/luxury-portable-bathroom/")}">Luxury portable bathroom</a></li>
      <li><a href="${u("/accessible-portable-bathroom/")}">All Access ensuite</a></li>
      <li><a href="${u("/temporary-kitchen-hire/")}">Temporary kitchen hire</a></li>
    </ul></div>
    <div><h2>Who we help</h2><ul>
      <li><a href="${u("/insurance-temporary-bathroom/")}">Insurance builders and restorers</a></li>
      <li><a href="${u("/bathroom-renovation-hire/")}">Bathroom renovations</a></li>
      <li><a href="${u("/portable-bathroom-hire-melbourne/")}">Melbourne</a></li>
      <li><a href="${u("/portable-bathroom-hire-geelong/")}">Geelong</a></li>
      <li><a href="${u("/portable-bathroom-hire-ballarat/")}">Ballarat</a></li>
    </ul></div>
    <div><h2>Information</h2><ul>
      <li><a href="${u("/about/")}">About us</a></li>
      <li><a href="${u("/faq/")}">FAQ</a></li>
      <li><a href="${u("/blog/")}">Blog</a></li>
      <li><a href="${u("/contact/")}">Contact and quotes</a></li>
      <li><a href="${u("/terms/")}">Terms and conditions</a></li>
      <li><a href="${u("/privacy/")}">Privacy policy</a></li>
    </ul></div>
  </div>
  <div class="wrap legal">© ${new Date().getFullYear()} ${BIZ.legal} t/a ${BIZ.name} · ABN ${BIZ.abn}</div>
</footer>
<div class="mobile-bar"><a href="tel:${BIZ.tel}" class="btn btn-ghost">${ICON.phone} Call</a><a href="${u("/contact/")}" class="btn">Get a quote</a></div>`;
}

function quoteForm({ unit = "", heading = "Get a quote", compact = false, source = "" } = {}) {
  const opt = (v, l = v) => `<option value="${esc(v)}"${v === unit ? " selected" : ""}>${esc(l)}</option>`;
  return `<form class="quote-form${compact ? " is-compact" : ""}" data-quote novalidate>
  <h2>${heading}</h2>
  <p class="form-note">We reply the same business day, usually within a couple of hours.</p>
  <div class="grid2">
    <label>Name<input name="name" autocomplete="name" required></label>
    <label>Phone<input name="phone" type="tel" autocomplete="tel" inputmode="tel" required></label>
  </div>
  <label>Email<input name="email" type="email" autocomplete="email"></label>
  <div class="grid2">
    <label>Suburb<input name="suburb" autocomplete="address-level2" required></label>
    <label>I am a<select name="customer_type">
      ${opt("Homeowner")}${opt("Builder or renovator")}${opt("Plumber")}${opt("Insurance builder or restorer")}${opt("Insurer or loss adjuster")}${opt("Other")}
    </select></label>
  </div>
  <div class="grid2">
    <label>Unit<select name="unit_interest">
      ${opt("", "Not sure, advise me")}${opt("Compact ensuite")}${opt("Standard trailer ensuite")}${opt("Luxury bathroom")}${opt("All Access ensuite")}${opt("Temporary kitchen")}
    </select></label>
    <label>Start date<input name="start_date" type="date"></label>
  </div>
  <label>How long<select name="duration">
    ${opt("A few days")}${opt("1 to 2 weeks")}${opt("3 to 6 weeks")}${opt("2 months or more")}${opt("Not sure yet")}
  </select></label>
  ${compact ? "" : `<label>Company, claim or job number <span class="opt">(optional)</span><input name="company"></label>`}
  <label>Anything else? <span class="opt">(access, timing, where it will go)</span><textarea name="message" rows="${compact ? 2 : 4}"></textarea></label>
  <label class="hp" aria-hidden="true">Leave blank<input name="website" tabindex="-1" autocomplete="off"></label>
  <input type="hidden" name="source_page" value="${esc(source)}">
  <button class="btn btn-block" type="submit">Send my enquiry</button>
  <p class="form-status" role="status" aria-live="polite"></p>
  <p class="form-small">Or call <a href="tel:${BIZ.tel}">${BIZ.phone}</a>. See our <a href="${u("/privacy/")}">privacy policy</a>.</p>
</form>`;
}

const video = (v) => `<div class="video" data-yt="${v.id}" data-title="${esc(v.title)}">
  <img src="https://i.ytimg.com/vi/${v.id}/hqdefault.jpg" alt="" loading="lazy" width="480" height="360">
  <button type="button" aria-label="Play video: ${esc(v.title)}"><svg viewBox="0 0 68 48" width="68" height="48" aria-hidden="true"><path fill="#f00" d="M66.5 7.7A8.5 8.5 0 0 0 60.5 1.7C55.2.3 34 .3 34 .3s-21.2 0-26.5 1.4A8.5 8.5 0 0 0 1.5 7.7C.1 13 .1 24 .1 24s0 11 1.4 16.3a8.5 8.5 0 0 0 6 6C12.8 47.7 34 47.7 34 47.7s21.2 0 26.5-1.4a8.5 8.5 0 0 0 6-6C67.9 35 67.9 24 67.9 24s0-11-1.4-16.3z"/><path fill="#fff" d="M45 24 27 14v20z"/></svg></button>
  <noscript><a href="https://www.youtube.com/watch?v=${v.id}">Watch ${esc(v.title)} on YouTube</a></noscript>
</div>`;

const TESTIMONIALS = [
  ["It was great to set the mobile ensuite up in our garage, it made the family feel more secure while renovating.", "Wendy", "Compact ensuite hire, Melbourne"],
  ["Prompt service, delivered on time and well presented. It made our bathroom renovation go smoothly, no need to set up a temporary toilet or shower. Saved us time and money.", "Bernadette", "Standard ensuite hire, Melbourne"],
  ["A great mobile bathroom unit, nice, clean and spacious, plus so convenient to have it set up in the backyard during our bathroom renovation.", "Adrian", "Portable bathroom hire, Geelong"],
];
const testimonials = () => `<section class="section alt"><div class="wrap">
  <h2 class="center">What customers say</h2>
  <div class="cards three">${TESTIMONIALS.map(([q, n, w]) => `<figure class="quote"><blockquote>“${esc(q)}”</blockquote><figcaption><strong>${n}</strong><span>${w}</span></figcaption></figure>`).join("")}</div>
</div></section>`;

const FEATURES = ["Full-height shower", "Flushing dual-flush toilet", "Hand basin and mirror", "50 litre hot water service", "Lighting, exhaust fan and heater", "No chemicals, no smells"];
const featureList = (items = FEATURES) => `<ul class="ticks">${items.map((f) => `<li>${ICON.check}${esc(f)}</li>`).join("")}</ul>`;

const ctaBand = (text = "Tell us your suburb and dates and we'll come back with a price the same day.") => `<section class="cta-band"><div class="wrap">
  <h2>Need a bathroom on site?</h2><p>${text}</p>
  <div class="btns"><a class="btn btn-light" href="${u("/contact/")}">Get a quote</a><a class="btn btn-outline-light" href="tel:${BIZ.tel}">${ICON.phone} ${BIZ.phone}</a></div>
</div></section>`;

function page({ path: p, title, description, body, current = p, ldExtra = [], image = "compact-driveway", noindex = false, extraHead = "", scripts = "" }) {
  const robots = !INDEXABLE || noindex ? "noindex, nofollow" : "index, follow, max-image-preview:large";
  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="${robots}">
<link rel="canonical" href="${abs(p)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Wheelie Bathrooms">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${abs(p)}">
<meta property="og:image" content="${ORIGIN}/assets/img/${image}.jpg">
<meta property="og:locale" content="en_AU">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#1373a0">
<link rel="icon" href="${u("/favicon.png")}" type="image/png">
<link rel="apple-touch-icon" href="${u("/apple-touch-icon.png")}">
<link rel="stylesheet" href="${u("/assets/css/site.css")}?v=${BUILD_ID}">
${ld(ORG)}
${ldExtra.join("\n")}
${extraHead}
</head>
<body>
${header(current)}
<main id="main">
${body}
</main>
${footer()}
<script>window.WB={fn:"${SUPABASE_URL}/functions/v1",key:"${SUPABASE_KEY}",base:"${BASE}"};</script>
<script src="${u("/assets/js/site.js")}?v=${BUILD_ID}" defer></script>
${scripts}
</body>
</html>`;
}
const BUILD_ID = Date.now().toString(36);

// ---------- pages ----------
function home(faqs, posts) {
  return page({
    path: "/",
    title: "Portable Bathroom Hire Melbourne, Geelong & Ballarat | Wheelie Bathrooms",
    description: "Mobile ensuite and portable bathroom hire for renovations, insurance repairs and guests. Shower, toilet, basin and hot water, delivered and connected. Compact units fit through side gates.",
    body: `
<section class="hero">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <p class="eyebrow">Melbourne · Geelong · Ballarat</p>
      <h1>Portable bathroom hire, delivered and connected</h1>
      <p class="lead">A full shower, flushing toilet, basin and 50 litre hot water service, parked in your driveway, carport or backyard. Stay in your home while the bathroom is renovated or repaired.</p>
      ${featureList(["Our compact unit fits through a 1m side gate", "Connected to your sewer, water and power, no plumber needed", "Hire by the week, billed to you, your builder or insurer"])}
      <div class="btns"><a class="btn" href="#quote">Get a quote</a><a class="btn btn-ghost" href="tel:${BIZ.tel}">${ICON.phone} ${BIZ.phone}</a></div>
    </div>
    <div class="hero-media">${img("compact-driveway", "Wheelie Bathrooms compact ensuite set up in a suburban driveway during a renovation", { sizes: "(min-width: 900px) 50vw, 100vw", eager: true })}</div>
  </div>
</section>

<section class="strip"><div class="wrap strip-row">
  <span>${ICON.check} Delivered and set up in minutes</span>
  <span>${ICON.check} No chemicals, no smells</span>
  <span>${ICON.check} Insurance and trade accounts</span>
  <span>${ICON.check} 7 days</span>
</div></section>

<section class="section"><div class="wrap">
  <h2 class="center">Choose your unit</h2>
  <p class="center sub">Every unit has the same full bathroom inside. The difference is how much room you have to get it in.</p>
  <div class="cards two">
    <article class="card unit">
      <a href="${u("/mobile-ensuite-hire/")}">${img("compact-backyard", "Compact mobile ensuite in a backyard", { sizes: "(min-width: 900px) 45vw, 100vw" })}</a>
      <div class="card-body">
        <p class="tag">Most popular</p>
        <h3><a href="${u("/mobile-ensuite-hire/")}">Compact ensuite</a></h3>
        <p>1000mm wide and 2080mm high. Rolls through a standard side gate, along a path and under garage doors and carports. Built for tight suburban blocks.</p>
        <dl class="specs"><div><dt>Width</dt><dd>1000mm</dd></div><div><dt>Height</dt><dd>2080mm</dd></div><div><dt>Length</dt><dd>1800mm</dd></div></dl>
        <a class="btn btn-sm" href="${u("/mobile-ensuite-hire/")}">See the compact</a>
      </div>
    </article>
    <article class="card unit">
      <a href="${u("/portable-bathroom-hire/")}">${img("standard-trailer", "Standard trailer-mounted portable bathroom", { sizes: "(min-width: 900px) 45vw, 100vw" })}</a>
      <div class="card-body">
        <p class="tag">More room inside</p>
        <h3><a href="${u("/portable-bathroom-hire/")}">Standard trailer ensuite</a></h3>
        <p>A roomier bathroom on a road trailer. Suits open driveways, front yards, rural properties and building sites.</p>
        <dl class="specs"><div><dt>Width</dt><dd>2400mm</dd></div><div><dt>Height</dt><dd>2700mm</dd></div><div><dt>Length</dt><dd>4000mm</dd></div></dl>
        <a class="btn btn-sm" href="${u("/portable-bathroom-hire/")}">See the standard</a>
      </div>
    </article>
  </div>
  <div class="cards two mini">
    <a class="mini-card" href="${u("/luxury-portable-bathroom/")}"><strong>Luxury portable bathroom</strong><span>For weddings, events and long stays.</span></a>
    <a class="mini-card" href="${u("/accessible-portable-bathroom/")}"><strong>All Access ensuite <em>new</em></strong><span>Level-entry shower and wheelchair ramp. Register your interest.</span></a>
  </div>
</div></section>

<section class="section alt"><div class="wrap">
  <h2 class="center">Who hires a Wheelie Bathroom</h2>
  <div class="cards four">
    <a class="use" href="${u("/bathroom-renovation-hire/")}"><h3>Bathroom renovations</h3><p>Keep the family at home while your only bathroom is gutted and rebuilt.</p></a>
    <a class="use" href="${u("/insurance-temporary-bathroom/")}"><h3>Insurance repairs</h3><p>Water, fire and storm claims. Cheaper than alternative accommodation, billed to the builder.</p></a>
    <a class="use" href="${u("/contact/")}"><h3>Extra guests</h3><p>Christmas, a family visit or a full house for a few weeks.</p></a>
    <a class="use" href="${u("/accessible-portable-bathroom/")}"><h3>Ageing and mobility</h3><p>Coming home from hospital before the house has been modified.</p></a>
  </div>
</div></section>

<section class="section"><div class="wrap split">
  <div>
    <h2>How hire works</h2>
    <ol class="steps">
      <li><strong>Tell us about the site.</strong> Suburb, dates, and a photo of where it will go if you can.</li>
      <li><strong>We deliver and connect.</strong> Sewer, water and power, tested before we leave.</li>
      <li><strong>Use it like your own bathroom.</strong> Call us any time if something isn't right.</li>
      <li><strong>We collect it.</strong> Give us three business days' notice and we disconnect and take it away.</li>
    </ol>
  </div>
  <div>${video(VIDEOS.about)}</div>
</div></section>

${testimonials()}

<section class="section"><div class="wrap split">
  <div>
    <h2>Delivered across Melbourne, Geelong and Ballarat</h2>
    <p>We're based in Derrimut in Melbourne's west. Delivery, set-up and collection is one flat fee within 50km of the Melbourne CBD, Geelong or Ballarat, and charged by the kilometre beyond that.</p>
    <p class="area-links"><a href="${u("/portable-bathroom-hire-melbourne/")}">Melbourne</a><a href="${u("/portable-bathroom-hire-geelong/")}">Geelong</a><a href="${u("/portable-bathroom-hire-ballarat/")}">Ballarat</a></p>
  </div>
  <div>
    <h2>Common questions</h2>
    ${faqList(faqs.slice(0, 5))}
    <p><a href="${u("/faq/")}">All questions</a></p>
  </div>
</div></section>

${posts.length ? `<section class="section alt"><div class="wrap"><h2 class="center">From the blog</h2>${postCards(posts.slice(0, 3))}</div></section>` : ""}

<section class="section" id="quote"><div class="wrap narrow">${quoteForm({ source: "home" })}</div></section>
`,
  });
}

const faqList = (faqs) => `<div class="faq">${faqs.map((f) => `<details><summary>${esc(f.question)}</summary><div>${md(f.answer)}</div></details>`).join("")}</div>`;
const faqLd = (faqs) => ld({
  "@context": "https://schema.org", "@type": "FAQPage",
  mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: f.answer } })),
});

function postCards(posts) {
  return `<div class="cards three">${posts.map((p) => `<article class="card post">
    <a href="${u(`/blog/${p.slug}/`)}">${p.cover_image && IMAGES[p.cover_image] ? img(p.cover_image, "", { sizes: "(min-width: 900px) 30vw, 100vw" }) : p.cover_image ? `<img src="${esc(p.cover_image)}" alt="" loading="lazy">` : ""}</a>
    <div class="card-body"><time datetime="${p.published_at}">${fmtDate(p.published_at)}</time><h3><a href="${u(`/blog/${p.slug}/`)}">${esc(p.title)}</a></h3><p>${esc(p.description || "")}</p></div>
  </article>`).join("")}</div>`;
}
const fmtDate = (d) => new Date(d + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });

function productPage(o) {
  const product = ld({
    "@context": "https://schema.org", "@type": "Service",
    name: o.h1, serviceType: "Portable bathroom hire", provider: { "@id": ORIGIN + "/#business" },
    areaServed: ["Melbourne", "Geelong", "Ballarat"].map((n) => ({ "@type": "City", name: n })),
    description: o.description, image: ORIGIN + `/assets/img/${o.hero}.jpg`,
  });
  return page({
    path: o.path, title: o.title, description: o.description, image: o.hero,
    ldExtra: [product, crumbs([["Home", "/"], [o.crumb, o.path]])],
    body: `
<section class="page-hero"><div class="wrap hero-grid">
  <div class="hero-copy">
    <p class="eyebrow">${o.eyebrow}</p>
    <h1>${o.h1}</h1>
    <p class="lead">${o.lead}</p>
    ${o.specs ? `<dl class="specs big">${o.specs.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>` : ""}
    <div class="btns"><a class="btn" href="#quote">Get a quote</a><a class="btn btn-ghost" href="tel:${BIZ.tel}">${ICON.phone} ${BIZ.phone}</a></div>
  </div>
  <div class="hero-media">${img(o.hero, o.heroAlt, { sizes: "(min-width: 900px) 50vw, 100vw", eager: true })}</div>
</div></section>
${o.sections}
${o.gallery ? `<section class="section alt"><div class="wrap"><h2 class="center">${o.galleryTitle || "Photos"}</h2><div class="gallery">${o.gallery.map(([n, a]) => `<figure>${img(n, a, { sizes: "(min-width: 900px) 25vw, 50vw" })}</figure>`).join("")}</div></div></section>` : ""}
${testimonials()}
<section class="section" id="quote"><div class="wrap narrow">${quoteForm({ unit: o.unit, heading: o.formHeading || "Get a quote", source: o.path })}</div></section>`,
  });
}

function compactPage() {
  return productPage({
    path: "/mobile-ensuite-hire/", crumb: "Compact ensuite", unit: "Compact ensuite", hero: "compact-side-path",
    heroAlt: "Compact mobile ensuite on castors next to a house",
    title: "Compact Mobile Ensuite Hire | Fits Through Side Gates | Wheelie Bathrooms",
    description: "Compact mobile ensuite hire in Melbourne, Geelong and Ballarat. 1000mm wide and 2080mm high, so it fits through side gates and under garage doors. Shower, toilet, basin, 50L hot water.",
    eyebrow: "Compact ensuite", h1: "Compact mobile ensuite hire",
    lead: "A full bathroom that fits where trailer units can't. At 1000mm wide it rolls through a standard side gate, and at 2080mm high it goes under garage doors and carports.",
    specs: [["Width", "1000mm"], ["Height", "2080mm"], ["Length", "1800mm"], ["Hot water", "50 litres"]],
    sections: `
<section class="section"><div class="wrap split">
  <div>
    <h2>Everything a bathroom needs</h2>
    ${featureList([...FEATURES, "Pop-up roof for full standing headroom", "Lockable door"])}
    <p>The roof lifts once the unit is in place, so you get full headroom inside even though it's low enough to roll into a garage.</p>
  </div>
  <div>${video(VIDEOS.compact)}</div>
</div></section>
<section class="section alt"><div class="wrap split">
  <div>
    <h2>Where it goes</h2>
    <p>Most portable bathrooms are 4 metre trailers about 2.6 metres high, so they need open driveway frontage. The compact is built for the blocks where that doesn't exist:</p>
    ${featureList(["Through a side gate into the backyard", "Under a carport or into a garage", "Along a path beside the house", "Into a courtyard or unit development"])}
    <p>It needs a level, firm base and must be within 30m of a sewer point and 40m of water and power. <a href="${u("/blog/will-a-portable-ensuite-fit-at-my-place/")}">How to measure up</a>.</p>
  </div>
  <div>${img("floorplan-compact", "Compact ensuite floor plan: toilet, basin and shower in 1800mm by 860mm", { sizes: "(min-width: 900px) 45vw, 100vw" })}</div>
</div></section>`,
    gallery: [["compact-interior", "Inside the compact ensuite: toilet, basin and shower"], ["compact-door-open", "Compact ensuite lit up at night with the door open"], ["compact-garage", "Compact ensuite set up inside a garage"], ["compact-narrow", "Compact ensuite end-on, 1000mm wide"], ["compact-toilet", "Compact ensuite toilet and hand basin"], ["compact-shower", "Compact ensuite shower"], ["compact-hot-water", "50 litre hot water service in the services bay"], ["compact-front", "Compact ensuite with the door closed"]],
  });
}

function standardPage() {
  return productPage({
    path: "/portable-bathroom-hire/", crumb: "Standard trailer ensuite", unit: "Standard trailer ensuite", hero: "standard-trailer",
    heroAlt: "Standard trailer-mounted Wheelie Bathrooms portable bathroom",
    title: "Portable Bathroom Hire | Trailer Mounted Ensuite | Wheelie Bathrooms",
    description: "Trailer-mounted portable bathroom hire in Melbourne, Geelong and Ballarat. Roomy shower, toilet, basin and 50L hot water, delivered, connected and collected.",
    eyebrow: "Standard trailer ensuite", h1: "Portable bathroom hire: the standard trailer ensuite",
    lead: "Our roomiest unit, built on a road trailer. Ideal for open driveways, front yards, rural properties and building sites where height and length aren't a problem.",
    specs: [["Width needed", "2400mm"], ["Height needed", "2700mm"], ["Length needed", "4000mm"], ["Hot water", "50 litres"]],
    sections: `
<section class="section"><div class="wrap split">
  <div>
    <h2>A proper bathroom, on wheels</h2>
    ${featureList(FEATURES)}
    <p>The extra floor space makes it the better pick for longer hires, larger families and anyone who needs a bit more room to move.</p>
  </div>
  <div>${video(VIDEOS.standard)}</div>
</div></section>
<section class="section alt"><div class="wrap split">
  <div>
    <h2>Site requirements</h2>
    <p>Allow about 4000mm of length (including the drawbar), 2400mm of width and 2700mm of overhead clearance. The ground needs to be level and firm. It must be within 30m of a sewer point and 40m of water and power.</p>
    <p>Tight on space? The <a href="${u("/mobile-ensuite-hire/")}">compact ensuite</a> fits through a 1m side gate.</p>
  </div>
  <div>${img("floorplan-standard", "Standard trailer ensuite dimensions: 2700mm high, 2400mm wide, 4000mm long", { sizes: "(min-width: 900px) 45vw, 100vw" })}</div>
</div></section>`,
    gallery: [["standard-trailer-2", "Standard trailer ensuite exterior"], ["standard-shower", "Standard trailer ensuite shower"], ["standard-basin", "Hand basin and mirror"], ["compact-classic-toilet", "Dual-flush toilet"]],
  });
}

function luxuryPage() {
  return productPage({
    path: "/luxury-portable-bathroom/", crumb: "Luxury portable bathroom", unit: "Luxury bathroom", hero: "compact-door-open",
    heroAlt: "Portable bathroom with the door open and lights on",
    title: "Luxury Portable Bathroom Hire | Weddings, Events & Long Stays | Wheelie Bathrooms",
    description: "Luxury portable bathroom hire for weddings, events, home stays and long renovations in Melbourne, Geelong and Ballarat. Talk to us about availability and set-up.",
    eyebrow: "Luxury portable bathroom", h1: "Luxury portable bathroom hire",
    lead: "A finished, hotel-style bathroom for weddings, private events and long stays, when a standard hire unit isn't the look you want.",
    sections: `
<section class="section"><div class="wrap split">
  <div>
    <h2>Take a look inside</h2>
    <p>Our luxury unit is available in limited numbers, so availability depends on dates. Tell us the event or stay, the site and how many guests, and we'll confirm what we can supply.</p>
    ${featureList(["Full-height shower and flushing toilet", "Vanity basin and mirror", "50 litre hot water", "Lighting and exhaust fan", "Delivered, connected and collected by our team"])}
  </div>
  <div>${video(VIDEOS.luxury)}</div>
</div></section>`,
    formHeading: "Check availability",
  });
}

function accessiblePage() {
  return productPage({
    path: "/accessible-portable-bathroom/", crumb: "All Access ensuite", unit: "All Access ensuite", hero: "compact-interior",
    heroAlt: "Inside a Wheelie Bathrooms unit",
    title: "Accessible Portable Bathroom Hire | All Access Ensuite | Wheelie Bathrooms",
    description: "The Wheelie Bathrooms All Access mobile ensuite: level-entry shower, fold-down seat, grab rails, 1000mm door and a wheelchair ramp. Coming to Melbourne, Geelong and Ballarat. Register your interest.",
    eyebrow: "Coming soon", h1: "All Access mobile ensuite",
    lead: "A wheelchair-accessible bathroom on a trailer, for people coming home from hospital, NDIS participants and families caring for someone at home while the house is modified.",
    specs: [["Door", "1000mm clear"], ["Turning circle", "1540mm"], ["Ramp", "1:8, handrails"], ["Hot water", "50 litres"]],
    sections: `
<section class="section"><div class="wrap split">
  <div>
    <h2>Designed around AS 1428.1</h2>
    <p>The layout is benchmarked to the Australian standard for accessible sanitary facilities, then adapted to fit on a trailer.</p>
    ${featureList(["Level-entry shower with no step or hob", "Fold-down shower seat and hand shower on a slide rail", "L-shaped and flip-up grab rails beside the toilet", "Wall-hung basin with knee clearance", "Removable non-slip ramp with handrails both sides", "Switches and power points 900 to 1100mm high", "Emergency call button"])}
  </div>
  <div class="panel">
    <h3>Register your interest</h3>
    <p>We're finalising the build now. Tell us when you need one and where, and we'll contact you as soon as units are available. Occupational therapists, hospitals and NDIS support coordinators are welcome to get in touch.</p>
    <a class="btn" href="#quote">Register interest</a>
  </div>
</div></section>`,
    formHeading: "Register your interest",
  });
}

function kitchenPage() {
  const p = "/temporary-kitchen-hire/";
  return page({
    path: p, title: "Temporary Kitchen Hire Melbourne | Insurance & Renovation | Wheelie Bathrooms",
    description: "Temporary kitchen hire for insurance repairs and kitchen renovations across Melbourne, Geelong and Ballarat. Delivered, connected and collected. Ask about availability.",
    ldExtra: [crumbs([["Home", "/"], ["Temporary kitchen hire", p]]), ld({ "@context": "https://schema.org", "@type": "Service", name: "Temporary kitchen hire", serviceType: "Temporary kitchen hire", provider: { "@id": ORIGIN + "/#business" }, areaServed: ["Melbourne", "Geelong", "Ballarat"].map((n) => ({ "@type": "City", name: n })) })],
    body: `
<section class="page-hero slim"><div class="wrap narrow">
  <p class="eyebrow">Temporary kitchen</p>
  <h1>Temporary kitchen hire</h1>
  <p class="lead">When a fire, flood or renovation takes out the kitchen, we can put a working temporary kitchen on site so the household can keep cooking at home.</p>
  <div class="btns"><a class="btn" href="#quote">Check availability</a><a class="btn btn-ghost" href="tel:${BIZ.tel}">${ICON.phone} ${BIZ.phone}</a></div>
</div></section>
<section class="section"><div class="wrap split">
  <div>
    <h2>For insurance builders and restorers</h2>
    <p>A kitchen on site keeps the family in the house during the repair instead of in alternative accommodation, and saves the meal allowance. We bill your job or claim number directly.</p>
    <h2>For kitchen renovations</h2>
    <p>Renovating the only kitchen in the house means weeks of takeaway. A temporary kitchen in the driveway or yard lets you keep cooking while the trades work.</p>
  </div>
  <div class="panel">
    <h3>How it works</h3>
    ${featureList(["Delivered, set up and connected by our team", "Hired by the day or week, as long as the job takes", "Collected once the new kitchen is in", "Can be booked with a portable bathroom on the same job"])}
    <p>We have limited kitchen units, so tell us the site, dates and expected length of the job and we'll confirm availability.</p>
  </div>
</div></section>
<section class="section" id="quote"><div class="wrap narrow">${quoteForm({ unit: "Temporary kitchen", heading: "Check availability", source: p })}</div></section>`,
  });
}

function audiencePage(o) {
  return page({
    path: o.path, title: o.title, description: o.description, image: o.hero,
    ldExtra: [crumbs([["Home", "/"], [o.crumb, o.path]]), ld({ "@context": "https://schema.org", "@type": "Service", name: o.h1, provider: { "@id": ORIGIN + "/#business" }, serviceType: "Portable bathroom hire", audience: { "@type": "Audience", audienceType: o.audience } })],
    body: `
<section class="page-hero"><div class="wrap hero-grid">
  <div class="hero-copy"><p class="eyebrow">${o.eyebrow}</p><h1>${o.h1}</h1><p class="lead">${o.lead}</p>
  <div class="btns"><a class="btn" href="#quote">${o.cta || "Get a quote"}</a><a class="btn btn-ghost" href="tel:${BIZ.tel}">${ICON.phone} ${BIZ.phone}</a></div></div>
  <div class="hero-media">${img(o.hero, o.heroAlt, { sizes: "(min-width: 900px) 50vw, 100vw", eager: true })}</div>
</div></section>
${o.sections}
${testimonials()}
<section class="section" id="quote"><div class="wrap narrow">${quoteForm({ source: o.path, heading: o.formHeading || "Get a quote" })}</div></section>`,
  });
}

function insurancePage() {
  return audiencePage({
    path: "/insurance-temporary-bathroom/", crumb: "Insurance claims", audience: "Insurance builders, restoration contractors, loss adjusters",
    title: "Temporary Bathroom Hire for Insurance Claims | Wheelie Bathrooms",
    description: "Mobile ensuite hire for insurance builders, restorers and loss adjusters on water, fire, storm and impact claims across Victoria. Keep the policyholder at home. Billed to your job number.",
    eyebrow: "Insurance builders, restorers and loss adjusters", h1: "Temporary bathrooms for insurance claims",
    lead: "Keep the policyholder at home instead of in paid accommodation. We deliver a full working bathroom to site, often within 24 hours, and invoice your job or claim number.",
    hero: "compact-backyard", heroAlt: "Mobile ensuite set up in the backyard of a house under repair",
    cta: "Book a unit", formHeading: "Book a unit or ask for account rates",
    sections: `
<section class="section"><div class="wrap cards three">
  <div class="panel"><h2>Cheaper than relocating</h2><p>A unit on site usually costs a fraction of nightly accommodation for a household, and there's no relocation, no meal allowance and no unhappy customer calling the insurer.</p></div>
  <div class="panel"><h2>Fits the sites others can't</h2><p>Our compact unit is 1000mm wide and 2080mm high. It goes through side gates and into garages when the driveway is full of skips and drying equipment.</p></div>
  <div class="panel"><h2>Set up for trade accounts</h2><p>Invoices against your job, PO or claim number. Agreed rates for regular builders. Long remediation periods are no problem.</p></div>
</div></section>
<section class="section alt"><div class="wrap split">
  <div>
    <h2>Claim types we support</h2>
    ${featureList(["Burst pipes and water damage", "Fire and smoke damage", "Storm and flood", "Vehicle and tree impact", "Mould remediation", "Long-duration drying and rebuilds"])}
  </div>
  <div>
    <h2>Compliance on request</h2>
    ${featureList(["Public liability and workers compensation cover", "Risk assessments and SWMS", "Site documentation and induction", "ABN registered, GST invoices", "Seven-day availability"])}
  </div>
</div></section>
<section class="section"><div class="wrap narrow">
  <h2>How a claim hire runs</h2>
  <ol class="steps">
    <li><strong>Send the job.</strong> Claim or job number, site address, a site contact and an estimated duration.</li>
    <li><strong>We mobilise.</strong> Often within 24 hours, depending on location and fleet availability.</li>
    <li><strong>On hire.</strong> The occupants use it like their own bathroom. We handle any service calls.</li>
    <li><strong>Collection.</strong> Three business days' notice once the bathroom is back in service.</li>
  </ol>
  <p><a href="${u("/blog/temporary-bathroom-for-insurance-claims/")}">Read more about claim hires</a></p>
</div></section>`,
  });
}

function renovationPage() {
  return audiencePage({
    path: "/bathroom-renovation-hire/", crumb: "Bathroom renovations", audience: "Homeowners, builders, bathroom renovators and plumbers",
    title: "Portable Bathroom Hire for Renovations | Builders & Homeowners | Wheelie Bathrooms",
    description: "Renovating your only bathroom? Hire a mobile ensuite with shower, toilet, basin and hot water for the length of the job. For homeowners, builders, bathroom renovators and plumbers.",
    eyebrow: "Homeowners, builders, renovators and plumbers", h1: "Portable bathroom hire for bathroom renovations",
    lead: "Renovating the only bathroom in the house doesn't have to mean moving out. We park a full bathroom in your driveway, carport or backyard for the length of the job.",
    hero: "compact-driveway", heroAlt: "Compact ensuite in a driveway next to a skip bin during a renovation",
    sections: `
<section class="section"><div class="wrap split">
  <div>
    <h2>For homeowners</h2>
    <p>Stay home, keep your routine and keep an eye on the trades. Hire runs by the week, so if the job runs over you just keep the unit longer. We need three business days' notice to collect.</p>
    <h2>For builders, renovators and plumbers</h2>
    <p>Offer your clients a bathroom on site as part of the quote. We deliver before strip-out, collect after the final check and can bill you or the homeowner directly. Ask about trade rates for regular work.</p>
  </div>
  <div>
    <h2>Four steps</h2>
    <ol class="steps">
      <li><strong>Quote.</strong> Suburb, start date, expected length and a photo of the spot.</li>
      <li><strong>Delivery.</strong> We place, level and connect the unit and test everything.</li>
      <li><strong>During the works.</strong> Use it like your own bathroom.</li>
      <li><strong>Collection.</strong> We disconnect and remove it once the new bathroom is ready.</li>
    </ol>
  </div>
</div></section>
<section class="section alt"><div class="wrap cards two">
  <a class="card unit-link" href="${u("/mobile-ensuite-hire/")}">${img("compact-garage", "Compact ensuite in a garage", { sizes: "(min-width: 900px) 45vw, 100vw" })}<div class="card-body"><h3>Compact ensuite</h3><p>For side gates, carports and garages.</p></div></a>
  <a class="card unit-link" href="${u("/portable-bathroom-hire/")}">${img("standard-trailer-2", "Standard trailer ensuite", { sizes: "(min-width: 900px) 45vw, 100vw" })}<div class="card-body"><h3>Standard trailer ensuite</h3><p>For open driveways and front yards.</p></div></a>
</div></section>`,
  });
}

function areaPage(key) {
  const a = AREAS[key];
  const p = `/portable-bathroom-hire-${key}/`;
  return page({
    path: p, title: a.title, description: a.description,
    ldExtra: [crumbs([["Home", "/"], [`Portable bathroom hire ${a.name}`, p]]), ld({ "@context": "https://schema.org", "@type": "Service", name: `Portable bathroom hire ${a.name}`, serviceType: "Portable bathroom hire", provider: { "@id": ORIGIN + "/#business" }, areaServed: { "@type": "City", name: a.name + ", VIC" } })],
    body: `
<section class="page-hero"><div class="wrap hero-grid">
  <div class="hero-copy"><p class="eyebrow">${a.name} and surrounds</p><h1>Portable bathroom hire in ${a.name}</h1><p class="lead">${a.intro}</p>
  <div class="btns"><a class="btn" href="#quote">Get a quote</a><a class="btn btn-ghost" href="tel:${BIZ.tel}">${ICON.phone} ${BIZ.phone}</a></div></div>
  <div class="hero-media">${img(key === "melbourne" ? "compact-driveway" : key === "geelong" ? "compact-backyard" : "compact-garage", `Mobile ensuite hire in ${a.name}`, { sizes: "(min-width: 900px) 50vw, 100vw", eager: true })}</div>
</div></section>
<section class="section"><div class="wrap split">
  <div><h2>Mobile ensuites for ${a.name} homes and job sites</h2><p>${a.detail}</p>${featureList(FEATURES)}</div>
  <div><h2>Two sizes</h2>
    <p><a href="${u("/mobile-ensuite-hire/")}"><strong>Compact ensuite</strong></a>: 1000mm wide, 2080mm high. Through side gates, under carports and into garages.</p>
    <p><a href="${u("/portable-bathroom-hire/")}"><strong>Standard trailer ensuite</strong></a>: more room inside, for open driveways and yards.</p>
    <p>Hiring for an insurance claim? See <a href="${u("/insurance-temporary-bathroom/")}">temporary bathrooms for insurance claims</a>.</p>
  </div>
</div></section>
<section class="section alt"><div class="wrap"><h2>Suburbs we deliver to around ${a.name}</h2><p class="suburbs">${a.suburbs.map(esc).join(" · ")}</p><p>Not listed? We go further. Ask us.</p></div></section>
${testimonials()}
<section class="section" id="quote"><div class="wrap narrow">${quoteForm({ source: p })}</div></section>`,
  });
}

function faqPage(faqs) {
  return page({
    path: "/faq/", title: "Portable Bathroom Hire FAQ | Wheelie Bathrooms",
    description: "Answers about mobile ensuite hire: installation, how far from sewer and power, whether it fits, septic tanks, hot water, what can be flushed and how billing works.",
    ldExtra: [faqLd(faqs), crumbs([["Home", "/"], ["FAQ", "/faq/"]])],
    body: `<section class="page-hero slim"><div class="wrap"><h1>Frequently asked questions</h1><p class="lead">Everything people ask before they hire a portable bathroom. Can't see your question? Call ${BIZ.phone}.</p></div></section>
<section class="section"><div class="wrap narrow">${faqList(faqs)}</div></section>
${ctaBand()}`,
  });
}

function aboutPage() {
  return page({
    path: "/about/", title: "About Wheelie Bathrooms | Portable Bathroom Hire Victoria",
    description: "Wheelie Bathrooms is a family-owned portable bathroom hire business based in Derrimut, serving Melbourne, Geelong and Ballarat homeowners, builders and insurers.",
    ldExtra: [crumbs([["Home", "/"], ["About", "/about/"]])],
    body: `<section class="page-hero slim"><div class="wrap"><h1>About Wheelie Bathrooms</h1></div></section>
<section class="section"><div class="wrap split">
  <div>
    <p class="lead">Wheelie Bathrooms is owned and run by the Hudson brothers, whose family has worked in Melbourne's insurance repair and restoration trade for decades.</p>
    <p>We bought the business in 2024 and have been building out the fleet since, including our compact ensuites, which we make in-house so they fit the narrow side gates and low carports common across Melbourne's suburbs.</p>
    <p>We're based in Derrimut and deliver across Melbourne, Geelong and Ballarat. Most of our work comes from homeowners renovating their only bathroom, and from insurance builders and restorers who need to keep a family at home during a repair.</p>
    <p>Every unit is delivered, connected, tested and collected by our own team.</p>
  </div>
  <div>${video(VIDEOS.about)}</div>
</div></section>
${ctaBand()}`,
  });
}

function contactPage() {
  return page({
    path: "/contact/", title: "Contact Wheelie Bathrooms | Get a Portable Bathroom Hire Quote",
    description: "Get a quote for portable bathroom or mobile ensuite hire in Melbourne, Geelong or Ballarat. Call 0448 882 995 or send your suburb and dates.",
    ldExtra: [crumbs([["Home", "/"], ["Contact", "/contact/"]])],
    body: `<section class="section"><div class="wrap split contact">
  <div>
    <h1>Get a quote</h1>
    <p class="lead">Send your suburb, dates and roughly where the unit will go. We'll confirm the right unit and send a price, usually the same day.</p>
    <p class="contact-line"><a href="tel:${BIZ.tel}">${ICON.phone} ${BIZ.phone}</a></p>
    <p class="contact-line"><a href="mailto:${BIZ.email}">${ICON.mail} ${BIZ.email}</a></p>
    <p>${BIZ.street}, ${BIZ.locality} VIC ${BIZ.postcode}<br>Open 7 days</p>
    <h2>Helpful to include</h2>
    ${featureList(["Suburb or full site address", "Start date and how long you think you'll need it", "Width of your side gate if the unit is going into the backyard", "Claim or job number if it's an insurance repair"])}
  </div>
  <div>${quoteForm({ source: "contact" })}</div>
</div></section>`,
  });
}

function thanksPage() {
  return page({
    path: "/thank-you/", title: "Thanks, we've got your enquiry | Wheelie Bathrooms", noindex: true,
    description: "Your enquiry has been received.",
    body: `<section class="section"><div class="wrap narrow center">
  <h1>Thanks, we've got your enquiry</h1>
  <p class="lead">We'll be in touch shortly, usually within a couple of hours during business hours. If it's urgent, call <a href="tel:${BIZ.tel}">${BIZ.phone}</a>.</p>
  <p>While you wait, here's a look at the units.</p>
</div><div class="wrap cards two">${video(VIDEOS.compact)}${video(VIDEOS.standard)}</div></section>`,
  });
}

function legalPage(p, title, text) {
  const html = text.split("\n").map((l) => {
    if (/^\d+\. /.test(l)) return `<h2>${esc(l)}</h2>`;
    return `<p>${esc(l)}</p>`;
  }).join("\n");
  return page({
    path: p, title: `${title} | Wheelie Bathrooms`, description: `${title} for Wheelie Bathrooms portable bathroom hire.`,
    body: `<section class="page-hero slim"><div class="wrap"><h1>${title}</h1></div></section><section class="section"><div class="wrap narrow legal-text">${html}</div></section>`,
  });
}

function blogIndex(posts) {
  return page({
    path: "/blog/", title: "Portable Bathroom Hire Guides & News | Wheelie Bathrooms Blog",
    description: "Practical guides on portable bathroom hire for renovations, insurance repairs and tight sites in Melbourne, Geelong and Ballarat.",
    ldExtra: [crumbs([["Home", "/"], ["Blog", "/blog/"]])],
    body: `<section class="page-hero slim"><div class="wrap"><h1>Blog</h1><p class="lead">Guides for homeowners, builders and insurers.</p></div></section>
<section class="section"><div class="wrap">${posts.length ? postCards(posts) : "<p>No posts yet.</p>"}</div></section>`,
  });
}

function postPage(post) {
  const p = `/blog/${post.slug}/`;
  const cover = post.cover_image && IMAGES[post.cover_image] ? post.cover_image : null;
  return page({
    path: p, title: `${post.title} | Wheelie Bathrooms`, description: post.description || post.title, image: cover || "compact-driveway",
    ldExtra: [crumbs([["Home", "/"], ["Blog", "/blog/"], [post.title, p]]), ld({
      "@context": "https://schema.org", "@type": "BlogPosting", headline: post.title, description: post.description,
      datePublished: post.published_at, dateModified: (post.updated_at || post.published_at).slice(0, 10),
      author: { "@type": "Organization", name: BIZ.name }, publisher: { "@id": ORIGIN + "/#business" },
      mainEntityOfPage: abs(p), image: cover ? ORIGIN + `/assets/img/${cover}.jpg` : post.cover_image || undefined,
    })],
    body: `<article class="section post-body"><div class="wrap narrow">
  <p class="crumbs"><a href="${u("/blog/")}">Blog</a></p>
  <h1>${esc(post.title)}</h1>
  <p class="meta"><time datetime="${post.published_at}">${fmtDate(post.published_at)}</time></p>
  ${cover ? img(cover, "", { sizes: "(min-width: 760px) 720px, 100vw", eager: true, cls: "post-cover" }) : post.cover_image ? `<img class="post-cover" src="${esc(post.cover_image)}" alt="">` : ""}
  ${md(post.body_md)}
</div></article>
${ctaBand()}`,
  });
}

function redirectPage(from, to) {
  return `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><title>Moved</title><link rel="canonical" href="${abs(to)}"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0; url=${u(to)}"></head><body><a href="${u(to)}">This page has moved</a></body></html>`;
}

function signPage() {
  const terms = fs.readFileSync(path.join(ROOT, "content/terms.txt"), "utf8").split("\n")
    .map((l) => (/^\d+\. /.test(l) ? `<h3>${esc(l)}</h3>` : `<p>${esc(l)}</p>`)).join("");
  return page({
    path: "/sign/", title: "Sign your hire agreement | Wheelie Bathrooms", description: "Wheelie Bathrooms hire agreement", noindex: true,
    body: `<section class="section sign"><div class="wrap narrow">
  <h1>Your hire agreement</h1>
  <div id="sign-load"><p>Loading your hire details…</p></div>
  <div id="sign-error" class="panel" hidden></div>
  <div id="sign-done" class="panel" hidden><h2>Thanks, you're all signed</h2><p>We've emailed you a copy. We'll be in touch about delivery. Questions? Call <a href="tel:${BIZ.tel}">${BIZ.phone}</a>.</p></div>
  <form id="sign-form" class="quote-form" hidden novalidate>
    <h2>1. Check your details</h2>
    <dl id="schedule" class="schedule"></dl>
    <p class="form-small">Something wrong? Call <a href="tel:${BIZ.tel}">${BIZ.phone}</a> before signing.</p>
    <h2>2. Read the terms</h2>
    <details class="terms-box"><summary>Wheelie Bathrooms terms and conditions</summary><div>${terms}</div></details>
    <label class="check"><input type="checkbox" name="agree" required> I have read and accept the Wheelie Bathrooms terms and conditions, and I'm authorised to sign for the hirer.</label>
    <label class="check"><input type="checkbox" name="insurance_ack" required> I understand that while the unit is on hire I'm responsible for it, and that clause 8 asks the hirer to hold public liability cover and cover for theft, loss or damage to the unit.</label>
    <h2>3. Your driver's licence</h2>
    <label>Licence number<input name="licence_number" autocomplete="off"></label>
    <label>Photo of the front of your licence<input name="licence" type="file" accept="image/*,application/pdf" required></label>
    <h2>4. Sign</h2>
    <label>Full name<input name="signed_name" autocomplete="name" required></label>
    <div class="sig-wrap"><canvas id="sig" width="700" height="220" aria-label="Signature pad"></canvas><button type="button" id="sig-clear" class="btn btn-sm btn-ghost">Clear</button></div>
    <p class="form-small">Sign with your finger or mouse in the box.</p>
    <button class="btn btn-block" type="submit">Sign agreement</button>
    <p class="form-status" role="status" aria-live="polite"></p>
  </form>
</div></section>`,
    extraHead: `<style>
.schedule{display:grid;grid-template-columns:auto 1fr;gap:6px 16px;margin:0 0 8px}.schedule dt{color:var(--muted)}.schedule dd{margin:0;font-weight:700}
.terms-box{border:1px solid var(--line);border-radius:10px;padding:12px 16px;margin-bottom:16px}.terms-box summary{cursor:pointer;font-weight:700}.terms-box>div{max-height:50vh;overflow:auto;font-size:.92rem;margin-top:10px}.terms-box h3{font-size:1rem;margin-top:1em}
.check{display:flex!important;gap:10px;align-items:flex-start;font-weight:500!important}.check input{width:22px!important;height:22px;flex:none;margin:2px 0 0!important}
.sig-wrap{position:relative;border:2px dashed #9fb3c2;border-radius:10px;background:#fbfdfe}.sig-wrap canvas{width:100%;height:180px;display:block;touch-action:none}.sig-wrap button{position:absolute;right:8px;top:8px}
.sign h2{font-size:1.2rem;margin-top:1.4em}</style>`,
    scripts: `<script src="${u("/assets/js/sign.js")}?v=${BUILD_ID}" defer></script>`,
  });
}

function notFound() {
  return page({
    path: "/404.html", title: "Page not found | Wheelie Bathrooms", description: "Page not found", noindex: true,
    body: `<section class="section"><div class="wrap narrow center"><h1>We couldn't find that page</h1><p class="lead">Try the <a href="${u("/")}">home page</a>, our <a href="${u("/faq/")}">FAQ</a>, or call ${BIZ.phone}.</p></div></section>`,
  });
}

// ---------- write ----------
function write(rel, html) {
  const f = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, html);
}
function copyDir(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    e.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
  }
}

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  const dbFaqs = await fetchTable("faqs", "select=question,answer,sort&published=eq.true&order=sort.asc,id.asc");
  const faqs = dbFaqs?.length ? dbFaqs : SEED_FAQS.map(([question, answer]) => ({ question, answer }));
  const dbPosts = await fetchTable("posts", "select=slug,title,description,body_md,cover_image,published_at,updated_at&published=eq.true&order=published_at.desc");
  const posts = dbPosts ?? SEED_POSTS;

  const pages = {
    "/": home(faqs, posts),
    "/mobile-ensuite-hire/": compactPage(),
    "/portable-bathroom-hire/": standardPage(),
    "/luxury-portable-bathroom/": luxuryPage(),
    "/accessible-portable-bathroom/": accessiblePage(),
    "/insurance-temporary-bathroom/": insurancePage(),
    "/bathroom-renovation-hire/": renovationPage(),
    "/temporary-kitchen-hire/": kitchenPage(),
    "/faq/": faqPage(faqs),
    "/about/": aboutPage(),
    "/contact/": contactPage(),
    "/blog/": blogIndex(posts),
    "/terms/": legalPage("/terms/", "Terms and conditions", fs.readFileSync(path.join(ROOT, "content/terms.txt"), "utf8")),
    "/privacy/": legalPage("/privacy/", "Privacy policy", fs.readFileSync(path.join(ROOT, "content/privacy.txt"), "utf8")),
  };
  for (const k of Object.keys(AREAS)) pages[`/portable-bathroom-hire-${k}/`] = areaPage(k);
  for (const p of posts) pages[`/blog/${p.slug}/`] = postPage(p);

  for (const [p, html] of Object.entries(pages)) write(p + "index.html", html);
  write("thank-you/index.html", thanksPage());
  write("sign/index.html", signPage());
  write("404.html", notFound());
  // old WordPress URL that duplicated the compact page
  write("mobile-ensuite/index.html", redirectPage("/mobile-ensuite/", "/mobile-ensuite-hire/"));

  // static folders
  copyDir(path.join(ROOT, "assets"), path.join(OUT, "assets"));
  copyDir(path.join(ROOT, "admin"), path.join(OUT, "admin"));
  for (const f of ["favicon.png", "apple-touch-icon.png", "CNAME"]) if (fs.existsSync(path.join(ROOT, f))) fs.copyFileSync(path.join(ROOT, f), path.join(OUT, f));

  const indexable = Object.keys(pages);
  write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${indexable.map((p) => `  <url><loc>${abs(p)}</loc><lastmod>${TODAY}</lastmod></url>`).join("\n")}\n</urlset>\n`);
  write("robots.txt", INDEXABLE ? `User-agent: *\nDisallow: /admin/\nDisallow: /sign/\nDisallow: /thank-you/\n\nSitemap: ${ORIGIN}/sitemap.xml\n` : `User-agent: *\nDisallow: /\n`);
  write(".nojekyll", "");
  console.log(`built ${indexable.length + 3} pages, ${posts.length} posts, ${faqs.length} FAQs -> _site (base "${BASE}", indexable ${INDEXABLE})`);
}
main().catch((e) => { console.error(e); process.exit(1); });
