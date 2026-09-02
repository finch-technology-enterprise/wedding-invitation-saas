/**
 * Countdown.
 *
 * Digits are updated individually and only when their value actually
 * changes, so a tick touches at most a couple of nodes rather than
 * rewriting the whole widget every second.
 */

import { breakdown } from "./datetime.js";
import { $$ } from "./dom.js";

const ROLL_MS = 240;

export function startCountdown(root, targetDate, { reducedMotion = false } = {}) {
  const pairs = new Map();
  for (const pair of $$(".countdown__pair", root)) {
    pairs.set(pair.dataset.unit, $$(".countdown__digit", pair));
  }

  /** Replace a digit's contents with a single static glyph. */
  function settle(digitEl, char) {
    const span = document.createElement("span");
    span.textContent = char;
    digitEl.replaceChildren(span);
  }

  /** Roll one digit window from its old glyph to a new one. */
  function setDigit(digitEl, char) {
    if (digitEl.dataset.value === char) return;
    const previous = digitEl.dataset.value;
    digitEl.dataset.value = char;

    if (reducedMotion || previous === undefined) {
      settle(digitEl, char);
      return;
    }

    // Cancel any in-flight settle from a previous roll so two rapid
    // changes can never leave the window showing a stale pair.
    clearTimeout(Number(digitEl.dataset.timer));

    const out = document.createElement("span");
    out.className = "is-out";
    out.textContent = previous;

    const incoming = document.createElement("span");
    incoming.className = "is-in";
    incoming.textContent = char;

    digitEl.replaceChildren(out, incoming);

    // A single timer owns the settle. animationend is not relied upon:
    // it never fires for a display:none element (background tab), which
    // is exactly when a digit would otherwise get stuck mid-roll.
    digitEl.dataset.timer = String(
      setTimeout(() => {
        if (digitEl.dataset.value === char) settle(digitEl, char);
      }, ROLL_MS + 40)
    );
  }

  function setUnit(key, value) {
    const digits = pairs.get(key);
    if (!digits) return;
    // Days can exceed 99; show the two most significant digits we can
    // without changing the widget's geometry.
    const text = String(Math.min(value, 99)).padStart(2, "0");
    setDigit(digits[0], text[0]);
    setDigit(digits[1], text[1]);
  }

  let timer = 0;

  function tick() {
    const { days, hours, minutes, seconds } = breakdown(targetDate.getTime() - Date.now());
    setUnit("days", days);
    setUnit("hours", hours);
    setUnit("minutes", minutes);
    setUnit("seconds", seconds);

    root.setAttribute(
      "aria-label",
      days + hours + minutes + seconds === 0
        ? "婚礼已经开始"
        : `距离婚礼还有 ${days} 天 ${hours} 小时 ${minutes} 分 ${seconds} 秒`
    );

    // Stop cleanly at zero — never count into negatives.
    if (targetDate.getTime() - Date.now() <= 0) {
      clearInterval(timer);
    }
  }

  tick();
  timer = setInterval(tick, 1000);

  return () => clearInterval(timer);
}
