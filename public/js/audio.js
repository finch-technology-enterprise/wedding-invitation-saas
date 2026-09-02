/**
 * Background music.
 *
 * Rules:
 *  - The cinematic timeline never depends on playback succeeding.
 *  - A blocked autoplay is normal, not an error: the control simply
 *    shows its muted state and the first tap starts the track.
 *  - A missing audio file degrades to the same muted state with no
 *    console noise and no broken UI.
 */

export function setupAudio({ audio, toggle, src, title, onDuration }) {
  let available = true;
  let started = false;

  toggle.setAttribute("aria-label", `播放${title}`);

  function paint(isPlaying) {
    toggle.classList.toggle("is-playing", isPlaying);
    toggle.setAttribute("aria-pressed", String(isPlaying));
    toggle.setAttribute("aria-label", `${isPlaying ? "暂停" : "播放"}${title}`);
  }

  // A missing or undecodable file disables the control quietly.
  audio.addEventListener("error", () => {
    available = false;
    paint(false);
    toggle.setAttribute("aria-disabled", "true");
    toggle.title = "背景音乐尚未设置";
  });

  // Once metadata lands, let the caller sync timeline pacing to the track.
  audio.addEventListener("loadedmetadata", () => {
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      onDuration?.(audio.duration * 1000);
    }
  });

  audio.addEventListener("play", () => paint(true));
  audio.addEventListener("pause", () => paint(false));
  audio.addEventListener("ended", () => paint(false));

  function ensureSrc() {
    if (!audio.getAttribute("src")) audio.setAttribute("src", src);
  }

  async function tryPlay() {
    if (!available) return false;
    ensureSrc();
    try {
      await audio.play();
      started = true;
      return true;
    } catch {
      // Autoplay policy or a decode failure. Neither is user-facing.
      paint(false);
      return false;
    }
  }

  toggle.addEventListener("click", async () => {
    if (!available) return;
    if (audio.paused) await tryPlay();
    else audio.pause();
  });

  return {
    /** Attempt autoplay. Safe to call before any user gesture. */
    attemptAutoplay: tryPlay,
    /** Start on the visitor's first gesture, if autoplay was blocked. */
    armFirstGesture() {
      const start = () => {
        if (!started && available && audio.paused) tryPlay();
      };
      window.addEventListener("pointerdown", start, { once: true, passive: true });
      window.addEventListener("keydown", start, { once: true });
    },
    get isAvailable() {
      return available;
    },
  };
}
