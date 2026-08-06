/**
 * previewGate.ts — Temporary preview-access gate (AG, 2026-08-01).
 *
 * DELIBERATELY LIGHTWEIGHT AND TEMPORARY, per the spec's own scope
 * restraint: a shared client-side preview password in front of the
 * existing application, nothing more. No accounts, no hashing, no
 * backend, no token architecture — "the smallest coherent version that
 * works, looks intentional, and can later be replaced by real
 * authentication." Everything gate-related lives in THIS module plus the
 * static `.preview-gate` markup in index.html; app.ts is untouched (the
 * gate defers the application module's import until access is granted,
 * so the entire app — including its module-eval startup wiring — simply
 * does not exist on the page until then).
 *
 * REPLACEMENT SEAM: `isPreviewPasswordValid()` is the one place the
 * check happens, and `PREVIEW_ACCESS_KEY` the one persistence flag. A
 * future real login (app.docscrub.app) replaces this module and the
 * static markup; nothing else in the codebase knows the gate exists.
 *
 * Session behavior: sessionStorage only (per spec — survives refresh,
 * dies with the browser session; deliberately NOT localStorage). If
 * sessionStorage is unavailable (privacy modes), the gate still works
 * but access is simply re-asked per page load — degrading toward the
 * gate, never toward a broken app.
 */

const PREVIEW_PASSWORD = "Scrubadub";

export function isPreviewPasswordValid(password: string): boolean {
  // .trim() (2026-08-01, after a real "the password does not work!"
  // report): a shared preview password is usually PASTED from a note or
  // chat message, and those copies routinely pick up a trailing space or
  // newline. A real login must not trim; a preview courtesy gate should.
  // Still case-sensitive.
  return password.trim() === PREVIEW_PASSWORD;
}

const PREVIEW_ACCESS_KEY = "docscrub-preview-access";

function hasPreviewAccess(): boolean {
  try {
    return sessionStorage.getItem(PREVIEW_ACCESS_KEY) === "granted";
  } catch {
    return false;
  }
}

function grantPreviewAccess(): void {
  try {
    sessionStorage.setItem(PREVIEW_ACCESS_KEY, "granted");
  } catch {
    /* no memory across refreshes, but this page load proceeds */
  }
}

export function clearPreviewAccess(): void {
  try {
    sessionStorage.removeItem(PREVIEW_ACCESS_KEY);
  } catch {
    /* nothing to clear */
  }
}

/** Reveals the application: imports the application module — whose own
 *  module-eval startup (version label, header wiring, initial render)
 *  runs exactly as it always has, just later — and drops the gate only
 *  once the import SUCCEEDS.
 *
 *  The .catch matters (2026-08-01, from a real "the password does not
 *  work!" report): if the module graph fails to load (the classic cause:
 *  stale heuristically-cached modules mixed with fresh ones when the
 *  server isn't sending Cache-Control), the old code hid the gate first
 *  and then imported -- a correct password produced a silent blank page,
 *  indistinguishable from a broken password. Now the gate stays up and
 *  says what to do instead. */
/** One-shot auto-recovery marker (2026-08-02): a failed module-graph
 *  fetch is CACHED in the document's module map, so retrying the import
 *  on the same page fails instantly no matter what -- recovery requires
 *  a fresh page. The common transient cause here is a dev rebuild
 *  rewriting dist/ at the exact moment of the load; one automatic reload
 *  (access is already granted, so it goes straight back into the load)
 *  rides that out invisibly. A SECOND consecutive failure shows the
 *  message instead of looping. */
const LOAD_RETRY_KEY = "docscrub-preview-load-retried";

