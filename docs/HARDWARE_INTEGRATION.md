# Hardware Integration Guide

> **Boundary warning:** No hardware has been validated. `MockDevice` and `VirtualDevice` are test doubles; they prove the software contract, never the physical device. Passing `npm test` or `npm run evaluate` **does not** imply any hardware works. See [CAPABILITY_MATRIX.md](CAPABILITY_MATRIX.md) row 4 and the tiers below — `HARDWARE-DEPENDENT` stays that way until a documented session moves it.

How to connect a real tactile display to AutoSD **without modifying core architecture**. Everything here rides the stable `Device` contract, which has been additive-only since v0.1.

## The exact boundary

Hardware work touches five layers. You own the first; the rest are read-only for you:

```
your hardware implementation
        │  implements
        ▼
Device contract (src/core/Device.ts)          ← interface only; additive-only rule applies
        │  registered into / swapped within
        ▼
DeviceManager (src/core/DeviceManager.ts)     ← register · setActive/trySetActive · hotSwap · broadcast
        │  holds
        ▼
Registry<Device> + DIContainer                ← id-keyed entries, swap events, factory re-resolution
        │  observed by
        ▼
diagnostics (src/app/diagnostics.ts)          ← active device id/kind/name/status, hidAvailable flag
        │  surfaced by
        ▼
UI (#/devices view, DiagnosticsPanel)         ← selection, render controls, issue-safe report
```

You never edit layers 2–5. If something there blocks you, file an RFC instead.

### Status tiers (what is real today)

| Tier                    | Meaning                                                                                      | Items                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SUPPORTED NOW**       | Shipped, software-verified behavior you can rely on in tests and demos                       | `Device` contract; `MockDevice`; `VirtualDevice` (framebuffer round-trips render→read); `DeviceManager` register/setActive/hot-swap/broadcast with per-device error isolation; registry/DI events; diagnostics `hidAvailable` + active-device reporting; graceful fallback when WebHID/node-hid are absent (`connect()` resolves, `read()` returns null) |
| **SOFTWARE-SCAFFOLDED** | Code exists and is contract-tested in fallback mode, but has never touched a physical device | `HIDDevice` adapter itself: dynamic-import probing of `navigator.hid` / `node-hid`, write/read delegation when a handle exists, `render()` = `write()` + `display` event. Static capabilities (`dotCount: 40`, `refreshRateHz: 60`) are constructor constants, not probed from hardware                                                                  |
| **HARDWARE-DEPENDENT**  | Outcome depends entirely on a physical device nobody has connected                           | Real cell movement from `render(pattern)`; vendor HID report formats; permission/enumeration flows per OS/browser; refresh timing; input reports arriving as `input` events                                                                                                                                                                              |
| **NOT VERIFIED**        | No evidence exists at all; do not assume it works                                            | Any specific display model working end-to-end; readable output on hardware (the mapping itself is unvalidated — see below); per-device capability profiles; input-event consumption beyond plumbing                                                                                                                                                      |

Per-implementation nuance you must know before writing tests: **`VirtualDevice.render()` updates its framebuffer, so render→read round-trips. `MockDevice.read()` reflects only `write()`**, so post-render read-back returns `null` on Mock. Both behaviors are intentional and tested (`tests/devices/devices.test.ts`); your adapter should state which semantic it provides.

## The contract you implement

`src/core/Device.ts` — the entire surface:

```ts
export interface Device {
  readonly info: DeviceInfo;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  write(data: Uint8Array): Promise<void>;
  read(): Promise<Uint8Array | null>;
  render(pattern: Uint8Array): Promise<void>;
  on<K extends keyof DeviceEventMap>(event: K, listener: DeviceListener<K>): () => void;
  off<K extends keyof DeviceEventMap>(event: K, listener: DeviceListener<K>): void;
}
```

`DeviceInfo` carries `id`, `kind`, `name`, `status`, and `capabilities` (`hasHaptics`, `hasDisplay`, `hasInput`, optional `dotCount`, optional `refreshRateHz`). `kind` is `"mock" | "virtual" | "hid"` today — if your device needs a new kind string, that is an additive contract change and needs an RFC issue first.

Events you may emit (all defined in `DeviceEventMap`): `connected`, `disconnected`, `error`, `input`, `display`.

Reference implementations to copy from:

| File                           | Purpose                                                       |
| ------------------------------ | ------------------------------------------------------------- |
| `src/devices/VirtualDevice.ts` | Framebuffer simulator; shows render/read/event conventions    |
| `src/devices/HIDDevice.ts`     | WebHID/node-hid dynamic-import pattern with graceful fallback |
| `src/devices/MockDevice.ts`    | Minimal deterministic fixture                                 |

