/**
 * Local output server — makes the audience display available to OBS.
 *
 * OBS has a Browser Source built in, so the cheapest reliable way to get our
 * output into it is to serve the very same page the audience window renders
 * and let OBS render it directly. No video encode, no generation loss, alpha
 * preserved, resolution independent.
 *
 * State reaches the browser over Server-Sent Events rather than a WebSocket:
 * the output page only ever receives, never sends, and EventSource reconnects
 * on its own if OBS restarts the source mid-service.
 *
 * Bound to loopback by default. A church network is not a place to expose a
 * file server by accident, so reaching beyond this machine is opt-in.
 */

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

const typeOf = (file) => TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';

/**
 * True when `file` really sits inside `root`.
 *
 * Compared after resolving both, so `..` segments and symlinked paths cannot
 * walk out of the allowed folders and turn this into a whole-disk file server.
 */
function within(root, file) {
  const base = path.resolve(root);
  const target = path.resolve(file);
  return target === base || target.startsWith(base + path.sep);
}

class OutputServer {
  /**
   * @param {object} opts
   * @param {() => string} opts.rootDir     where the built pages live
   * @param {() => string[]} opts.mediaRoots folders media may be served from
   * @param {() => object} opts.getState    current live state
   * @param {string} [opts.devUrl]          vite origin, when running in dev
   */
  constructor({ rootDir, mediaRoots, getState, devUrl = '' }) {
    this.rootDir = rootDir;
    this.mediaRoots = mediaRoots;
    this.getState = getState;
    this.devUrl = devUrl;
    this.server = null;
    this.port = 0;
    this.host = '127.0.0.1';
    /** @type {Set<import('node:http').ServerResponse>} */
    this.clients = new Set();
  }

  get running() { return !!this.server?.listening; }

  /** Everything the UI needs to describe the server to the operator. */
  status() {
    return {
      running: this.running,
      port: this.port,
      host: this.host,
      clients: this.clients.size,
      url: this.running ? `http://${this.host === '0.0.0.0' ? this.lanAddress() : '127.0.0.1'}:${this.port}/output` : '',
    };
  }

  /** First non-internal IPv4 address, for the "other machines" case. */
  lanAddress() {
    const nets = require('node:os').networkInterfaces();
    for (const list of Object.values(nets)) {
      for (const n of list ?? []) {
        if (n.family === 'IPv4' && !n.internal) return n.address;
      }
    }
    return '127.0.0.1';
  }