function startApplication(gate: HTMLElement | null): void {
  import("./app.js")
    .then(() => {
      try {
        sessionStorage.removeItem(LOAD_RETRY_KEY);
      } catch {
        /* marker is best-effort */
      }
      document.body.classList.remove("preview-locked");
      if (gate) gate.hidden = true;
    })
    .catch(() => {
      let alreadyRetried = true; // storage unavailable -> no reload loop risk, go straight to the message
      try {
        alreadyRetried = sessionStorage.getItem(LOAD_RETRY_KEY) === "yes";
        if (!alreadyRetried) sessionStorage.setItem(LOAD_RETRY_KEY, "yes");
      } catch {
        /* fall through to the message */
      }
      if (!alreadyRetried) {
        window.location.reload();
        return;
      }
      try {
        sessionStorage.removeItem(LOAD_RETRY_KEY);
      } catch {
        /* best-effort */
      }
      if (!gate) return;
      document.body.classList.add("preview-locked");
      gate.hidden = false;
      const errorLine = gate.querySelector<HTMLElement>(".preview-gate-error");
      if (errorLine) {
        errorLine.textContent = "Could not load the application. Hard-refresh this page (Cmd-Shift-R) and try again.";
        errorLine.hidden = false;
      }
    });
}

function showGate(gate: HTMLElement): void {
  document.body.classList.add("preview-locked");
  gate.hidden = false;

  const form = gate.querySelector<HTMLFormElement>(".preview-gate-form");
  const passwordInput = gate.querySelector<HTMLInputElement>(".preview-password");
  const errorLine = gate.querySelector<HTMLElement>(".preview-gate-error");
  const card = gate.querySelector<HTMLElement>(".preview-gate-card");
  if (!form || !passwordInput) {
    return;
  }

  // Autofocus on load; a <form> submit handler makes Enter-in-field and
  // the button one identical path.
  passwordInput.focus();
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = passwordInput.value;
    const valid = isPreviewPasswordValid(value);
    if (valid) {
      grantPreviewAccess();
      startApplication(gate);
      return;
    }
    // Invalid: concise inline error, brief shake, focus back for an
    // immediate retry -- never navigate away or clear the screen. (The
    // text is re-set each time: the load-failure path above may have
    // repurposed this line.)
    if (errorLine) {
      errorLine.textContent = "Incorrect preview password.";
      errorLine.hidden = false;
    }
    passwordInput.classList.add("preview-password-invalid");
    if (card) {
      card.classList.remove("preview-gate-shake");
      // Force a reflow so re-adding the class restarts the animation on
      // consecutive failures.
      void card.offsetWidth;
      card.classList.add("preview-gate-shake");
    }
    passwordInput.select();
    passwordInput.focus();
  });
  passwordInput.addEventListener("input", () => {
    passwordInput.classList.remove("preview-password-invalid");
    if (errorLine) errorLine.hidden = true;
  });
}

// --- Boot ---------------------------------------------------------------
// Guarded like every static-markup consumer in this codebase: if the DOM
// (or the gate markup) is missing, fail OPEN into the application rather
// than bricking it -- the gate is a preview courtesy, not a security
// boundary.
if (typeof document !== "undefined" && typeof document.querySelector === "function") {
  // BFCACHE GUARD (2026-08-02): a page restored from the back/forward
  // cache resumes from a snapshot without re-running this module -- one
  // credible source of the observed "gate visible but submit handler
  // absent" state (Enter then fell through to a native submit until the
  // markup-level onsubmit stop). A restored gate page reloads itself
  // once, cheaply, into a known-good state.
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("pageshow", (event: PageTransitionEvent) => {
      if (event.persisted) {
        window.location.reload();
      }
    });
  }
  const gate = document.querySelector<HTMLElement>(".preview-gate");

  // "Exit Preview" -- unobtrusive, in the settings menu's static markup.
  // Wired here (not in app.ts) so every scrap of gate logic stays in this
  // one module.
  const exitItem = document.querySelector<HTMLElement>(".app-settings-exit-preview");
  if (exitItem) {
    exitItem.addEventListener("click", () => {
      clearPreviewAccess();
      window.location.reload();
    });
  }

  if (!gate || hasPreviewAccess()) {
    startApplication(gate);
  } else {
    showGate(gate);
  }
}
