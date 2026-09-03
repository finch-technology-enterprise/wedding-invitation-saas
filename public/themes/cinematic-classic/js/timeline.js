/**
 * Cinematic timeline controller.
 *
 * The document never scrolls. The long scene canvas is moved through
 * a fixed viewport by a single translate3d on #stage.
 *
 * Motion has two sources that share one offset:
 *
 *   auto   — a rAF-driven linear drift covering the whole canvas in
 *            `duration` ms. It is *not* a CSS transition, because a
 *            transition cannot be interrupted mid-flight and read back
 *            without layout thrash; a rAF integrator lets a drag take
 *            over on the exact current pixel with no jump.
 *   drag   — direct pointer manipulation, with rubber-band resistance
 *            past either end and inertial release.
 *
 * Only `transform` is written, so everything stays on the compositor.
 */

const RUBBER = 0.55;

/** Progressive resistance past a boundary. */
function rubberband(overshoot, dimension, c = RUBBER) {
  return (overshoot * dimension * c) / (dimension + c * Math.abs(overshoot));
}

export function createTimeline({
  stage,
  viewport,
  duration = 72_000,
  resumeDelay = 2_600,
  reducedMotion = false,
}) {
  let min = 0; // most negative offset (fully scrolled)
  let offset = 0; // current translate, 0 → min
  let travel = 0; // total scrollable distance (positive)

  let auto = !reducedMotion; // is auto-drift enabled at all
  let playing = false;
  let rafId = 0;
  let lastTs = 0;
  let resumeTimer = 0;

  let drag = null;
  let velocity = 0; // px/ms, for inertial release
  let inertiaId = 0;

  /** Optional barrier: auto-drift parks here and does not resume. */
  let stopAtFn = null;
  let parked = false;

  const listeners = new Set();

  /* ---- geometry ------------------------------------------------ */

  function measure() {
    const visible = viewport.clientHeight;
    const total = stage.scrollHeight;
    travel = Math.max(0, total - visible);
    min = -travel;
    offset = Math.max(min, Math.min(0, offset));
    apply();
  }

  /** Set while the controller writes its own transform, so the
      MutationObserver can distinguish our writes from external ones. */
  let writing = false;

  function apply() {
    writing = true;
    stage.style.transform = `translate3d(0, ${offset.toFixed(2)}px, 0)`;
    writing = false;
    for (const fn of listeners) fn(offset, travel);
  }

  function setOffset(next) {
    offset = next;
    apply();
  }

  /** Clamp hard (used on release and by programmatic seeks). */
  function clamp(v) {
    return Math.max(min, Math.min(0, v));
  }

  /* ---- auto drift ---------------------------------------------- */

  function step(ts) {
    if (!playing) return;
    if (!lastTs) lastTs = ts;
    const dt = Math.min(ts - lastTs, 64); // ignore tab-switch jumps
    lastTs = ts;

    if (travel > 0) {
      const pxPerMs = travel / duration;
      let next = offset - pxPerMs * dt;

      // Park at the barrier (the RSVP form) rather than drifting over it
      // while the visitor is trying to fill it in.
      const barrier = stopAtFn?.();
      if (barrier != null && -next >= barrier) {
        setOffset(-barrier);
        parked = true;
        stop();
        return;
      }

      if (next <= min) {
        setOffset(min);
        stop();
        return;
      }
      setOffset(next);
    }
    rafId = requestAnimationFrame(step);
  }

  function play() {
    if (!auto || playing || parked || travel <= 0) return;
    if (offset <= min) return; // already at the end
    // Never auto-resume once the visitor has reached the barrier.
    const barrier = stopAtFn?.();
    if (barrier != null && -offset >= barrier) {
      parked = true;
      return;
    }
    playing = true;
    lastTs = 0;
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(step);
  }

  function stop() {
    playing = false;
    lastTs = 0;
    cancelAnimationFrame(rafId);
  }

  /** Pause now, and schedule a resume unless something pauses again. */
  function pauseThenResume() {
    stop();
    clearTimeout(resumeTimer);
    if (!auto) return;
    resumeTimer = setTimeout(play, resumeDelay);
  }

  function holdIndefinitely() {
    stop();
    clearTimeout(resumeTimer);
  }

  /* ---- inertia ------------------------------------------------- */

  function runInertia() {
    cancelAnimationFrame(inertiaId);
    let v = velocity;
    let last = performance.now();

    const tick = (now) => {
      const dt = Math.min(now - last, 64);
      last = now;
      v *= Math.pow(0.94, dt / 16.67); // frame-rate independent decay

      let next = offset + v * dt;

      // Ease back inside the bounds rather than stopping dead.
      if (next > 0) {
        next = 0;
        v = 0;
      } else if (next < min) {
        next = min;
        v = 0;
      }
      setOffset(next);

      if (Math.abs(v) > 0.02) {
        inertiaId = requestAnimationFrame(tick);
      } else {
        setOffset(clamp(offset));
        pauseThenResume();
      }
    };
    inertiaId = requestAnimationFrame(tick);
  }

  /* ---- drag ---------------------------------------------------- */

  /** Form controls must keep their native behaviour. */
  function isInteractive(target) {
    return !!(
      target instanceof Element &&
      target.closest("input, textarea, select, button, a, label, [contenteditable]")
    );
  }

  function onPointerDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (isInteractive(e.target)) return;

    cancelAnimationFrame(inertiaId);
    holdIndefinitely();

    drag = {
      id: e.pointerId,
      startY: e.clientY,
      startX: e.clientX,
      startOffset: offset,
      axis: null, // resolved on first move: 'y' | 'x'
      history: [[e.clientY, e.timeStamp]],
    };
    velocity = 0;
  }

  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.id) return;

    const dy = e.clientY - drag.startY;
    const dx = e.clientX - drag.startX;

    // Lock the axis once, so a horizontal swipe never nudges the stage.
    if (drag.axis === null) {
      if (Math.abs(dy) < 4 && Math.abs(dx) < 4) return;
      drag.axis = Math.abs(dy) >= Math.abs(dx) ? "y" : "x";
      if (drag.axis === "y") viewport.setPointerCapture(e.pointerId);
    }
    if (drag.axis !== "y") return;

    e.preventDefault();

    let next = drag.startOffset + dy;
    const height = viewport.clientHeight;
    if (next > 0) next = rubberband(next, height);
    else if (next < min) next = min + rubberband(next - min, height);

    drag.history.push([e.clientY, e.timeStamp]);
    if (drag.history.length > 6) drag.history.shift();

    setOffset(next);
  }

  function endDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const wasVertical = drag.axis === "y";
    const history = drag.history;
    drag = null;

    if (!wasVertical) {
      pauseThenResume();
      return;
    }

    // Release velocity, measured across the tail of the pointer history.
    //
    // It must be derived from the recorded moves rather than from the
    // pointerup event: pointerup usually reports the same coordinate as
    // the final pointermove, so comparing against it yields ~0 and the
    // flick dies on release.
    velocity = 0;
    if (history.length >= 2) {
      const [lastY, lastT] = history[history.length - 1];
      for (let i = history.length - 2; i >= 0; i--) {
        const [y, t] = history[i];
        const dt = lastT - t;
        if (dt >= 12) {
          velocity = (lastY - y) / dt;
          break;
        }
      }
      // Very fast flicks can fit inside one 12ms window; fall back to the
      // full history so they are not silently dropped.
      if (velocity === 0) {
        const [y0, t0] = history[0];
        const dt = lastT - t0;
        if (dt > 0) velocity = (lastY - y0) / dt;
      }
      // A stale gesture (finger held still before lifting) has no throw.
      if (e.timeStamp - lastT > 90) velocity = 0;
    }

    const outOfBounds = offset > 0 || offset < min;
    if (outOfBounds) {
      setOffset(clamp(offset));
      pauseThenResume();
    } else if (Math.abs(velocity) > 0.05) {
      runInertia();
    } else {
      pauseThenResume();
    }
  }

  /* ---- public -------------------------------------------------- */

  function seekTo(px, { hold = true } = {}) {
    cancelAnimationFrame(inertiaId);
    if (hold) holdIndefinitely();
    setOffset(clamp(px));
    const barrier = stopAtFn?.();
    if (barrier != null && -offset >= barrier) parked = true;
  }

  /**
   * Adopt a transform applied to #stage from outside the controller
   * (tests and tooling do this to jump to a scene). Without it the next
   * animation frame would overwrite the jump with the stale offset.
   */
  function syncFromDom() {
    if (writing) return; // our own write, already accounted for
    const m = new DOMMatrixReadOnly(getComputedStyle(stage).transform);
    if (Math.abs(m.m42 - offset) < 0.5) return;
    offset = clamp(m.m42);
    const barrier = stopAtFn?.();
    if (barrier != null && -offset >= barrier) {
      parked = true;
      stop();
    }
    for (const fn of listeners) fn(offset, travel);
  }

  // A transform written directly onto the stage is treated as a real
  // seek rather than being clobbered on the next tick.
  const mo = new MutationObserver(syncFromDom);
  mo.observe(stage, { attributes: true, attributeFilter: ["style"] });

  /** Bring an element fully into view, with a little breathing room. */
  function revealElement(node, pad = 24) {
    const stageTop = stage.getBoundingClientRect().top;
    const nodeTop = node.getBoundingClientRect().top;
    const localTop = nodeTop - stageTop; // position within the canvas
    const target = -(localTop - pad);
    seekTo(target);
  }

  viewport.addEventListener("pointerdown", onPointerDown, { passive: true });
  viewport.addEventListener("pointermove", onPointerMove, { passive: false });
  viewport.addEventListener("pointerup", endDrag);
  viewport.addEventListener("pointercancel", endDrag);

  // Re-measure when layout can change beneath us.
  const ro = new ResizeObserver(measure);
  ro.observe(stage);
  window.addEventListener("resize", measure);
  window.addEventListener("orientationchange", measure);

  // Don't drift while the tab is hidden — it would silently skip ahead.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else if (auto) play();
  });

  return {
    measure,
    play,
    stop,
    hold: holdIndefinitely,
    pauseThenResume,
    seekTo,
    syncFromDom,
    revealElement,
    /**
     * Install a barrier the auto-drift will not pass. `fn` returns the
     * distance (positive px from the canvas top) at which to park; it is
     * called lazily so it stays correct as layout settles.
     */
    stopAt(fn) {
      stopAtFn = fn;
    },
    onChange: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    get offset() {
      return offset;
    },
    get travel() {
      return travel;
    },
    get isPlaying() {
      return playing;
    },
    setAuto(v) {
      auto = v;
      if (!v) holdIndefinitely();
    },
    setDuration(ms) {
      if (Number.isFinite(ms) && ms > 5_000) duration = ms;
    },
  };
}
