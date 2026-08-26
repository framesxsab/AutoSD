# Hardware Integration Report — Evidence Template

Use this template for the **first real hardware integration report**. Do not claim validation without filling every required field. Copy this file, fill it, and submit as a PR or issue attachment. See `docs/HARDWARE_INTEGRATION.md` for the boundary tiers.

> **Validation level for this report:** `HARDWARE-CONNECTED` (device was connected, behavior observed) or `HARDWARE-VALIDATED` (documented reproducible session). Never `SOFTWARE-VALIDATED` for hardware, never `USER-VALIDATED` without participant methodology.

## Device

- Model / vendor:
- Firmware version (if known):
- Photos (optional, no personal data):

## Browser / Runtime

- OS / version:
- Browser + version (for WebHID) or Node version (for node-hid):
- AutoSD commit (`git rev-parse HEAD`):

## Transport

- [ ] WebHID (`navigator.hid`)
- [ ] node-hid
- node-hid version (if applicable):

## Permissions

- Permission prompt shown? (y/n, text):
- User gesture required? (click / permission API):
- Permission granted? (y/n):

## Discovery result

- `navigator.hid.getDevices()` or `HID.devices()` output (vendorId/productId, sanitized):
- Filters used in `requestDevice({filters: [...]})`:

## Capability result

- Reported `dotCount` / `refreshRateHz` (from device or `HIDDevice` static 40/60):
- Capabilities probed vs assumed:

## Connection result

- `connect()` outcome (success / error + message):
- Time to connect (ms, observed):

## Write / Render result

- Pattern sent (first 8 bytes, e.g., `[7,0,3,...]`):
- `write()` / `render()` outcome:
- Physical pins moved? (y/n/partial, describe):

## Read / Status

- `read()` returned bytes? (y/n, length):
- Input reports (`input` event) observed? (y/n, sample if safe):

## Disconnect

- `disconnect()` outcome:
- `disconnected` event received? (y/n):

## Reconnect / Hot-swap

- Reconnect after disconnect: success / fail:
- `DeviceManager.hotSwap()` result (if tested):

## Fallback behavior

- With device unplugged: `connect()` still resolves? `read()` returns `null`?
- Tests `npm test` still pass without hardware? (y/n):

## Reproduction steps

- Exact commands (e.g., `npm run dev`, `await navigator.hid.requestDevice({filters:[{vendorId:0x1234}]})`):
- Pattern/render snippet (first 40 bytes, no secrets):
- Console transcript (sanitized, no absolute paths):

## Failure details (if any)

- First failure step (from 14-step procedure):
- Error message / code:
- Minimal repro to trigger the same failure:

## Timestamps

- Start / end (ISO, no personal data):
- Duration (ms):

## Evidence / Log references

- `evaluation-output/evaluation.json` (if run):
- Sanitized logs (no absolute paths, no secrets):
- Screenshot/video references (optional):

## Validation level claimed

- [ ] `SOFTWARE-SCAFFOLDED` — code ships, fallback tested only
- [ ] `HARDWARE-CONNECTED` — connected and observed, not yet reproducible
- [ ] `HARDWARE-VALIDATED` — documented reproducible session (requires this filled template)
- [ ] `USER-VALIDATED` — **not applicable** to hardware-only report

Do not promote a capability-matrix row without this evidence. Maintainers will triage and update `docs/CAPABILITY_MATRIX.md` only after review.
