/**
 * RSVP form.
 *
 * Wire-compatible with the existing Worker (`POST /api/rsvp`) and with
 * the D1 schema, so `public/admin.html` keeps working unchanged.
 * The honeypot field is submitted exactly as the server expects.
 */

import { $ } from "./dom.js";

const ENDPOINT = "/api/rsvp";

/** Map the server's error codes onto human copy. */
function messageForError(code, copy) {
  switch (code) {
    case "invalid_name":
      return copy.errors.name;
    case "contact_required":
    case "invalid_phone":
    case "invalid_instagram":
      return copy.errors.contact;
    case "server_error":
      return copy.errors.server;
    default:
      return copy.errors.server;
  }
}

export function setupRsvp({ wedding, timeline, live }) {
  const copy = wedding.copy.rsvp;

  const form = $("#rsvp-form");
  const success = $("#rsvp-success");
  const errorBox = $("#rsvp-error");
  const submit = $("#rsvp-submit");
  const moreBtn = $("#rsvp-more");
  const optional = $("#rsvp-optional");
  const guestsField = $("#rsvp-guests-field");
  if (!form) return;

  const nameInput = $("#rsvp-name", form);
  const phoneInput = $("#rsvp-phone", form);
  const igInput = $("#rsvp-instagram", form);
  const radios = [...form.querySelectorAll('input[name="attending"]')];

  /* ---- optional section --------------------------------------- */

  moreBtn.addEventListener("click", () => {
    const open = optional.hidden;
    optional.hidden = !open;
    moreBtn.setAttribute("aria-expanded", String(open));
    moreBtn.textContent = open ? copy.optionalToggleOpen : copy.optionalToggle;
  });

  /* ---- guest count is meaningless when declining --------------- */

  function syncGuests() {
    const attending = radios.find((r) => r.checked)?.value === "yes";
    guestsField.hidden = !attending;
  }
  radios.forEach((r) => r.addEventListener("change", syncGuests));
  syncGuests();

  /* ---- keyboard / timeline interaction -------------------------
     Typing must not fight the moving canvas, and the focused control
     must be visible above the software keyboard. */

  for (const control of form.querySelectorAll("input, select, textarea")) {
    control.addEventListener("focus", () => {
      timeline.hold();
      // Let the keyboard animate in, then bring the field into frame.
      setTimeout(() => timeline.revealElement(control, 140), 250);
    });
    control.addEventListener("blur", () => {
      // Stay put after typing; the visitor is reading their own input.
      timeline.hold();
    });
  }

  /* ---- validation & submit ------------------------------------- */

  function showError(message, focusTarget) {
    errorBox.textContent = message;
    errorBox.hidden = false;
    if (live) live.textContent = message;
    focusTarget?.setAttribute("aria-invalid", "true");
    focusTarget?.focus({ preventScroll: true });
  }

  function clearError() {
    errorBox.hidden = true;
    errorBox.textContent = "";
    for (const c of [nameInput, phoneInput, igInput]) c?.removeAttribute("aria-invalid");
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearError();

    const name = nameInput.value.trim();
    const attending = radios.find((r) => r.checked)?.value === "yes";
    const phone = phoneInput.value.trim();
    const instagram = igInput.value.trim();

    if (!name) {
      showError(copy.errors.name, nameInput);
      return;
    }
    if (!phone && !instagram) {
      // The contact fields live in the collapsed section — open it so
      // the visitor can actually act on the message.
      if (optional.hidden) moreBtn.click();
      showError(copy.errors.contact, phoneInput);
      return;
    }

    const payload = {
      name,
      attending,
      guests: attending ? Number($("#rsvp-guests", form).value || 1) : 1,
      phone,
      instagram,
      message: $("#rsvp-message", form).value.trim(),
      website: form.elements.website.value, // honeypot passthrough
    };

    submit.disabled = true;
    submit.textContent = copy.submitting;

    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => null);

      if (res.ok && data?.ok) {
        form.hidden = true;
        success.hidden = false;
        if (live) live.textContent = `${copy.successTitle}。${copy.successBody}`;
        timeline.revealElement(success, 140);
        return;
      }

      // Server rejected it — always say something specific and visible.
      showError(messageForError(data?.error, copy));
    } catch {
      // Network/offline. Distinct from a server rejection.
      showError(copy.errors.network);
    } finally {
      submit.disabled = false;
      submit.textContent = copy.submit;
    }
  });
}
