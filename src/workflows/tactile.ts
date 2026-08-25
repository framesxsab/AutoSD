/**
 * Tactile workflow — maps text to dot patterns for haptic devices.
 * Keeps Mock/Virtual/HID compatibility via Device contract.
 */
import type { Device } from "../core/Device.js";

export function textToDots(text: string, dotCount = 40): Uint8Array {
  const pattern = new Uint8Array(dotCount);
  for (let i = 0; i < Math.min(text.length, dotCount); i++) {
    pattern[i] = text.charCodeAt(i) % 64; // 6-dot braille cell range
  }
  return pattern;
}

export class TactileWorkflow {
  async renderText(device: Device, text: string): Promise<void> {
    const pattern = textToDots(text, device.info.capabilities.dotCount ?? 40);
    await device.render(pattern);
  }

  async renderPages(device: Device, pages: string[]): Promise<void> {
    for (const page of pages) {
      await this.renderText(device, page);
    }
  }
}
