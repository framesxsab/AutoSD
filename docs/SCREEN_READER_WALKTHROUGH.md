# Screen-Reader & Tactile Display Walkthrough Script (M6)

> **Purpose:** Manual verification script for assistive-technology testers using **NVDA** (Windows + Chrome/Firefox), **JAWS** (Windows + Chrome/Edge), or **VoiceOver** (macOS + Safari/Chrome), optionally paired with a refreshable braille display.
>
> **Status:** Script ready for external AT evaluation. Completing this walkthrough and recording findings is required before moving the screen-reader row in `docs/CAPABILITY_MATRIX.md` beyond `SOFTWARE-VALIDATED`.

---

## 1. Environment Setup

1. Build and serve the production bundle locally:
   ```bash
   npm run build
   npm run preview
   ```
2. Open the preview URL (default `http://localhost:4173`) in your target browser with your screen reader active.
3. Optional: connect a refreshable braille display (20, 40, or 80 cells) or use the built-in **VirtualDevice** simulator in `#/devices`.

---

## 2. Landmark, Skip-Link & Route Focus Audit

| Step | Action                                                                                                                                  | Expected AT Announcement / Behavior                                                                                         | Pass / Notes |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 2.1  | Press `Tab` once from the address bar                                                                                                   | Focus lands on the **Skip to main content** link; activating it moves focus into `<main>`.                                  | [ ]          |
| 2.2  | Open your screen reader's Landmarks list (`NVDA+F7` / `VO+U`)                                                                           | Landmarks include `navigation` (`Primary navigation`), `main`, and polite status live region.                               | [ ]          |
| 2.3  | Navigate to each route (`Home`, `Reader`, `Workspace`, `Devices`, `Research`, `Sessions`, `Settings`, `Help`, `Demo`) via keyboard only | Focus moves automatically to the view's primary heading (`h1`/`h2`); no focus traps; heading outline has no skipped levels. | [ ]          |

---

## 3. Workspace → Research → Reader Grounded Citation Flow

1. Navigate to **`#/workspace`**:
   - Activate **Load sample corpus**. Confirm polite live-region announcement of ingested documents.
   - Add a custom document via **Document title** and **Document content** fields; verify form labels are announced clearly.
2. Navigate to **`#/research`**:
   - Enter a query (e.g., `How do refreshable braille displays work?`) and submit.
   - Verify the answer, confidence badge (`role="status"`), and citation list are reachable in logical reading order.
   - Activate **Open chunk in Reader** on the top citation.
3. Verify automatic transition to **`#/reader`**:
   - Focus lands on the Reader heading; the cited page is highlighted and marked `aria-current="page"`.
   - Use **Previous citation** / **Next citation** buttons and verify polite live-region announcements.

---

## 4. Tactile Braille Output, Cell Pagination & Settings

1. Navigate to **`#/settings`**:
   - Set **Tactile encoding** to **UEB Grade 1 Braille** (and later test **UEB Grade 2 (Contracted)**).
   - Set **Display width** to match your display (`20`, `40`, or `80` cells).
   - Toggle **Cell-aware pagination** on, then reload the page and confirm preferences persist.
2. Navigate to **`#/devices`**:
   - Register or select an active device (VirtualDevice or WebHID device via **Connect HID display**).
   - Send a test pattern and verify the status region updates without stealing focus.
3. Return to **`#/reader`**:
   - Verify the **Cell-aware pagination** button reflects `aria-pressed="true"`.
   - Activate **Send page to tactile device**.
   - Confirm the tactile output region (`role="status"`) displays the active device, cell width, line index (`line 1 of N`), and grade (`UEB Grade 1 Braille` or `UEB Grade 2 Braille`).
   - Step lines with **Previous braille line** / **Next braille line** buttons or `ArrowUp`/`ArrowDown` when focus is on the tactile strip.
   - If using a physical or simulated HID display, test:
     - **Pan right** across the last line of Page 1 → advances to Page 2 line 1.
     - **Pan left** from Page 2 line 1 → returns to Page 1's last line.
     - **Cursor routing key** → announces `Cell N: "<char>" in "<word>"`.
     - **Select key** → announces the active line's plain text.

---

## 5. Recording Findings

Log session metadata (OS, browser, screen reader + version, braille display model + cell width, pass/fail per step, and any verbosity, focus, or braille translation issues) in an issue or PR referencing `docs/CAPABILITY_MATRIX.md`.
