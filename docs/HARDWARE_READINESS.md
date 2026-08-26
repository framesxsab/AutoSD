# Hardware Path Readiness

What is ready for `navigator.hid.requestDevice()` → hardware, and what remains, without pretending a device exists. Inspected from `src/devices/HIDDevice.ts` and `src/core/DeviceManager.ts`.

## Path: permission → discovery → connect → write/render → read/status → disconnect → reconnect/hot-swap → fallback

| Step                         | Implemented                                                                                                              | Still needed for real device                                                                                                                     | Honest limitation                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `requestDevice()` permission | Not in repo — browser API, requires user gesture                                                                         | Contributor must call `navigator.hid.requestDevice({filters:[{vendorId}]})` in a click handler; AutoSD does not wrap this yet                    | AutoSD never prompts; integration report must document the gesture used               |
| Device discovery             | `HIDDevice.resolveHID()` probes `navigator.hid` and `node-hid` (dynamic import), graceful `null` fallback                | Vendor/productId filters and report descriptor parsing are device-specific — not in repo                                                         | `HIDDevice` static `dotCount:40` is assumed, not probed                               |
| `connect()`                  | Resolves even when handle is `null`; emits `connected`                                                                   | Real handle assignment (`hidHandle = await device.open()`) is TODO per device; error handling for `SecurityError`/`NotFoundError` is caller-side | Tests prove fallback only; no hardware connect has been exercised                     |
| `write/render`               | `write()` delegates to `hidHandle.write(data)` if present, else no-op; `render()` = `write()` + `display` event          | HID report ID and byte packing are vendor-specific — report template captures what was sent vs what moved                                        | Byte 0–63 range is software convention (`charCode %64`), not a hardware guarantee     |
| `read/status`                | `read()` delegates to `hidHandle.read()` if present, else `null`                                                         | Input report parsing (key presses, cell status) is unimplemented beyond `input` event plumbing                                                   | No device has been observed to emit `input`                                           |
| `disconnect`                 | Clears handle, status `disconnected`, emits `disconnected`                                                               | Physical unplug vs `disconnect()` both lead to `disconnected` event, but unplug detection is browser-dependent                                   | Not tested on hardware                                                                |
| `reconnect/hot-swap`         | `DeviceManager.hotSwap(id, next)` preserves listeners via `Registry` swap events; `trySetActive` guards unknown ids      | Hot-swap with a real handle must be tested — report template includes this check                                                                 | No hardware hot-swap has been attempted                                               |
| Fallback                     | `connect()` succeeds, `read()` returns `null`, `write()` no-op — `npm test` and `npm run evaluate` pass without hardware | None — fallback is the guarantee that software validation stays independent                                                                      | This is the boundary that makes `SOFTWARE-VALIDATED` never imply `HARDWARE-VALIDATED` |

## What an integrator does without changing core architecture

1. Implement `Device` (see `HARDWARE_INTEGRATION.md` exact boundary) — no edits to `src/core/`.
2. Register via `DeviceManager.register()` or `hotSwap()` — `DeviceManager` already supports multiple devices, `broadcast()` isolates per-device errors.
3. Document the vendor report format in the integration report — do not hard-code it into `HIDDevice` until a second device proves the abstraction.

## Browser / device limitations (honest)

- WebHID is Chromium-only (Chrome, Edge, Opera) and requires HTTPS (or `localhost`) plus a user gesture. Firefox/Safari do not support WebHID.
- `node-hid` is an optional peer, not installed by default; native build may require `node-gyp` and OS drivers.
- No standard braille HID report exists — each display uses a vendor report; AutoSD currently sends raw `Uint8Array` without report ID prefixing.
- Input reports (keys, routing keys) are defined per device; AutoSD exposes `input` events but no integrator has wired them end-to-end.
