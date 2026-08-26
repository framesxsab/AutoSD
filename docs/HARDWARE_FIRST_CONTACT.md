# Hardware First-Contact Procedure — 14 Steps

Follow this exactly when you have physical hardware. Do not edit `src/core/`; do not claim validation without completing the report template (`docs/reports/hardware-integration.md`). Each step has an expected observation — none have been observed yet on real hardware.

1. **Browser / runtime:** Use Chromium ≥120 (Chrome, Edge) for WebHID, or Node 20+ with `node-hid` installed. Firefox/Safari do not support WebHID. Record OS + browser/Node version.
2. **Permissions required:** WebHID requires a user gesture (click) and HTTPS (or `localhost`). Node requires OS HID permission (udev rules on Linux, driver on Windows). Record the prompt text.
3. **Start the application:** `npm run dev` → `http://localhost:5173` → `#/devices` shows `VirtualDevice` active and `HIDDevice` fallback row. `navigator.hid` should be defined in console.
4. **Discover a device:** In browser console, `await navigator.hid.requestDevice({filters:[]})` (or vendorId filter), or in Node `require('node-hid').devices()`. Record vendorId/productId (safe identifiers only).
5. **Inspect capabilities:** Check `device.info.capabilities` in console (`dotCount`, `refreshRateHz`). Current `HIDDevice` reports static 40/60 — note if your device differs.
6. **Connect:** `await device.connect()` — expected: status `connected`, `connected` event fires. If permission denied, record `SecurityError`.
7. **Minimal write/render:** `await device.render(new Uint8Array(40).fill(63))` (all dots on) — expected: `display` event with `rendered:true`. Record bytes sent.
8. **Observe / read status:** Look at physical pins; `await device.read()` where supported should return bytes or `null` (HID fallback). Record `moved / nothing / partial`.
9. **Disconnect:** `await device.disconnect()` — expected status `disconnected`, event fires.
10. **Reconnect:** `await device.connect()` again — expected second `connected` event, no leaked handles.
11. **Hot-swap:** `deviceManager.hotSwap("hid-1", new YourDevice("hid-1"))` — expected listeners survive, `activeChanged` fires.
12. **Logs to collect:** `evaluation-output/evaluation.json` if you ran `npm run evaluate`, browser console logs, `navigator.hid.getDevices()` output, sanitized `device.info`.
13. **Classify evidence:** `SOFTWARE-SCAFFOLDED` (fallback only) → `HARDWARE-CONNECTED` (connected + observed) → `HARDWARE-VALIDATED` (reproducible, full template) — never `USER-VALIDATED` for hardware alone.
14. **Report failure:** File an issue with the report template, include first failure point (`enumeration|open|write|read|disconnect|reconnect|hot-swap`), minimal repro, and whether fallback still passes `npm test` without hardware.

Expected observations without claiming they happened: steps 4–11 have never succeeded on real hardware in this repository; the template is ready for the first honest report, including negative results.
