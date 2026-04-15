/**
 * INSPIRE HEP API utilities for Zotero FileRenamer.
 *
 * Provides:
 * - Recid extraction from Zotero items
 * - Fetching the reference list from INSPIRE for a given recid
 */

import { Settings } from "./settings";

const INSPIRE_API_BASE = "https://inspirehep.net/api";

// ─────────────────────────────────────────────────────────────────────────────
// Recid extraction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract INSPIRE recid from a Zotero item.
 * Checks archiveLocation, URL, and Extra field.
 */
export function deriveRecidFromItem(item: Zotero.Item): string | null {
  // 1. archiveLocation (pure numeric = recid)
  const archiveLocation = (
    item.getField("archiveLocation") as string | undefined
  )?.trim();
  if (archiveLocation && /^\d+$/.test(archiveLocation)) {
    return archiveLocation;
  }

  // 2. URL field: match inspirehep.net/literature/{recid}
  const url = item.getField("url") as string | undefined;
  if (url) {
    const match = url.match(/inspirehep\.net\/(?:literature|record)\/(\d+)/);
    if (match) return match[1];
  }

  // 3. Extra field: match inspirehep URL pattern
  const extra = item.getField("extra") as string | undefined;
  if (extra) {
    const match = extra.match(/inspirehep\.net\/(?:record|literature)\/(\d+)/i);
    if (match) return match[1];
  }

  return null;
}

/**
 * Extract recid from an INSPIRE $ref URL.
 * Example: "https://inspirehep.net/api/literature/123456" -> "123456"
 */
export function extractRecidFromRef(ref: string): string | null {
  const match = ref.match(/\/literature\/(\d+)$/);
  return match ? match[1] : null;
}

interface CacheEntry {
  timestamp: number;
  references: Record<string, number>;
  citations: Record<string, number>;
}

const CACHE_PREF = "extensions.zotero.filerenamer.inspireCache";
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

function getCache(): Record<string, CacheEntry> {
  try {
    const data = Zotero.Prefs.get(CACHE_PREF, true) as string;
    if (!data) return {};

    const parsed = JSON.parse(data) as Record<string, Partial<CacheEntry>>;
    const normalized: Record<string, CacheEntry> = {};

    for (const [recid, entry] of Object.entries(parsed)) {
      if (!entry || typeof entry.timestamp !== "number") continue;
      normalized[recid] = {
        timestamp: entry.timestamp,
        references:
          entry.references && typeof entry.references === "object"
            ? (entry.references as Record<string, number>)
            : {},
        citations:
          entry.citations && typeof entry.citations === "object"
            ? (entry.citations as Record<string, number>)
            : {},
      };
    }

    return normalized;
  } catch (err) {
    Zotero.logError(`[FileRenamer] Failed to read INSPIRE cache: ${err}`);
  }
  return {};
}

function saveCache(cache: Record<string, CacheEntry>) {
  try {
    Zotero.Prefs.set(CACHE_PREF, JSON.stringify(cache), true);
  } catch (err) {
    Zotero.logError(`[FileRenamer] Failed to write INSPIRE cache: ${err}`);
  }
}

function mapsFromCacheEntry(entry: CacheEntry): {
  references: Map<string, number>;
  citations: Map<string, number>;
} {
  return {
    references: new Map(Object.entries(entry.references)),
    citations: new Map(Object.entries(entry.citations)),
  };
}

/**
 * Fetch both references (papers A cites) and citations (papers citing A) for a base item.
 * Returns Maps of recid -> index (1-based index in the respective lists).
 * Caches results in Zotero.Prefs to minimize INSPIRE load.
 */
export async function fetchBaseItemData(recid: string): Promise<{
  references: Map<string, number>;
  citations: Map<string, number>;
}> {
  const cache = getCache();
  const now = Date.now();
  const cachedEntry = cache[recid];

  if (cachedEntry) {
    const isExpired = now - cachedEntry.timestamp >= CACHE_TTL;
    if (!isExpired || Settings.offlineMode) {
      Zotero.debug(`[FileRenamer] Using cached INSPIRE data for recid ${recid} (Offline: ${Settings.offlineMode})`);
      return mapsFromCacheEntry(cachedEntry);
    }
  }

  if (Settings.offlineMode) {
    Zotero.debug(`[FileRenamer] Offline Mode active. No cache for ${recid}. Skipping.`);
    return { references: new Map(), citations: new Map() };
  }

  Zotero.debug(`[FileRenamer] Fetching INSPIRE data for recid ${recid}`);
  let references = new Map<string, number>();
  let citations = new Map<string, number>();
  let referencesFetched = false;
  let citationsFetched = false;

  try {
    // 1. Fetch references (papers that base item cites) -> [A1-XX]
    const refUrl = `${INSPIRE_API_BASE}/literature/${encodeURIComponent(recid)}?fields=metadata.references`;
    const refRes = await Zotero.HTTP.request("GET", refUrl);
    
    if (refRes.status === 200) {
      const payload = JSON.parse(refRes.responseText);
      const refs = payload.metadata?.references ?? [];
      
      refs.forEach((ref: any, index: number) => {
        if (ref.record?.$ref) {
          const r = extractRecidFromRef(ref.record.$ref);
          // Store 1-based index
          if (r) references.set(r, index + 1);
        }
      });
      referencesFetched = true;
    } else {
      Zotero.logError(`[FileRenamer] API Error fetching references for ${recid}: HTTP ${refRes.status}`);
    }

    // 2. Fetch citations (papers that cite base item) -> [A1-CXX]
    // Use dateasc to mimic chronological order (and consistent stable indexing). max size 1000.
    const citUrl = `${INSPIRE_API_BASE}/literature?q=refersto:recid:${encodeURIComponent(recid)}&sort=dateasc&fields=control_number&size=1000`;
    const citRes = await Zotero.HTTP.request("GET", citUrl);
    
    if (citRes.status === 200) {
      const payload = JSON.parse(citRes.responseText);
      const hits = payload.hits?.hits ?? [];
      
      hits.forEach((hit: any, index: number) => {
        const citingRecid = hit.id || hit.metadata?.control_number;
        // Store 1-based index
        if (citingRecid) citations.set(String(citingRecid), index + 1);
      });
      citationsFetched = true;
    } else {
      Zotero.logError(`[FileRenamer] API Error fetching citations for ${recid}: HTTP ${citRes.status}`);
    }
  } catch (err) {
    Zotero.logError(`[FileRenamer] API Exception fetching data for base item ${recid}: ${err}`);
  }

  if (cachedEntry) {
    if (!referencesFetched) {
      references = new Map(Object.entries(cachedEntry.references));
    }
    if (!citationsFetched) {
      citations = new Map(Object.entries(cachedEntry.citations));
    }
  }

  if (!referencesFetched && !citationsFetched && cachedEntry) {
    Zotero.debug(`[FileRenamer] Falling back to stale INSPIRE cache for recid ${recid}`);
    return mapsFromCacheEntry(cachedEntry);
  }

  if (referencesFetched || citationsFetched) {
    cache[recid] = {
      timestamp: now,
      references: Object.fromEntries(references),
      citations: Object.fromEntries(citations),
    };
    saveCache(cache);
  }

  return { references, citations };
}
