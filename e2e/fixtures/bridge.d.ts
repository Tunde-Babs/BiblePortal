/**
 * The preload bridge, as seen from inside a page.
 *
 * Declared globally so specs can write `window.bp.bible.lookup(...)` inside a
 * `page.evaluate` and still get completion and type checking. The shapes are
 * deliberately loose — this describes the boundary the renderer actually sees,
 * not the main process's internals, and pinning every payload here would mean
 * maintaining a second copy of the API surface.
 */

interface BpGroup {
  [method: string]: (...args: any[]) => Promise<any>;
}

interface BpBridge {
  bible: BpGroup;
  translations: BpGroup;
  songs: BpGroup;
  plans: BpGroup;
  schedule: BpGroup;
  collections: BpGroup;
  settings: BpGroup;
  themes: BpGroup;
  media: BpGroup;
  presentations: BpGroup;
  sermon: BpGroup;
  sermons: BpGroup;
  ai: BpGroup;
  live: BpGroup;
  displays: BpGroup;
  outputServer: BpGroup;
  online: BpGroup;
  ew: BpGroup;
  app: BpGroup;
  [group: string]: BpGroup | ((...args: any[]) => any) | unknown;

  on(event: string, handler: (payload: unknown) => void): () => void;
  EVENTS: Record<string, string>;
  platform: string;
}

interface Window {
  bp: BpBridge;
}
