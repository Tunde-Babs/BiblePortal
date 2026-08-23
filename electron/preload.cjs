'use strict';
/**
 * The only bridge between the renderer and Node.
 *
 * Nothing from Node is exposed directly: the renderer gets a fixed, explicit
 * list of invokable channels and a subscribe helper. Context isolation stays on
 * and node integration stays off in every window.
 */

const { contextBridge, ipcRenderer } = require('electron');
const { INVOKE, EVENTS } = require('./ipc-channels.cjs');

/** Build `api.bible.lookup(...)` etc. from the flat channel list. */
const api = {};
for (const channel of INVOKE) {
  const [group, method] = channel.split(':');
  (api[group] ??= {})[method] = (...args) => ipcRenderer.invoke(channel, ...args);
}

/**
 * Subscribe to a main-process event.
 * @returns {() => void} unsubscribe
 */
function on(event, handler) {
  if (!Object.values(EVENTS).includes(event)) {
    throw new Error(`Unknown event: ${event}`);
  }
  const listener = (_e, payload) => handler(payload);
  ipcRenderer.on(event, listener);
  return () => ipcRenderer.removeListener(event, listener);
}

contextBridge.exposeInMainWorld('bp', {
  ...api,
  on,
  EVENTS,
  platform: process.platform,
});
