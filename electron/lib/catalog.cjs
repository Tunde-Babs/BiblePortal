'use strict';
/**
 * Catalogue of installable translations.
 *
 * LICENSING — read before adding an entry.
 *
 * Everything listed here is public domain or under a licence that permits
 * redistribution. Modern translations (NIV, NLT, NKJV, NASB, ESV, AMP, MSG,
 * CSB, NRSV…) are under active copyright held by their publishers and are
 * deliberately absent: BiblePortal cannot legally ship or download them.
 *
 * A church that owns a licensed copy of one of those installs it through
 * Settings ▸ Translations ▸ Import a module you own, which reads the standard
 * module formats entirely offline:
 *
 *   MyBible / MySword / e-Sword (SQLite) — how most commercial modules ship
 *   Zefania, OSIS, USFX (XML), plain JSON and CSV
 *
 * That keeps the licence between the church and its publisher, where it belongs.
 */

/** @typedef {{id:string, slug:string, name:string, abbr:string, lang:string, language:string, year:number|null, license:string, scope:'full'|'nt'|'ot', core?:boolean, note?:string}} CatalogEntry */

/** @type {CatalogEntry[]} */
const CATALOG = [
  // ---------------------------------------------------------------- English
  { id: 'kjv',  slug: 'kjv',          name: 'King James Version',           abbr: 'KJV',  lang: 'en', language: 'English', year: 1769, license: 'Public Domain', scope: 'full', core: true },
  { id: 'web',  slug: 'web',          name: 'World English Bible',          abbr: 'WEB',  lang: 'en', language: 'English', year: 2000, license: 'Public Domain', scope: 'full', core: true, note: 'Modern English, freely usable' },
  { id: 'asv',  slug: 'asv',          name: 'American Standard Version',    abbr: 'ASV',  lang: 'en', language: 'English', year: 1901, license: 'Public Domain', scope: 'full', core: true },
  { id: 'akjv', slug: 'akjv',         name: 'American King James Version',  abbr: 'AKJV', lang: 'en', language: 'English', year: 1999, license: 'Public Domain', scope: 'full' },
  { id: 'ylt',  slug: 'ylt',          name: "Young's Literal Translation",  abbr: 'YLT',  lang: 'en', language: 'English', year: 1898, license: 'Public Domain', scope: 'full', note: 'Word-for-word, useful for study' },
  { id: 'bbe',  slug: 'basicenglish', name: 'Bible in Basic English',       abbr: 'BBE',  lang: 'en', language: 'English', year: 1965, license: 'Public Domain', scope: 'full', note: 'Simple vocabulary — good for ESL and children' },
  { id: 'wbt',  slug: 'wb',           name: "Webster's Bible",              abbr: 'WBT',  lang: 'en', language: 'English', year: 1833, license: 'Public Domain', scope: 'full' },
  { id: 'dra',  slug: 'douayrheims',  name: 'Douay-Rheims',                 abbr: 'DRA',  lang: 'en', language: 'English', year: 1899, license: 'Public Domain', scope: 'full', note: 'Catholic tradition' },
  { id: 'wey',  slug: 'weymouth',     name: 'Weymouth New Testament',       abbr: 'WEY',  lang: 'en', language: 'English', year: 1903, license: 'Public Domain', scope: 'nt' },
  { id: 'tyn',  slug: 'tyndale',      name: 'Tyndale Bible',                abbr: 'TYN',  lang: 'en', language: 'English', year: 1530, license: 'Public Domain', scope: 'nt', note: 'Historic — 1525/1530' },
  { id: 'wyc',  slug: 'wycliffe',     name: 'Wycliffe Bible',               abbr: 'WYC',  lang: 'en', language: 'English', year: 1395, license: 'Public Domain', scope: 'full', note: 'Middle English, c.1395' },
  { id: 'kjvs', slug: 'kjva',         name: 'KJV with Strong’s',            abbr: 'KJVS', lang: 'en', language: 'English', year: 1769, license: 'Public Domain', scope: 'full', note: 'Tagged with Strong’s numbers' },

  // ------------------------------------------------- Original-language texts
  { id: 'tr',   slug: 'textusreceptus', name: 'Greek NT — Textus Receptus', abbr: 'TR',   lang: 'grc', language: 'Greek',  year: 1894, license: 'Public Domain', scope: 'nt', note: 'Parsed Greek, pairs with Strong’s' },
  { id: 'wh',   slug: 'westcotthort',   name: 'Greek NT — Westcott & Hort', abbr: 'WH',   lang: 'grc', language: 'Greek',  year: 1881, license: 'Public Domain', scope: 'nt' },
  { id: 'lxx',  slug: 'lxx',            name: 'Septuagint (LXX)',           abbr: 'LXX',  lang: 'grc', language: 'Greek',  year: null, license: 'Public Domain', scope: 'ot' },
  { id: 'tis',  slug: 'tischendorf',    name: 'Greek NT — Tischendorf 8th',  abbr: 'TIS',  lang: 'grc', language: 'Greek',  year: 1872, license: 'Public Domain', scope: 'nt' },
  { id: 'vul',  slug: 'vulgate',        name: 'Vulgata Clementina',         abbr: 'VUL',  lang: 'la',  language: 'Latin',  year: 1592, license: 'Public Domain', scope: 'full' },

  // -------------------------------------------------------- Other languages
  { id: 'rvr',  slug: 'valera',          name: 'Reina-Valera',              abbr: 'RVR',  lang: 'es', language: 'Spanish',    year: 1909, license: 'Public Domain', scope: 'full' },
  { id: 'sse',  slug: 'sse',             name: 'Sagradas Escrituras',       abbr: 'SSE',  lang: 'es', language: 'Spanish',    year: 1569, license: 'Public Domain', scope: 'full' },
  { id: 'lsg',  slug: 'ls1910',          name: 'Louis Segond',              abbr: 'LSG',  lang: 'fr', language: 'French',     year: 1910, license: 'Public Domain', scope: 'full' },
  { id: 'lut',  slug: 'luther1545',      name: 'Luther Bibel',              abbr: 'LUT',  lang: 'de', language: 'German',     year: 1545, license: 'Public Domain', scope: 'full' },
  { id: 'sch',  slug: 'schlachter',      name: 'Schlachter',                abbr: 'SCH',  lang: 'de', language: 'German',     year: 1951, license: 'Public Domain', scope: 'full' },
  { id: 'alm',  slug: 'almeida',         name: 'Almeida Atualizada',        abbr: 'AA',   lang: 'pt', language: 'Portuguese', year: 1911, license: 'Public Domain', scope: 'full' },
  { id: 'riv',  slug: 'riveduta',        name: 'Riveduta',                  abbr: 'RIV',  lang: 'it', language: 'Italian',    year: 1927, license: 'Public Domain', scope: 'full' },
  { id: 'svv',  slug: 'statenvertaling', name: 'Statenvertaling',           abbr: 'SVV',  lang: 'nl', language: 'Dutch',      year: 1637, license: 'Public Domain', scope: 'full' },
  { id: 'rus',  slug: 'synodal',         name: 'Synodal Translation',       abbr: 'SYN',  lang: 'ru', language: 'Russian',    year: 1876, license: 'Public Domain', scope: 'full' },
  { id: 'cus',  slug: 'cus',             name: 'Chinese Union (Simplified)', abbr: 'CUS', lang: 'zh', language: 'Chinese',    year: 1919, license: 'Public Domain', scope: 'full' },
  { id: 'cut',  slug: 'cut',             name: 'Chinese Union (Traditional)', abbr: 'CUT', lang: 'zh', language: 'Chinese',   year: 1919, license: 'Public Domain', scope: 'full' },
  { id: 'kor',  slug: 'korean',          name: 'Korean Bible',              abbr: 'KOR',  lang: 'ko', language: 'Korean',     year: 1910, license: 'Public Domain', scope: 'full' },
  { id: 'arb',  slug: 'arabicsv',        name: 'Smith & Van Dyke',          abbr: 'SVD',  lang: 'ar', language: 'Arabic',     year: 1865, license: 'Public Domain', scope: 'full' },
  { id: 'swa',  slug: 'swahili',         name: 'Swahili Bible',             abbr: 'SWA',  lang: 'sw', language: 'Swahili',    year: null, license: 'Public Domain', scope: 'full' },
  { id: 'tgl',  slug: 'tagalog',         name: 'Ang Dating Biblia',         abbr: 'ADB',  lang: 'tl', language: 'Tagalog',    year: 1905, license: 'Public Domain', scope: 'full' },
  { id: 'vie',  slug: 'vietnamese',      name: 'Vietnamese Bible',          abbr: 'VIE',  lang: 'vi', language: 'Vietnamese', year: 1934, license: 'Public Domain', scope: 'full' },
  { id: 'afr',  slug: 'aov',             name: 'Ou Vertaling',              abbr: 'AOV',  lang: 'af', language: 'Afrikaans',  year: 1953, license: 'Public Domain', scope: 'full' },
  { id: 'ron',  slug: 'cornilescu',      name: 'Cornilescu',                abbr: 'RCC',  lang: 'ro', language: 'Romanian',   year: 1924, license: 'Public Domain', scope: 'full' },
  { id: 'rv18', slug: 'rv1858',          name: 'Reina-Valera NT',           abbr: 'RV18', lang: 'es', language: 'Spanish',    year: 1858, license: 'Public Domain', scope: 'nt' },
  { id: 'dby',  slug: 'darby',           name: 'Darby',                     abbr: 'DBY',  lang: 'fr', language: 'French',     year: 1885, license: 'Public Domain', scope: 'full' },
  { id: 'mar',  slug: 'martin',          name: 'Martin',                    abbr: 'MAR',  lang: 'fr', language: 'French',     year: 1744, license: 'Public Domain', scope: 'full' },
  { id: 'elb',  slug: 'elberfelder1905', name: 'Elberfelder',               abbr: 'ELB',  lang: 'de', language: 'German',     year: 1905, license: 'Public Domain', scope: 'full' },
  { id: 'dio',  slug: 'giovanni',        name: 'Giovanni Diodati',          abbr: 'DIO',  lang: 'it', language: 'Italian',    year: 1649, license: 'Public Domain', scope: 'full' },
  { id: 'plv',  slug: 'livre',           name: 'Bíblia Livre',              abbr: 'BLV',  lang: 'pt', language: 'Portuguese', year: 2018, license: 'Public Domain', scope: 'full' },
  { id: 'chnl', slug: 'chiunl',          name: '聖經 (文理和合)',            abbr: 'CUV',  lang: 'zh', language: 'Chinese',    year: 1919, license: 'Public Domain', scope: 'full' },
  { id: 'kkjv', slug: 'koreankjv',       name: 'Hangul King James',         abbr: 'KKJV', lang: 'ko', language: 'Korean',     year: 1994, license: 'Public Domain', scope: 'full' },
  { id: 'canis', slug: 'canisius',       name: 'Petrus Canisius',           abbr: 'CAN',  lang: 'nl', language: 'Dutch',      year: 1939, license: 'Public Domain', scope: 'full' },
];