## Rules that keep you out of core

1. **Never edit files under `src/core/` to make your device work.** If something there blocks you, that's an RFC issue, not a patch.
2. **Additive-only.** Don't remove or rename anything on `Device`, `DeviceInfo`, or event payload shapes.
3. **Degrade gracefully.** Follow the `HIDDevice` precedent: when your transport is missing (browser without WebHID, Node without your driver), `connect()` still resolves, `read()` returns `null`, nothing throws. CI has no hardware and must stay green.
4. **No new runtime dependencies in the core.** Load transports via dynamic import (see `resolveHID()` in `HIDDevice.ts`) or ship your device as a separate package that depends on AutoSD types.

## Three integration paths

### Path A — In-repo device class (recommended first step)

Create `src/devices/YourDisplay.ts` implementing `Device`. Register it with `DeviceManager` at bootstrap or from your own embedding code:

```ts
import { DeviceManager } from "./core/DeviceManager.js";
import { YourDisplay } from "./devices/YourDisplay.js";

const dm = new DeviceManager();
dm.register(new YourDisplay()); // becomes active automatically
const dev = dm.getActive()!;

await dev.connect();
await dev.render(pattern); // Uint8Array, length = capabilities.dotCount
const fb = await dev.read(); // framebuffer snapshot or null
dev.on("display", ({ rendered }) => {
  /* … */
});
```

`DeviceManager.register` adds it to the registry and emits `deviceAdded`; `setActive`/`trySetActive` switch targets; `hotSwap(id, next)` replaces the implementation live while preserving the id; `broadcast(pattern)` renders to every registered device with per-device error isolation.

### Path B — Hot-swap an existing slot

If your build already registers `virtual-1` / `hid-1`, replace the implementation at runtime without touching registration sites:

```ts
dm.hotSwap("hid-1", new YourDisplay("hid-1", "My Display"));
```

Listeners survive the swap through the registry's swapped-event flow.

### Path C — External package / plugin-style extension

For work you don't want in-tree: publish a package exporting your `Device` implementation; consumers call `deviceManager.register(yourDevice)`. Note honestly what plugins can and cannot do today: the `Plugin` contract (`src/plugins/types.ts`) exposes workflow registration only — **plugins cannot currently register devices**. External devices integrate through `DeviceManager` directly (Path A/B API). Extending `PluginContext.api` with device registration would be an additive RFC — a good candidate issue if you need it.

## Transport notes

**WebHID (browser):** available in Chromium browsers; user must grant device access via `navigator.hid.requestDevice()`. `HIDDevice.resolveHID()` shows the probe pattern: check `navigator.hid` first, fall back silently.

**node-hid (Node):** optional peer dependency. AutoSD never installs it implicitly; load with dynamic import and treat absence as fallback mode. Native builds are the user's responsibility — document yours.

**Report format reality-check:** most braille displays are HID _vendor devices_ with proprietary protocols on top of raw HID reports. Expect the transport layer to succeed and the _protocol_ layer to be where integration work lives. That finding is exactly what the project lacks — record it.

## What patterns mean

`render(pattern)` receives one byte per cell; values land in the six-dot range (0–63) because `textToDots` maps `charCode % 64`. **This mapping is not standard braille** — it is a deterministic pipeline fixture (matrix row 20, USER-VALIDATION-PENDING). When integrating hardware, log what your device does with these values rather than assuming readable output.

## First-contact procedure (14 steps)

Full procedure lives in `docs/HARDWARE_FIRST_CONTACT.md` — 14 steps from browser/runtime choice through classification and failure reporting. Use it before writing adapter code so problems are isolated to layers. Expected observations are documented there without claiming they have happened.

## Testing your device without hardware present

- Contract-test against `VirtualDevice` semantics: render updates framebuffer; read returns copy; events fire in order; operations before `connect()` throw (Virtual) or degrade (HID-style).
- Your fallback path must pass on machines with zero hardware — mirror `tests/devices/devices.test.ts`.
- Never fake hardware results in tests. Mocks simulate the _contract_, not the _hardware_.

## Integration report template

Post as an issue titled `hardware-integration: <device model>`:

```markdown
Device: <model, vendor>
Transport: WebHID | node-hid <version>
OS / browser:
AutoSD commit:

Enumeration: found / not found (vendorId=…, productId=…)
Open: success / error <message>
Write: bytes=<…> result=<moved / nothing / garbage / partial>
Read/input: <what happened>
Fallback path intact (CI-safe): yes/no

First failure point: enumeration | open | protocol | timing
Minimal repro: <steps or snippet>
Suspected cause: <your hypothesis>

Willing to iterate on an adapter: yes/no
```

Reports move capability matrix row 4 per its evidence rules — including negative results.
