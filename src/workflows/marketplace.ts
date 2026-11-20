/**
 * Marketplace workflow — plugin discovery, install metadata, and built-in
 * runtime Plugin implementations registered with PluginHost.
 */
import type { Plugin, PluginContext } from "../plugins/types.js";
import { ReaderWorkflow } from "./reader.js";
import { brailleToText, textToBraille } from "./tactile.js";

export type MarketplacePlugin = {
  id: string;
  name: string;
  version: string;
  description: string;
  downloads: number;
};

export const DEFAULT_ENABLED_PLUGINS: readonly string[] = ["autosd-reader"];

const CATALOG: MarketplacePlugin[] = [
  {
    id: "autosd-reader",
    name: "Reader Plugin",
    version: "0.3.0",
    description: "Reader + tactile workflow",
    downloads: 1200,
  },
  {
    id: "autosd-tts",
    name: "TTS Plugin",
    version: "0.2.0",
    description: "Text-to-speech",
    downloads: 800,
  },
  {
    id: "autosd-braille",
    name: "Braille Plugin",
    version: "0.1.5",
    description: "Braille display mapping",
    downloads: 450,
  },
];

/**
 * Create real Plugin instances corresponding to the built-in marketplace catalog.
 * Each plugin registers a callable workflow on PluginHost during activate() and
 * unregisters it cleanly during deactivate().
 */
export function createCatalogPlugins(): Plugin[] {
  const reader = new ReaderWorkflow();

  let readerCtx: PluginContext | null = null;
  let ttsCtx: PluginContext | null = null;
  let brailleCtx: PluginContext | null = null;

  return [
    {
      id: "autosd-reader",
      version: "0.3.0",
      description: "Reader + tactile workflow",
      activate(ctx) {
        readerCtx = ctx;
        ctx.api.registerWorkflow("autosd-reader:paginate", payload => {
          const input = payload as {
            id?: string;
            title?: string;
            content?: string;
            charsPerPage?: number;
          };
          return reader.paginate(
            {
              id: input?.id ?? "plugin-doc",
              title: input?.title ?? "Document",
              content: typeof input?.content === "string" ? input.content : "",
            },
            { charsPerPage: input?.charsPerPage ?? 1000, wordBoundary: true },
          );
        });
      },
      deactivate() {
        readerCtx?.api.unregisterWorkflow("autosd-reader:paginate");
        readerCtx = null;
      },
    },
    {
      id: "autosd-tts",
      version: "0.2.0",
      description: "Text-to-speech",
      activate(ctx) {
        ttsCtx = ctx;
        ctx.api.registerWorkflow("autosd-tts:prepare", payload => {
          const text = typeof payload === "string" ? payload : String(payload ?? "");
          const segments = text
            .split(/(?<=[.!?])\s+|\n+/)
            .map(s => s.trim())
            .filter(Boolean);
          const wordCount = segments.join(" ").split(/\s+/).filter(Boolean).length;
          return { segments, estimatedSeconds: Math.ceil(wordCount / 2.5) };
        });
      },
      deactivate() {
        ttsCtx?.api.unregisterWorkflow("autosd-tts:prepare");
        ttsCtx = null;
      },
    },
    {
      id: "autosd-braille",
      version: "0.1.5",
      description: "Braille display mapping",
      activate(ctx) {
        brailleCtx = ctx;
        ctx.api.registerWorkflow("autosd-braille:encode", payload => {
          const input =
            typeof payload === "string"
              ? { text: payload, cellCount: 40, grade: 1 as const }
              : (payload as { text?: string; cellCount?: number; grade?: 1 | 2 });
          return textToBraille(
            typeof input?.text === "string" ? input.text : "",
            input?.cellCount ?? 40,
            { grade: input?.grade === 2 ? 2 : 1 },
          );
        });
        ctx.api.registerWorkflow("autosd-braille:decode", payload => {
          if (
            typeof payload === "string" ||
            payload instanceof Uint8Array ||
            Array.isArray(payload)
          ) {
            return brailleToText(payload);
          }
          const input = payload as {
            cells?: Uint8Array | readonly number[];
            unicode?: string;
            grade?: 1 | 2;
          };
          const opts = { grade: input?.grade === 2 ? (2 as const) : (1 as const) };
          if (input?.cells) return brailleToText(input.cells, opts);
          return brailleToText(typeof input?.unicode === "string" ? input.unicode : "", opts);
        });
      },
      deactivate() {
        brailleCtx?.api.unregisterWorkflow("autosd-braille:encode");
        brailleCtx?.api.unregisterWorkflow("autosd-braille:decode");
        brailleCtx = null;
      },
    },
  ];
}

export class MarketplaceWorkflow {
  async search(query: string): Promise<MarketplacePlugin[]> {
    const q = query.toLowerCase();
    return CATALOG.filter(
      p =>
        p.name.toLowerCase().includes(q) ||
        p.id.includes(q) ||
        p.description.toLowerCase().includes(q),
    );
  }

  async install(id: string): Promise<MarketplacePlugin> {
    const plugin = CATALOG.find(p => p.id === id);
    if (!plugin) throw new Error(`Marketplace: plugin "${id}" not found`);
    return plugin;
  }

  catalog(): MarketplacePlugin[] {
    return [...CATALOG];
  }
}