/**
 * Copyrighted translations users often ask for. Listed so the app can explain
 * itself precisely instead of just saying "not found".
 */
const LICENSED = [
  { abbr: 'NIV',  name: 'New International Version', holder: 'Biblica / Zondervan' },
  { abbr: 'NLT',  name: 'New Living Translation',    holder: 'Tyndale House Publishers' },
  { abbr: 'NKJV', name: 'New King James Version',    holder: 'Thomas Nelson' },
  { abbr: 'ESV',  name: 'English Standard Version',  holder: 'Crossway' },
  { abbr: 'NASB', name: 'New American Standard Bible', holder: 'The Lockman Foundation' },
  { abbr: 'AMP',  name: 'Amplified Bible',           holder: 'The Lockman Foundation' },
  { abbr: 'MSG',  name: 'The Message',               holder: 'NavPress' },
  { abbr: 'CSB',  name: 'Christian Standard Bible',  holder: 'Holman / Lifeway' },
  { abbr: 'NRSV', name: 'New Revised Standard Version', holder: 'NCC / Friendship Press' },
];

const CORE_IDS = CATALOG.filter((t) => t.core).map((t) => t.id);
const byId = (id) => CATALOG.find((t) => t.id === id) ?? null;

/** Group the catalogue by language for the Translation Manager UI. */
function grouped() {
  const groups = new Map();
  for (const t of CATALOG) {
    if (!groups.has(t.language)) groups.set(t.language, []);
    groups.get(t.language).push(t);
  }
  // English first, then original languages, then everything else alphabetically.
  const order = (name) => (name === 'English' ? 0 : ['Greek', 'Latin', 'Hebrew'].includes(name) ? 1 : 2);
  return [...groups.entries()]
    .sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]))
    .map(([language, translations]) => ({ language, translations }));
}

module.exports = { CATALOG, LICENSED, CORE_IDS, byId, grouped };
