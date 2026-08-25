/**
 * OnboardingStore — persisted onboarding completion state (additive, v0.9).
 *
 * Stores a single versioned boolean flag under one namespaced localStorage key.
 * No secrets, no PII, no document content — only `autosd:onboardingComplete`.
 * All storage access is guarded (SSR/node/privacy mode/quota) and never throws.
 */

export const ONBOARDING_STORAGE_KEY = "autosd:onboardingComplete";

export type OnboardingState = {
  /** Schema version for forward-compatible migrations. */
  version: 1;
  /** Whether the product entry experience has been completed or skipped. */
  complete: boolean;
};

const DEFAULT_STATE: OnboardingState = { version: 1, complete: false };

function storageAvailable(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

/** Safe read: corrupt JSON, schema drift, or unavailable storage all fall back to defaults. */
function readState(): OnboardingState {
  if (!storageAvailable()) return DEFAULT_STATE;
  try {
    const raw = localStorage.getItem(ONBOARDING_STORAGE_KEY);
    if (raw === null || raw === "") return DEFAULT_STATE;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_STATE;
    const record = parsed as Record<string, unknown>;
    if (typeof record.complete !== "boolean") return DEFAULT_STATE;
    return { version: 1, complete: record.complete };
  } catch {
    // Corrupt payload or blocked storage — treat as never onboarded.
    return DEFAULT_STATE;
  }
}

/** True when the user has completed (or skipped) onboarding in a previous session. */
export function getOnboardingComplete(): boolean {
  return readState().complete;
}

/** Persist completion state. Fails soft when storage is unavailable (private mode, quota). */
export function setOnboardingComplete(complete: boolean): void {
  if (!storageAvailable()) return;
  try {
    const state: OnboardingState = { version: 1, complete };
    localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage write blocked — onboarding simply reappears next session.
  }
}

/** Remove the persisted flag (used by tests / "show onboarding again" flows). */
export function clearOnboardingComplete(): void {
  if (!storageAvailable()) return;
  try {
    localStorage.removeItem(ONBOARDING_STORAGE_KEY);
  } catch {
    // Storage removal blocked — nothing to recover.
  }
}
