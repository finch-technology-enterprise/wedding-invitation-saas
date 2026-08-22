/* global INVITE */
const I = window.INVITE;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ---------- bilingual text fill ---------- */
function t(path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), I);
}
$$("[data-i18n]").forEach((el) => {
  const v = t(el.dataset.i18n);
  if (v != null) el.textContent = v;
});

/* ---------- wedding date ---------- */
const weddingDate = new Date(I.weddingISO);

$("#wedding-date-zh").textContent = new Intl.DateTimeFormat("zh-TW", {
  year: "numeric", month: "long", day: "numeric", weekday: "long",
}).format(weddingDate);
$("#wedding-date-en").textContent = new Intl.DateTimeFormat("en-GB", {
  weekday: "short", day: "numeric", month: "long", year: "numeric",
}).format(weddingDate);

/* ---------- countdown ---------- */
const cdEls = {
  d: $("#cd-days"), h: $("#cd-hours"), m: $("#cd-mins"), s: $("#cd-secs"),
};
function pad(n) {
  return String(n).padStart(2, "0");
}
function tickCountdown() {
  let diff = Math.floor((weddingDate.getTime() - Date.now()) / 1000);
  if (diff <= 0) {
    cdEls.d.textContent = "0";
    cdEls.h.textContent = "0";
    cdEls.m.textContent = "0";
    cdEls.s.textContent = "0";
    return;
  }
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  cdEls.d.textContent = String(d);
  cdEls.h.textContent = pad(h);
  cdEls.m.textContent = pad(m);
  cdEls.s.textContent = pad(s);
}
tickCountdown();
setInterval(tickCountdown, 1000);

/* ---------- story ---------- */
const paras = $("#story-paras");
for (const p of I.story.paragraphs) {
  const el = document.createElement("p");
  const zh = document.createElement("span");
  zh.className = "zh";
  zh.textContent = p.zh;
  const en = document.createElement("span");
  en.className = "en";
  en.textContent = p.en;
  el.append(zh, en);
  paras.appendChild(el);
}

/* ---------- details ---------- */
$("#venue-zh").textContent = I.details.venue.nameZh;
$("#venue-en").textContent = I.details.venue.nameEn;
$("#addr-zh").textContent = I.details.venue.addressZh;
$("#addr-en").textContent = I.details.venue.addressEn;

const program = $("#program");
for (const item of I.details.program) {
  const li = document.createElement("li");
  const b = document.createElement("b");
  b.textContent = item.time;
  const zh = document.createElement("span");
  zh.textContent = item.zh;
  const en = document.createElement("i");
  en.className = "en";
  en.textContent = item.en;
  li.append(b, zh, en);
  program.appendChild(li);
}

const dress = $("#dresscode");
if (I.details.dressCode) {
  const zh = document.createElement("span");
  zh.className = "zh";
  zh.textContent = I.details.dressCode.zh;
  const en = document.createElement("span");
  en.className = "en";
  en.textContent = I.details.dressCode.en;
  dress.append(zh, en);
} else {
  dress.remove();
}

$("#maps-link").href = I.details.venue.mapsUrl;

/* ---------- add-to-calendar (.ics built client-side) ---------- */
function icsStamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}
function buildIcs() {
  const end = new Date(weddingDate.getTime() + 3 * 60 * 60 * 1000);
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//invite//EN",
    "BEGIN:VEVENT",
    `UID:${crypto.randomUUID()}@invite`,
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${icsStamp(weddingDate)}`,
    `DTEND:${icsStamp(end)}`,
    `SUMMARY:${I.couple.namesLine.en} - Wedding`,
    `DESCRIPTION:${I.couple.tagline.zh} / ${I.couple.tagline.en}`,
    `LOCATION:${I.details.venue.nameEn}\\, ${I.details.venue.addressEn}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}
{
  const blob = new Blob([buildIcs()], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = $("#cal-link");
  a.href = url;
  a.download = "wedding-invite.ics";
}

/* ---------- gallery + lightbox ---------- */
const grid = $("#gallery-grid");
for (const src of I.photos) {
  const btn = document.createElement("button");
  btn.type = "button";
  let ok = false;
  const img = document.createElement("img");
  img.loading = "lazy";
  img.src = src;
  img.alt = "";
  img.addEventListener("load", () => {
    ok = true;
  });
  img.addEventListener("error", () => {
    img.remove();
    btn.classList.add("noimg");
  });
  btn.appendChild(img);
  btn.addEventListener("click", () => {
    if (ok) openLightbox(src);
  });
  grid.appendChild(btn);
}
  grid.appendChild(btn);
}

const lightbox = $("#lightbox");
function openLightbox(src) {
  $("img", lightbox).src = src;
  lightbox.hidden = false;
}
function closeLightbox() {
  lightbox.hidden = true;
}
$("button", lightbox).addEventListener("click", closeLightbox);
lightbox.addEventListener("click", (e) => {
  if (e.target === lightbox) closeLightbox();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeLightbox();
});

