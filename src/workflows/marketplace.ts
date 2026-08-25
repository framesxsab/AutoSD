/**
 * Marketplace workflow — plugin discovery + install (stubbed, additive).
 */

export type MarketplacePlugin = {
  id: string;
  name: string;
  version: string;
  description: string;
  downloads: number;
};

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
