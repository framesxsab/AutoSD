/**
 * Onboarding — product entry experience (additive, v0.9).
 *
 * Landing view + guided steps explaining what AutoSD is, the software-vs-hardware
 * distinction, privacy guarantees, and keyboard-first operation. Skippable at any
 * point; completion is persisted by the caller via OnboardingStore.
 *
 * WCAG 2.2 AA contract:
 * - role="dialog" + aria-modal, background made inert while open
 * - Focus is trapped; Escape skips; Arrow keys move between steps; Tab cycles controls
 * - Step changes and skip/complete are announced via createLiveRegion (polite status)
 * - All content is set with textContent — no innerHTML, no unsanitized markup
 * - Motion respects prefersReducedMotion() (JS) and CSS media query (styles in index.html)
 */

import { createLiveRegion, prefersReducedMotion } from "../accessibility/a11y.js";

export type OnboardingFinishReason = "complete" | "skip";

export type OnboardingOptions = {
  /** Called once when the user starts the workspace or skips onboarding. */
  onFinish?: (reason: OnboardingFinishReason) => void;
  /** Element to restore focus to on close (defaults to the element focused before open). */
  returnFocusTo?: HTMLElement | null;
};

type OnboardingStep = {
  title: string;
  paragraphs: string[];
};

const STEPS: OnboardingStep[] = [
  {
    title: "What AutoSD does",
    paragraphs: [
      "Ask questions over your document corpus and get answers with grounded citations and a confidence score.",
      "Read long-form documents page by page with screen-reader-friendly labels, and browse the plugin marketplace to extend the platform.",
    ],
  },
  {
    title: "Software today, hardware anytime",
    paragraphs: [
      "Everything works without special hardware: retrieval, reading, sessions, and exports run entirely in software with built-in simulated devices.",
      "Optional: connect a refreshable tactile display over HID and the same workflows render as dot patterns. Devices hot-swap without restarting.",
    ],
  },
  {
    title: "Privacy you can verify",
    paragraphs: [
      "Your corpus stays on your machine. AutoSD needs no account and sends no telemetry.",
      "The only thing ever stored is one preference flag recording that you finished this introduction — never documents, queries, or credentials.",
    ],
  },
  {
    title: "Keyboard-first by design",
    paragraphs: [
      "Tab and Shift+Tab cycle the controls, Left and Right arrows move between steps, Enter activates the highlighted button, and Escape skips this introduction.",
      "Every step change is announced politely to screen readers, focus is always visible, and animations are disabled when your system requests reduced motion.",
    ],
  },
];

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function setInert(el: HTMLElement, value: boolean): void {
  const candidate = el as HTMLElement & { inert?: boolean };
  if ("inert" in candidate) candidate.inert = value;
  if (value) {
    el.setAttribute("aria-hidden", "true");
  } else {
    el.removeAttribute("aria-hidden");
  }
}

export class Onboarding {
  private container: HTMLElement;
  private dialog: HTMLElement;
  private stepIndex = -1; // -1 = landing view
  private isOpen = false;
  private lastFocused: HTMLElement | null = null;

  private readonly keydownHandler = (event: KeyboardEvent): void => {
    this.handleKeydown(event);
  };

  constructor(private opts: OnboardingOptions = {}) {
    this.container = document.createElement("div");
    this.container.className = "onboarding";

    this.dialog = document.createElement("section");
    this.dialog.className = "onboarding__panel";
    this.dialog.setAttribute("role", "dialog");
    this.dialog.setAttribute("aria-modal", "true");
    this.dialog.setAttribute("aria-label", "Introducing AutoSD");

    this.container.appendChild(this.dialog);
    this.container.addEventListener("keydown", this.keydownHandler);
  }

  mount(parent: HTMLElement): void {
    parent.appendChild(this.container);
    this.open();
  }

  getElement(): HTMLElement {
    return this.container;
  }

  unmount(): void {
    this.close("skip", false);
    this.container.removeEventListener("keydown", this.keydownHandler);
    this.container.remove();
  }

  private open(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    const active = document.activeElement;
    this.lastFocused = active instanceof HTMLElement ? active : null;
    this.hideBackground(true);
    this.renderLanding();
  }

