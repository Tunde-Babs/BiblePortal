'use strict';
/**
 * Window management: the operator console plus the audience and stage outputs.
 *
 * Output windows are frameless, always-on-top and placed on a specific monitor.
 * They are deliberately cheap to create and destroy, so an operator can move an
 * output between screens mid-service without restarting anything.
 */

const path = require('node:path');
const { BrowserWindow, screen } = require('electron');

const DEV_URL = 'http://localhost:5273';
const isDev = () => process.env.BP_DEV === '1';

/** Resolve a renderer entry to a dev URL or a built file. */
function entry(page) {
  return isDev()
    ? { url: `${DEV_URL}/${page}.html` }
    : { file: path.join(__dirname, '..', 'dist', `${page}.html`) };
}

function loadPage(win, page) {
  const target = entry(page);
  if (target.url) win.loadURL(target.url);
  else win.loadFile(target.file);
}

class WindowManager {
  constructor() {
    /** @type {BrowserWindow|null} */ this.console = null;
    /** @type {BrowserWindow|null} */ this.output = null;
    /** @type {BrowserWindow|null} */ this.stage = null;
  }

  get preload() { return path.join(__dirname, 'preload.cjs'); }

  createConsole() {
    if (this.console && !this.console.isDestroyed()) { this.console.focus(); return this.console; }

    this.console = new BrowserWindow({
      width: 1560,
      height: 980,
      minWidth: 1100,
      minHeight: 700,
      show: false,
      backgroundColor: '#0a0d18',
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
      trafficLightPosition: { x: 16, y: 18 },
      webPreferences: {
        preload: this.preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        spellcheck: false,
      },
    });

    loadPage(this.console, 'index');
    this.console.once('ready-to-show', () => this.console.show());
    this.console.on('closed', () => { this.console = null; });
    return this.console;
  }

  /** All monitors, annotated so the UI can label them meaningfully. */
  displays() {
    const primary = screen.getPrimaryDisplay();
    return screen.getAllDisplays().map((d, i) => ({
      id: String(d.id),
      index: i,
      label: d.id === primary.id ? `Display ${i + 1} (Primary)` : `Display ${i + 1}`,
      bounds: d.bounds,
      size: `${d.size.width}×${d.size.height}`,
      scaleFactor: d.scaleFactor,
      primary: d.id === primary.id,
      internal: d.internal ?? false,
      inUse: {
        output: this.output && !this.output.isDestroyed() ? this._screenIdOf(this.output) === String(d.id) : false,
        stage: this.stage && !this.stage.isDestroyed() ? this._screenIdOf(this.stage) === String(d.id) : false,
      },
    }));
  }

  _screenIdOf(win) {
    try {
      const b = win.getBounds();
      return String(screen.getDisplayNearestPoint({ x: b.x + 10, y: b.y + 10 }).id);
    } catch { return null; }
  }

  /** Pick a display, preferring an explicit id, then any non-primary screen. */
  _resolveDisplay(screenId) {
    const all = screen.getAllDisplays();
    if (screenId) {
      const found = all.find((d) => String(d.id) === String(screenId));
      if (found) return found;
    }
    const primary = screen.getPrimaryDisplay();
    return all.find((d) => d.id !== primary.id) ?? primary;
  }

  /**
   * Open (or move) an output window.
   * @param {'output'|'stage'} kind
   * @param {string|null} screenId
   */
  openOutput(kind, screenId = null) {
    const display = this._resolveDisplay(screenId);
    const existing = kind === 'output' ? this.output : this.stage;

    if (existing && !existing.isDestroyed()) {
      // Moving between monitors: unset fullscreen first or the bounds are ignored.
      existing.setFullScreen(false);
      existing.setBounds(display.bounds);
      // A frameless window on the same screen as the console should not be
      // fullscreen, or the operator can never get back to the console.
      if (!display.internal || screen.getAllDisplays().length > 1) existing.setFullScreen(true);
      existing.showInactive();
      return { ok: true, kind, screenId: String(display.id), moved: true };
    }

    const win = new BrowserWindow({
      ...display.bounds,
      frame: false,
      show: false,
      fullscreenable: true,
      backgroundColor: '#000000',
      alwaysOnTop: true,
      skipTaskbar: true,
      webPreferences: {
        preload: this.preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false, // never drop frames while minimised behind the console
      },
    });

    // Float above full-screen apps without stealing focus from the console.
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    loadPage(win, kind === 'output' ? 'output' : 'stage');
    win.once('ready-to-show', () => {
      win.showInactive();
      if (screen.getAllDisplays().length > 1) win.setFullScreen(true);
    });
    win.on('closed', () => { if (kind === 'output') this.output = null; else this.stage = null; });

    if (kind === 'output') this.output = win; else this.stage = win;
    return { ok: true, kind, screenId: String(display.id), moved: false };
  }

  closeOutput(kind) {
    const win = kind === 'output' ? this.output : this.stage;
    if (win && !win.isDestroyed()) win.close();
    return { ok: true, kind };
  }

  isOpen(kind) {
    const win = kind === 'output' ? this.output : this.stage;
    return !!(win && !win.isDestroyed());
  }

  /** Push a message to every live window. */
  broadcast(channel, payload) {
    for (const win of [this.console, this.output, this.stage]) {
      if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
    }
  }

  /** Push only to the output surfaces (not the console). */
  broadcastOutputs(channel, payload) {
    for (const win of [this.output, this.stage]) {
      if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
    }
  }
}

module.exports = { WindowManager, isDev };