/* ---------- paging: observer, dots, animations ---------- */
const pages = $$(".page");
const dotsNav = $("#dots");
pages.forEach((_, idx) => {
  const b = document.createElement("button");
  b.type = "button";
  b.setAttribute("aria-label", `page ${idx + 1}`);
  b.addEventListener("click", () => pages[idx].scrollIntoView({ behavior: "smooth" }));
  dotsNav.appendChild(b);
});
const dots = $$("button", dotsNav);

function playAnimations(page) {
  $$(".anim", page).forEach((el) => {
    if (el.dataset.done) return;
    el.dataset.done = "1";
    const name = el.dataset.animate || "fadeInUp";
    el.classList.add("animate__animated", `animate__${name}`);
    if (el.dataset.delay) el.style.animationDelay = `${el.dataset.delay}ms`;
    el.classList.add("in");
  });
}

const swipeHint = $("#swipe-hint");
let lastIndex = -1;
const io = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const idx = pages.indexOf(entry.target);
      if (idx === lastIndex) continue;
      lastIndex = idx;
      pages.forEach((p, i) => p.classList.toggle("active", i === idx));
      dots.forEach((d, i) => d.classList.toggle("on", i === idx));
      playAnimations(entry.target);
      const lastPage = idx >= pages.length - 1;
      swipeHint.classList.toggle("gone", lastPage);
    }
  },
  { threshold: 0.55 }
);
pages.forEach((p) => io.observe(p));

/* hide hint after any manual scroll away from top */
window.addEventListener(
  "scroll",
  () => {
    if (window.scrollY > window.innerHeight * 0.3) swipeHint.classList.add("gone");
  },
  { passive: true }
);

/* ---------- music ---------- */
const bgm = $("#bgm");
const disc = $("#music-disc");
let musicStarted = false;

async function startMusic() {
  if (musicStarted) return;
  musicStarted = true;
  if (!bgm.src) bgm.src = I.musicSrc;
  try {
    await bgm.play();
    disc.classList.add("playing");
  } catch {
    /* blocked; user can tap the disc */
  }
}
document.addEventListener(
  "pointerdown",
  () => {
    startMusic();
  },
  { once: true }
);

disc.addEventListener("click", async () => {
  if (!musicStarted) {
    musicStarted = true;
    if (!bgm.src) bgm.src = I.musicSrc;
  }
  if (bgm.paused) {
    try {
      await bgm.play();
      disc.classList.add("playing");
    } catch {
      /* ignore */
    }
  } else {
    bgm.pause();
    disc.classList.remove("playing");
  }
});

/* ---------- rsvp form ---------- */
const form = $("#rsvp-form");
const guestsSelect = $('select[name="guests"]');
for (let n = 1; n <= 12; n++) {
  const opt = document.createElement("option");
  opt.value = String(n);
  opt.textContent = String(n);
  guestsSelect.appendChild(opt);
}

const radios = $$('input[name="attending"]', form);
function syncGuestsVisibility() {
  const going = radios.find((r) => r.checked)?.value === "yes";
  $("#guests-wrap").style.display = going ? "" : "none";
}
radios.forEach((r) => r.addEventListener("change", syncGuestsVisibility));
syncGuestsVisibility();

const errBox = $("#form-error");
function showFormError(msg) {
  errBox.textContent = msg;
  errBox.hidden = false;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errBox.hidden = true;

  const fd = new FormData(form);
  const name = String(fd.get("name") || "").trim();
  const attending = radios.find((r) => r.checked)?.value === "yes";
  const phone = String(fd.get("phone") || "").trim();
  const instagram = String(fd.get("instagram") || "").trim();

  if (!name) {
    showFormError(`${t("rsvp.nameLabel.en")} is required / 请填写姓名`);
    return;
  }
  if (!phone && !instagram) {
    showFormError(`${t("rsvp.contactHint.en")} / 请至少填写一项`);
    return;
  }

  const payload = {
    name,
    attending,
    guests: Number(fd.get("guests") || 1),
    phone,
    instagram,
    message: String(fd.get("message") || ""),
    website: String(fd.get("website") || ""), // honeypot passthrough
  };

  const btn = $(".submit-btn", form);
  btn.disabled = true;
  try {
    const res = await fetch("/api/rsvp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      form.hidden = true;
      $("#rsvp-success").hidden = false;
      $("#rsvp-success").classList.add("active");
      window.scrollTo({ top: $("#rsvp").offsetTop, behavior: "smooth" });
    } else {
      showFormError(t("rsvp.errorBody.en"));
    }
  } catch {
    showFormError(t("rsvp.errorBody.en"));
  } finally {
    btn.disabled = false;
  }
});