  private close(reason: OnboardingFinishReason, restoreFocus = true): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.hideBackground(false);
    this.container.remove();
    if (!restoreFocus) return;
    const target = this.opts.returnFocusTo ?? this.lastFocused;
    target?.focus();
    this.opts.onFinish?.(reason);
  }

  /** Hide sibling app content from assistive tech and pointer/keyboard focus while open. */
  private hideBackground(hidden: boolean): void {
    const parent = this.container.parentElement;
    if (!parent) return;
    for (const child of Array.from(parent.children)) {
      if (child === this.container) continue;
      if (child instanceof HTMLElement) setInert(child, hidden);
    }
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      this.finish("skip");
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      this.nextStep();
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      this.previousStep();
      return;
    }
    if (event.key === "Tab") {
      this.trapFocus(event);
    }
  }

  private trapFocus(event: KeyboardEvent): void {
    const focusables = Array.from(
      this.dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ).filter(el => !el.hasAttribute("disabled"));
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const current = document.activeElement;
    if (event.shiftKey && current === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && current === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private nextStep(): void {
    if (this.stepIndex >= STEPS.length - 1) return; // last step: use Start Workspace button
    this.stepIndex += 1;
    this.renderStep();
  }

  private previousStep(): void {
    if (this.stepIndex < 0) return; // landing: no previous
    this.stepIndex -= 1;
    if (this.stepIndex < 0) {
      this.renderLanding();
    } else {
      this.renderStep();
    }
  }

  finish(reason: OnboardingFinishReason): void {
    this.close(reason);
  }

  // ---------------------------------------------------------------- rendering

  private clearDialog(): void {
    this.dialog.innerHTML = "";
  }

  private buildHeader(): { heading: HTMLHeadingElement; skip: HTMLButtonElement } {
    const header = document.createElement("div");
    header.className = "onboarding__header";

    const brand = document.createElement("p");
    brand.className = "onboarding__eyebrow";
    brand.textContent = "AutoSD";
    header.appendChild(brand);

    const skip = document.createElement("button");
    skip.type = "button";
    skip.className = "onboarding__button onboarding__button--ghost";
    skip.textContent = "Skip onboarding";
    skip.addEventListener("click", () => this.finish("skip"));
    header.appendChild(skip);

    this.dialog.appendChild(header);
    const heading = document.createElement("h1");
    heading.id = "onboarding-heading";
    heading.tabIndex = -1;
    this.dialog.appendChild(heading);
    return { heading, skip };
  }

  private buildParagraphs(host: HTMLElement, texts: string[]): void {
    for (const text of texts) {
      const p = document.createElement("p");
      p.textContent = text;
      host.appendChild(p);
    }
  }

  private buildActions(buttons: HTMLButtonElement[]): void {
    const actions = document.createElement("div");
    actions.className = "onboarding__actions";
    actions.setAttribute("role", "group");
    actions.setAttribute("aria-label", "Onboarding actions");
    for (const btn of buttons) actions.appendChild(btn);
    this.dialog.appendChild(actions);
  }

  private createButton(
    text: string,
    variant: "primary" | "secondary",
    onClick: () => void,
  ): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `onboarding__button onboarding__button--${variant}`;
    btn.textContent = text;
    btn.addEventListener("click", onClick);
    return btn;
  }

  private announce(message: string): void {
    const spec = createLiveRegion(message);
    const live = document.createElement("div");
    live.setAttribute("role", spec.role);
    live.setAttribute("aria-live", spec.ariaLive);
    live.textContent = spec.message;
    live.className = "onboarding__sr-only";
    this.dialog.appendChild(live);
    setTimeout(() => live.remove(), 1000);
  }

  private renderLanding(): void {
    this.stepIndex = -1;
    this.clearDialog();
    const { heading } = this.buildHeader();

    heading.textContent = "Welcome to AutoSD";

    this.buildParagraphs(this.dialog, [
      "AutoSD is a plugin-first knowledge workspace. Search your documents with grounded citations, read long-form texts page by page, and extend everything with plugins — all through one device-agnostic core.",
      "Everything core runs entirely in software today: research, reading, sessions, and exports work out of the box with built-in simulated devices. No extra hardware required.",
      "Have tactile hardware? Connect a refreshable display over HID and the same workflows render as dot patterns — swap devices any time, no restart needed.",
      "Privacy first: your corpus stays on your machine. No account, no telemetry, and only a single preference flag is stored — never documents or credentials.",
      "Accessible by contract: WCAG 2.2 AA with full keyboard control, visible focus, screen-reader announcements, and reduced-motion support.",
    ]);

    const start = this.createButton("Start Workspace", "primary", () => this.finish("complete"));
    const tour = this.createButton("Take the tour", "secondary", () => {
      this.stepIndex = 0;
      this.renderStep();
    });
    this.buildActions([start, tour]);

    heading.focus({ preventScroll: prefersReducedMotion() });
    this.announce(
      "Welcome to AutoSD. Press Start Workspace, take the tour, or press Escape to skip.",
    );
  }

  private renderStep(): void {
    const step = STEPS[this.stepIndex];
    if (!step) {
      this.renderLanding();
      return;
    }
    this.clearDialog();
    const { heading } = this.buildHeader();

    heading.textContent = step.title;

    const progress = document.createElement("p");
    progress.className = "onboarding__progress";
    progress.setAttribute("role", "status");
    progress.textContent = `Step ${this.stepIndex + 1} of ${STEPS.length}`;
    this.dialog.appendChild(progress);

    this.buildParagraphs(this.dialog, step.paragraphs);

    const buttons: HTMLButtonElement[] = [];
    const back = this.createButton("Back", "secondary", () => this.previousStep());
    back.disabled = this.stepIndex === 0;
    buttons.push(back);

    if (this.stepIndex === STEPS.length - 1) {
      buttons.push(this.createButton("Start Workspace", "primary", () => this.finish("complete")));
    } else {
      buttons.push(this.createButton("Next", "primary", () => this.nextStep()));
    }
    this.buildActions(buttons);

    heading.focus({ preventScroll: prefersReducedMotion() });
    this.announce(`Step ${this.stepIndex + 1} of ${STEPS.length}: ${step.title}`);
  }
}