  async start({ port = 7373, allowLan = false } = {}) {
    if (this.running) await this.stop();
    this.host = allowLan ? '0.0.0.0' : '127.0.0.1';

    this.server = http.createServer((req, res) => {
      this._route(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
    });

    // A held-open SSE response must not keep a shutdown waiting.
    this.server.on('connection', (socket) => socket.unref?.());

    await new Promise((resolve, reject) => {
      const onError = (err) => {
        this.server?.removeListener('listening', onListening);
        reject(err.code === 'EADDRINUSE'
          ? new Error(`Port ${port} is already in use — choose another.`)
          : err);
      };
      const onListening = () => {
        this.server?.removeListener('error', onError);
        resolve();
      };
      this.server.once('error', onError);
      this.server.once('listening', onListening);
      this.server.listen(port, this.host);
    });

    this.port = this.server.address().port;
    return this.status();
  }

  async stop() {
    if (!this.server) return { running: false };
    for (const res of this.clients) { try { res.end(); } catch { /* already gone */ } }
    this.clients.clear();
    // close() only stops new connections and then waits for existing ones to
    // finish. Browser sources hold keep-alive sockets open indefinitely, so
    // without this the server would never actually shut down.
    this.server.closeAllConnections?.();
    await new Promise((resolve) => this.server.close(resolve));
    this.server = null;
    this.port = 0;
    return { running: false };
  }

  /** Push the current state to every connected browser source. */
  broadcast(state) {
    if (!this.clients.size) return;
    const frame = `data: ${JSON.stringify(state)}\n\n`;
    for (const res of this.clients) {
      try { res.write(frame); } catch { this.clients.delete(res); }
    }
  }

  async _route(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);

    if (pathname === '/live') return this._sse(req, res);
    if (pathname === '/test') return this._testPattern(res);
    if (pathname === '/media') return this._media(url, res);
    if (pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(this.status()));
    }
    return this._static(pathname, res);
  }

  /**
   * Alignment pattern, for proving whether the receiver is cropping.
   *
   * OBS keeps a scene item's scale when the source's size changes, so a Browser
   * Source resized after it was placed is usually still scaled to its old
   * dimensions and quietly overflows the canvas. That is invisible against a
   * photographic background and obvious against a frame with marked corners.
   *
   * Self-contained rather than part of the built app: it must work even when
   * something about the bundle is wrong, since that is when it gets used.
   */
  _testPattern(res) {
    const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>BiblePortal alignment</title>
<style>
  html,body{height:100%;margin:0;background:#000;overflow:hidden;
    font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;}
  body{display:grid;place-items:center;}
  .stage{position:relative;width:min(100vw,calc(100vh * 16 / 9));height:min(100vh,calc(100vw * 9 / 16));
    background:linear-gradient(135deg,#0b1220,#182a4a);outline:none;}
  .edge{position:absolute;inset:0;border:6px solid #ff3b48;}
  .safe{position:absolute;border:2px dashed rgba(255,255,255,.45);}
  .safe.a{inset:5%;} .safe.b{inset:10%;}
  .corner{position:absolute;width:120px;height:120px;border:6px solid #24e07a;}
  .tl{top:0;left:0;border-right:none;border-bottom:none;}
  .tr{top:0;right:0;border-left:none;border-bottom:none;}
  .bl{bottom:0;left:0;border-right:none;border-top:none;}
  .br{bottom:0;right:0;border-left:none;border-top:none;}
  .tag{position:absolute;color:#24e07a;font-size:2.2vh;font-weight:700;letter-spacing:.08em;}
  .tag.tl{top:2.4%;left:2.2%;border:none;width:auto;height:auto;}
  .tag.tr{top:2.4%;right:2.2%;border:none;width:auto;height:auto;}
  .tag.bl{bottom:2.4%;left:2.2%;border:none;width:auto;height:auto;}
  .tag.br{bottom:2.4%;right:2.2%;border:none;width:auto;height:auto;}
  .cross{position:absolute;left:50%;top:50%;width:8vh;height:8vh;transform:translate(-50%,-50%);}
  .cross::before,.cross::after{content:'';position:absolute;background:#fff;opacity:.8;}
  .cross::before{left:50%;top:0;bottom:0;width:2px;transform:translateX(-50%);}
  .cross::after{top:50%;left:0;right:0;height:2px;transform:translateY(-50%);}
  .mid{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;color:#fff;}
  h1{margin:0 0 1.2vh;font-size:4.4vh;letter-spacing:-.01em;}
  p{margin:.5vh 0;font-size:2.4vh;color:#c8d4ee;}
  .num{font-variant-numeric:tabular-nums;font-size:2.2vh;color:#8fa6d8;margin-top:2vh;}
  b{color:#24e07a;}
</style></head><body>
<div class="stage">
  <div class="edge"></div>
  <div class="safe a"></div><div class="safe b"></div>
  <div class="corner tl"></div><div class="corner tr"></div>
  <div class="corner bl"></div><div class="corner br"></div>
  <span class="tag tl">TOP LEFT</span><span class="tag tr">TOP RIGHT</span>
  <span class="tag bl">BOTTOM LEFT</span><span class="tag br">BOTTOM RIGHT</span>
  <div class="cross"></div>
  <div class="mid">
    <h1>BiblePortal alignment</h1>
    <p>See all four <b>green corners</b> and the whole <b>red border</b>?</p>
    <p>Then nothing is being cropped.</p>
    <div class="num" id="n"></div>
  </div>
</div>
<script>
  const el = document.getElementById('n');
  const tick = () => {
    const s = document.querySelector('.stage').getBoundingClientRect();
    el.textContent = 'viewport ' + innerWidth + ' x ' + innerHeight
      + '   ·   stage ' + Math.round(s.width) + ' x ' + Math.round(s.height)
      + '   ·   ratio ' + (s.width / s.height).toFixed(3);
  };
  tick(); addEventListener('resize', tick);
</script>
</body></html>`;
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(html);
  }

  /** Server-Sent Events stream of live state. */
  _sse(req, res) {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'access-control-allow-origin': '*',
    });
    // Send current state immediately — a source added mid-service must not
    // sit blank waiting for the next slide change.
    res.write(`data: ${JSON.stringify(this.getState())}\n\n`);
    this.clients.add(res);

    // Comment frames keep intermediaries from closing an idle stream.
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, 15000);
    ping.unref?.();
    const drop = () => { clearInterval(ping); this.clients.delete(res); };
    req.on('close', drop);
    req.on('error', drop);
  }

  /** Serve a media file, but only from folders we said were fair game. */
  async _media(url, res) {
    const file = url.searchParams.get('p') || '';
    const roots = this.mediaRoots();
    if (!file || !roots.some((r) => within(r, file))) {
      res.writeHead(403);
      return res.end('Not an allowed path');
    }
    const stat = await fsp.stat(file).catch(() => null);
    if (!stat?.isFile()) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, {
      'content-type': typeOf(file),
      'content-length': stat.size,
      'cache-control': 'public, max-age=3600',
      'access-control-allow-origin': '*',
    });
    fs.createReadStream(file).pipe(res);
  }

  /** Serve the built output page and its assets. */
  async _static(pathname, res) {
    // In dev the pages are served by Vite, so point the browser at it rather
    // than at a dist folder that has not been built.
    if (this.devUrl) {
      const target = pathname === '/' || pathname === '/output'
        ? `${this.devUrl}/output.html`
        : `${this.devUrl}${pathname}`;
      res.writeHead(302, { location: target });
      return res.end();
    }

    const rel = pathname === '/' || pathname === '/output' ? '/output.html' : pathname;
    const root = this.rootDir();
    const file = path.join(root, rel);
    if (!within(root, file)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    const stat = await fsp.stat(file).catch(() => null);
    if (!stat?.isFile()) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, {
      'content-type': typeOf(file),
      'content-length': stat.size,
      'access-control-allow-origin': '*',
    });
    fs.createReadStream(file).pipe(res);
  }
}

module.exports = { OutputServer, within, typeOf };
