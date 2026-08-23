'use strict';
/** Every IPC channel name in one place, so main and preload can never drift. */

const INVOKE = [
  // bible
  'bible:manifest', 'bible:lookup', 'bible:chapter', 'bible:search', 'bible:smart', 'bible:suggest',
  'bible:parallel', 'bible:books', 'bible:strongs', 'bible:lexiconSearch', 'bible:stats',
  // translations
  'translations:catalogue', 'translations:install', 'translations:import',
  'translations:inspect', 'translations:remove', 'translations:pickModule',
  // songs
  'songs:all', 'songs:get', 'songs:search', 'songs:upsert', 'songs:remove',
  'songs:import', 'songs:importText', 'songs:export', 'songs:slides',
  'songs:markUsed', 'songs:stats', 'songs:pickFiles',
  // plans
  'plans:all', 'plans:get', 'plans:create', 'plans:update', 'plans:remove',
  'plans:duplicate', 'plans:addItem', 'plans:updateItem', 'plans:removeItem', 'plans:reorder',
  // schedule files (New / Open / Save / templates / recents)
  'schedule:recent', 'schedule:clearRecent', 'schedule:save', 'schedule:saveAs',
  'schedule:open', 'schedule:openPath', 'schedule:templates', 'schedule:saveTemplate',
  'schedule:newFromTemplate', 'schedule:revealFolder',
  // song collections
  'collections:all', 'collections:create', 'collections:rename', 'collections:remove',
  'collections:addSongs', 'collections:removeSong',
  // settings & themes
  'settings:get', 'settings:patch', 'settings:reset',
  'themes:all', 'themes:save', 'themes:delete', 'themes:active',
  // live
  'live:get', 'live:preview', 'live:take', 'live:step', 'live:goTo', 'live:stepPreview',
  'live:blackout', 'live:clear', 'live:restore', 'live:logo', 'live:alert', 'live:set',
  // displays
  'displays:list', 'displays:open', 'displays:close', 'displays:status',
  // ai
  'ai:detect', 'ai:resetDetection', 'ai:topical', 'ai:topics', 'ai:outline', 'ai:forSong',
  // media
  'media:all', 'media:import', 'media:remove', 'media:update',
  // presentations (.pptx)
  'presentations:all', 'presentations:get', 'presentations:pick', 'presentations:inspect',
  'presentations:import', 'presentations:remove', 'presentations:rename',
  // sermon notes
  'sermons:all', 'sermons:get', 'sermons:create', 'sermons:update', 'sermons:remove',
  'sermons:duplicate', 'sermons:addPoint', 'sermons:updatePoint', 'sermons:removePoint',
  'sermons:movePoint', 'sermons:slides',
  // EasyWorship migration
  'ew:pickFile', 'ew:pickFolder', 'ew:inspect', 'ew:importSchedule', 'ew:importFolder',
  // app
  'app:info', 'app:setDirty', 'app:quit', 'app:diag', 'app:backup', 'app:restore', 'app:openPath', 'app:revealDataFolder',
];

/** main -> renderer pushes */
const EVENTS = {
  LIVE_CHANGED: 'live:changed',
  TRANSLATION_PROGRESS: 'translations:progress',
  LIBRARY_CHANGED: 'library:changed',
  DISPLAYS_CHANGED: 'displays:changed',
  HOTKEY: 'app:hotkey',
  TOAST: 'app:toast',
};

module.exports = { INVOKE, EVENTS };
