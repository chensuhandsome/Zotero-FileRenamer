/**
 * Core labeling logic for Zotero FileRenamer.
 */
import { deriveRecidFromItem, fetchBaseItemData } from "./inspireApi";
import { showCornerNotification } from "./notifications";
import { Settings } from "./settings";

const ADDON_NAME = "FileRenamer";

const ANY_PREFIX_REGEX = /^(?:\[[^\]\s]+\]\s*)+/;
const LABEL_LINE_PREFIX = "FileRenamer:";
const BASE_TITLE_LINE_PREFIX = "FileRenamerBase:";
const LOCAL_RELATION_CACHE_PREF = "extensions.zotero.filerenamer.localRelationCache";
const INTERNAL_UPDATE_TTL_MS = 1500;
const internalUpdateCounts = new Map<number, number>();
const LEGAL_BASIC_LABEL_REGEX = /^(?:[A-Za-z]+)?\d+$/;
const LEGAL_DERIVED_LABEL_REGEX = /^(?:[A-Za-z]+)?\d+-(?:\d+|C\d+)$/;

type ManagedTitleOptions = {
  preferCurrentTitle?: boolean;
  syncBaseFromCurrentTitle?: boolean;
};

type NumberFromBasicsOptions = ManagedTitleOptions & {
  createBasicForUnlabeled?: boolean;
  silent?: boolean;
};

export function getLabelUpdateMode(
  title: string,
  extra: string,
): "managed" | "manual-basic" | "invalid-prefix" | "unlabeled" {
  const extraLabels = normalizeLabels(extractLabelsFromExtra(extra));
  const storedBaseTitle = extractBaseTitleFromExtra(extra);

  if (extraLabels.length > 0) {
    return "managed";
  }

  if (storedBaseTitle !== null && normalizeLabels(extractLabelsFromTitle(title)).length > 0) {
    return "managed";
  }

  if (extractManualBasicLabelsFromTitle(title).length === 1) {
    return "manual-basic";
  }

  if (hasAnyLeadingBracketPrefix(title)) {
    return "invalid-prefix";
  }

  return "unlabeled";
}

function decrementInternalUpdateCount(itemID: number): void {
  const count = internalUpdateCounts.get(itemID) ?? 0;
  if (count <= 1) {
    internalUpdateCounts.delete(itemID);
    return;
  }
  internalUpdateCounts.set(itemID, count - 1);
}

function trackInternalItemSave(itemID: number): void {
  internalUpdateCounts.set(itemID, (internalUpdateCounts.get(itemID) ?? 0) + 1);
  setTimeout(() => {
    decrementInternalUpdateCount(itemID);
  }, INTERNAL_UPDATE_TTL_MS);
}

function getItemID(item: Zotero.Item): number | undefined {
  const itemID = (item as Zotero.Item & { id?: number }).id;
  return typeof itemID === "number" ? itemID : undefined;
}

async function saveItemWithInternalGuard(item: Zotero.Item): Promise<void> {
  const itemID = getItemID(item);
  if (itemID === undefined) {
    await item.saveTx();
    return;
  }

  trackInternalItemSave(itemID);
  try {
    await item.saveTx();
  } catch (err) {
    decrementInternalUpdateCount(itemID);
    throw err;
  }
}

export function consumeInternalLabelUpdate(itemID: number): boolean {
  const count = internalUpdateCounts.get(itemID) ?? 0;
  if (count === 0) {
    return false;
  }

  decrementInternalUpdateCount(itemID);
  return true;
}

function compareTokens(t1: string, t2: string): number {
  const isNum1 = /^\d+$/.test(t1);
  const isNum2 = /^\d+$/.test(t2);

  const getRank = (c: string) =>
    /^\d+$/.test(c) ? 1 : /^[a-zA-Z]$/.test(c) ? 2 : c === "-" ? 3 : 4;

  const rank1 = getRank(t1);
  const rank2 = getRank(t2);

  if (rank1 !== rank2) return rank1 - rank2;
  if (isNum1 && isNum2) return parseInt(t1, 10) - parseInt(t2, 10);

  return t1.localeCompare(t2);
}

type LocalRelationCacheEntry = {
  labels: string[];
  references: Record<string, number>;
  citations: Record<string, number>;
  hasFetchedRelations: boolean;
  timestamp: number;
};

function getLocalRelationCache(): Record<string, LocalRelationCacheEntry> {
  try {
    const raw = Zotero.Prefs.get(LOCAL_RELATION_CACHE_PREF, true) as string;
    if (!raw) return {};

    const parsed = JSON.parse(raw) as Record<string, Partial<LocalRelationCacheEntry>>;
    const cache: Record<string, LocalRelationCacheEntry> = {};
    for (const [recid, entry] of Object.entries(parsed)) {
      if (!entry || !Array.isArray(entry.labels)) continue;
      cache[recid] = {
        labels: normalizeLabels(entry.labels),
        references:
          entry.references && typeof entry.references === "object"
            ? (entry.references as Record<string, number>)
            : {},
        citations:
          entry.citations && typeof entry.citations === "object"
            ? (entry.citations as Record<string, number>)
            : {},
        hasFetchedRelations: entry.hasFetchedRelations === true,
        timestamp: typeof entry.timestamp === "number" ? entry.timestamp : 0,
      };
    }
    return cache;
  } catch (err) {
    Zotero.logError(`[${ADDON_NAME}] Failed to read FileRenamer local relation cache: ${err}`);
    return {};
  }
}

function saveLocalRelationCache(cache: Record<string, LocalRelationCacheEntry>): void {
  try {
    Zotero.Prefs.set(LOCAL_RELATION_CACHE_PREF, JSON.stringify(cache), true);
  } catch (err) {
    Zotero.logError(`[${ADDON_NAME}] Failed to write FileRenamer local relation cache: ${err}`);
  }
}

function updateLocalRelationCache(
  recid: string,
  patch: Partial<LocalRelationCacheEntry>,
): void {
  const cache = getLocalRelationCache();
  const current = cache[recid] ?? {
    labels: [],
    references: {},
    citations: {},
    hasFetchedRelations: false,
    timestamp: 0,
  };

  cache[recid] = {
    labels: patch.labels ? normalizeLabels(patch.labels) : current.labels,
    references: patch.references ?? current.references,
    citations: patch.citations ?? current.citations,
    hasFetchedRelations: patch.hasFetchedRelations ?? current.hasFetchedRelations,
    timestamp: patch.timestamp ?? Date.now(),
  };

  saveLocalRelationCache(cache);
}

function getLocalCachedLabels(recid: string): string[] {
  const entry = getLocalRelationCache()[recid];
  return entry ? normalizeLabels(entry.labels) : [];
}

function getLocalCachedRelations(recid: string): {
  references: Map<string, number>;
  citations: Map<string, number>;
} | null {
  const entry = getLocalRelationCache()[recid];
  if (!entry?.hasFetchedRelations) {
    return null;
  }

  return {
    references: new Map(Object.entries(entry.references)),
    citations: new Map(Object.entries(entry.citations)),
  };
}

function setLocalCachedLabels(recid: string, labels: string[]): void {
  const normalized = normalizeLabels(labels);
  if (normalized.length === 0) return;
  updateLocalRelationCache(recid, {
    labels: normalized,
    timestamp: Date.now(),
  });
}

function setLocalCachedRelations(
  recid: string,
  data: {
    references: Map<string, number>;
    citations: Map<string, number>;
  },
): void {
  updateLocalRelationCache(recid, {
    references: Object.fromEntries(data.references),
    citations: Object.fromEntries(data.citations),
    hasFetchedRelations: true,
    timestamp: Date.now(),
  });
}

function compareAlphaNumericLabel(a: string, b: string): number {
  const tokensA = a.match(/\d+|[^0-9]/g) || [];
  const tokensB = b.match(/\d+|[^0-9]/g) || [];

  const len = Math.min(tokensA.length, tokensB.length);
  for (let i = 0; i < len; i++) {
    const cmp = compareTokens(tokensA[i], tokensB[i]);
    if (cmp !== 0) return cmp;
  }

  return tokensA.length - tokensB.length;
}

function parseDerivedSegment(segment: string): {
  isCitation: boolean;
  index: number | null;
  raw: string;
} {
  if (/^C\d+$/.test(segment)) {
    return {
      isCitation: true,
      index: parseInt(segment.slice(1), 10),
      raw: segment,
    };
  }

  if (/^\d+$/.test(segment)) {
    return {
      isCitation: false,
      index: parseInt(segment, 10),
      raw: segment,
    };
  }

  return {
    isCitation: segment.startsWith("C"),
    index: null,
    raw: segment,
  };
}

function compareDerivedLabels(a: string, b: string): number {
  const partsA = a.split("-");
  const partsB = b.split("-");

  const baseCmp = compareAlphaNumericLabel(partsA[0], partsB[0]);
  if (baseCmp !== 0) return baseCmp;

  const depthCmp = (partsA.length - 1) - (partsB.length - 1);
  if (depthCmp !== 0) return depthCmp;

  const len = Math.min(partsA.length, partsB.length);
  for (let i = 1; i < len; i++) {
    const segA = parseDerivedSegment(partsA[i]);
    const segB = parseDerivedSegment(partsB[i]);

    if (segA.isCitation !== segB.isCitation) {
      return segA.isCitation ? 1 : -1;
    }

    if (segA.index !== null && segB.index !== null && segA.index !== segB.index) {
      return segA.index - segB.index;
    }

    const rawCmp = compareAlphaNumericLabel(segA.raw, segB.raw);
    if (rawCmp !== 0) return rawCmp;
  }

  return partsA.length - partsB.length;
}

export function sortLabels(labels: string[]): string[] {
  return labels.sort(compareDerivedLabels);
}

function isDisplayLabel(label: string): boolean {
  return (
    isTruncationLabel(label) ||
    LEGAL_BASIC_LABEL_REGEX.test(label) ||
    LEGAL_DERIVED_LABEL_REGEX.test(label)
  );
}

function parseTitlePrefix(title: string): {
  labels: string[];
  restStart: number;
} {
  const labels: string[] = [];
  let cursor = 0;
  let consumedAny = false;

  while (cursor < title.length) {
    if (consumedAny) {
      while (cursor < title.length && /\s/.test(title[cursor])) {
        cursor++;
      }
    }

    if (title[cursor] !== "[") {
      break;
    }

    const closeBracket = title.indexOf("]", cursor + 1);
    if (closeBracket === -1) {
      break;
    }

    const rawLabel = title.slice(cursor + 1, closeBracket).trim();
    if (!isDisplayLabel(rawLabel)) {
      break;
    }

    labels.push(rawLabel);
    cursor = closeBracket + 1;
    consumedAny = true;
  }

  return {
    labels,
    restStart: consumedAny ? cursor : 0,
  };
}

function extractManualBasicLabelsFromTitle(title: string): string[] {
  const labels = parseTitlePrefix(title).labels.filter(label => !isTruncationLabel(label));
  const baseLabels = labels.filter(isBaseLabel);

  if (labels.length !== 1 || baseLabels.length !== 1) {
    return [];
  }

  return baseLabels;
}

export function extractLabelsFromTitle(title: string): string[] {
  return parseTitlePrefix(title).labels;
}

export function stripLabel(title: string): string {
  const { labels, restStart } = parseTitlePrefix(title);
  if (labels.length === 0) {
    return title.trim();
  }
  return title.slice(restStart).trim();
}

function stripAnyLeadingBracketPrefix(title: string): string {
  return title.replace(ANY_PREFIX_REGEX, "").trim();
}

function hasAnyLeadingBracketPrefix(title: string): boolean {
  return ANY_PREFIX_REGEX.test(title);
}

function isTruncationLabel(label: string): boolean {
  return /^\+\d+$/.test(label);
}

function isSupportedLabelDepth(label: string): boolean {
  return label.split("-").length <= 2;
}

function isBaseLabel(label: string): boolean {
  return LEGAL_BASIC_LABEL_REGEX.test(label);
}

function isDerivedLabel(label: string): boolean {
  return LEGAL_DERIVED_LABEL_REGEX.test(label);
}

function extractLabelsFromExtra(extra: string): string[] {
  const match = extra.match(/^FileRenamer:\s*(.+)$/m);
  if (!match) return [];
  return match[1].split(",").map(s => s.trim()).filter(Boolean);
}

function extractBaseTitleFromExtra(extra: string): string | null {
  const match = extra.match(/^FileRenamerBase:(.*)$/m);
  if (!match) {
    return null;
  }
  return match[1].trimStart();
}

function splitManagedExtra(extra: string): {
  otherLines: string[];
  baseTitle: string | null;
} {
  const otherLines: string[] = [];
  let baseTitle: string | null = null;

  for (const line of extra.split("\n")) {
    if (line.startsWith(LABEL_LINE_PREFIX)) {
      continue;
    }
    if (line.startsWith(BASE_TITLE_LINE_PREFIX)) {
      baseTitle = line.slice(BASE_TITLE_LINE_PREFIX.length).trimStart();
      continue;
    }
    if (line.trim()) {
      otherLines.push(line);
    }
  }

  return { otherLines, baseTitle };
}

function buildManagedExtra(
  otherLines: string[],
  labels: string[],
  baseTitle: string | null,
): string {
  const lines = [...otherLines];
  const finalLabels = normalizeLabels(labels);

  if (finalLabels.length > 0) {
    lines.push(`${LABEL_LINE_PREFIX} ${finalLabels.join(", ")}`);
  }
  if (baseTitle !== null) {
    lines.push(baseTitle ? `${BASE_TITLE_LINE_PREFIX} ${baseTitle}` : BASE_TITLE_LINE_PREFIX);
  }

  return lines.join("\n").trim();
}

function setStoredBaseTitleOnItem(item: Zotero.Item, baseTitle: string): void {
  const extra = (item.getField("extra") as string) || "";
  const labels = extractLabelsFromExtra(extra);
  const managedExtra = splitManagedExtra(extra);
  item.setField(
    "extra",
    buildManagedExtra(managedExtra.otherLines, labels, baseTitle),
  );
}

async function ensureStoredBaseTitle(
  item: Zotero.Item,
  _options: ManagedTitleOptions = {},
): Promise<void> {
  const extra = (item.getField("extra") as string) || "";
  if (extractBaseTitleFromExtra(extra) !== null) {
    return;
  }

  const currentTitle = stripLabel((item.getField("title") as string) || "");
  setStoredBaseTitleOnItem(item, currentTitle);
}

function syncStoredBaseTitleFromCurrentTitle(item: Zotero.Item): void {
  const currentTitle = stripAnyLeadingBracketPrefix((item.getField("title") as string) || "");
  setStoredBaseTitleOnItem(item, currentTitle);
}

export function normalizeLabels(labels: string[]): string[] {
  const cleaned: string[] = [];
  const seen = new Set<string>();

  for (const rawLabel of labels) {
    const label = rawLabel.trim();
    if (!label || isTruncationLabel(label) || !isSupportedLabelDepth(label)) {
      continue;
    }
    if (seen.has(label)) continue;
    seen.add(label);
    cleaned.push(label);
  }

  const bases = cleaned.filter(isBaseLabel);
  const derived = cleaned.filter(isDerivedLabel);
  return [...bases, ...sortLabels(derived)];
}

function formatLabelsForDisplay(labels: string[]): string[] {
  const finalLabels = normalizeLabels(labels);
  const maxShown = Settings.maxLabelsShown;

  if (finalLabels.length <= maxShown) {
    return finalLabels;
  }

  return [
    ...finalLabels.slice(0, maxShown),
    `+${finalLabels.length - maxShown}`,
  ];
}

function buildLabelPrefix(labels: string[]): string {
  const visibleLabels = formatLabelsForDisplay(labels);
  if (visibleLabels.length === 0) return "";
  return visibleLabels.map(label => `[${label}]`).join("") + " ";
}

export function generateBasicLabel(index: number, prefix?: string): string {
  const p = prefix ?? Settings.basicLabelPrefix;
  return `${p}${index + 1}`;
}

export function getBasicIndexForPrefix(label: string, prefix: string): number | null {
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = label.match(new RegExp(`^${escapedPrefix}(\\d+)$`));
  if (!match) return null;
  return parseInt(match[1], 10);
}

export function hasBasicLabel(labels: string[]): boolean {
  return normalizeLabels(labels).some(isBaseLabel);
}

export function hasDerivedLabel(labels: string[]): boolean {
  return normalizeLabels(labels).some(isDerivedLabel);
}

export function getItemsInCurrentView(): Zotero.Item[] {
  try {
    const items = ZoteroPane.getSortedItems();
    if (Array.isArray(items) && items.length > 0) {
      return items.filter(item => item?.isRegularItem?.());
    }
  } catch (err) {
    Zotero.logError(`[FileRenamer] getItemsInCurrentView scan error: ${err}`);
  }

  return [];
}

async function getCurrentScopeItems(): Promise<Zotero.Item[]> {
  const itemsInView = getItemsInCurrentView();
  if (itemsInView.length > 0) {
    Zotero.debug(`[FileRenamer] getCurrentScopeItems: using ${itemsInView.length} item(s) from current view`);
    return itemsInView;
  }

  let itemsToScan: Zotero.Item[] = [];

  try {
    const activeCollection = ZoteroPane.getSelectedCollection();
    Zotero.debug(`[FileRenamer] getCurrentScopeItems: activeCollection = ${activeCollection}`);

    if (activeCollection) {
      const children = activeCollection.getChildItems(false);
      if (Array.isArray(children) && children.length > 0) {
        if (typeof children[0] === "number") {
          itemsToScan = Zotero.Items.get(children as number[]);
        } else {
          itemsToScan = children as Zotero.Item[];
        }
      }
    } else {
      const libraryID = ZoteroPane.getSelectedLibraryID();
      Zotero.debug(`[FileRenamer] getCurrentScopeItems: no collection, using libraryID = ${libraryID}`);
      itemsToScan = await Zotero.Items.getAll(libraryID);
    }
  } catch (err) {
    Zotero.logError(`[FileRenamer] getCurrentScopeItems scan error: ${err}`);
  }

  return itemsToScan.filter(item => item?.isRegularItem?.());
}

export function getLabelsFromItem(item: Zotero.Item): string[] {
  const extra = (item.getField("extra") as string) || "";
  const extraLabels = extractLabelsFromExtra(extra);
  if (extraLabels.length > 0) {
    return normalizeLabels(extraLabels);
  }

  const title = (item.getField("title") as string) || "";
  return normalizeLabels(extractLabelsFromTitle(title));
}

export function shouldUpdateItemLabels(item: Zotero.Item): boolean {
  if (!item?.isRegularItem()) {
    return false;
  }

  const title = (item.getField("title") as string) || "";
  const extra = (item.getField("extra") as string) || "";
  const mode = getLabelUpdateMode(title, extra);
  return mode === "managed" || mode === "manual-basic";
}

export function filterItemsEligibleForLabelUpdate(items: Zotero.Item[]): Zotero.Item[] {
  return items.filter(item => shouldUpdateItemLabels(item));
}

export function setLabelsOnItem(item: Zotero.Item, labels: string[]): void {
  const title = (item.getField("title") as string) || "";
  let extra = (item.getField("extra") as string) || "";
  const managedExtra = splitManagedExtra(extra);
  const baseTitle = managedExtra.baseTitle ?? stripLabel(title);

  const finalLabels = normalizeLabels(labels);
  item.setField(
    "title",
    finalLabels.length > 0
      ? `${buildLabelPrefix(finalLabels)}${baseTitle}`.trim()
      : baseTitle,
  );

  item.setField(
    "extra",
    buildManagedExtra(managedExtra.otherLines, finalLabels, managedExtra.baseTitle),
  );
}

async function updateItemWithManagedLabels(
  item: Zotero.Item,
  labels: string[],
  options: ManagedTitleOptions = {},
): Promise<boolean> {
  const originalTitle = (item.getField("title") as string) || "";
  const originalExtra = (item.getField("extra") as string) || "";

  if (options.syncBaseFromCurrentTitle) {
    syncStoredBaseTitleFromCurrentTitle(item);
  } else {
    await ensureStoredBaseTitle(item, options);
  }

  setLabelsOnItem(item, labels);

  const nextTitle = (item.getField("title") as string) || "";
  const nextExtra = (item.getField("extra") as string) || "";
  return nextTitle !== originalTitle || nextExtra !== originalExtra;
}

export async function reconcileLabelsOnItems(
  items: Zotero.Item[],
  options: ManagedTitleOptions & { allowTitleManagedMigration?: boolean } = {},
): Promise<number> {
  let normalizedCount = 0;

  for (const item of items) {
    if (!item.isRegularItem()) continue;

    const originalTitle = (item.getField("title") as string) || "";
    const originalExtra = (item.getField("extra") as string) || "";
    const titleLabels = normalizeLabels(extractLabelsFromTitle(originalTitle));
    const extraLabels = normalizeLabels(extractLabelsFromExtra(originalExtra));
    const storedBaseTitle = extractBaseTitleFromExtra(originalExtra);

    if (
      extraLabels.length === 0 &&
      titleLabels.length === 0 &&
      storedBaseTitle === null &&
      stripLabel(originalTitle) === originalTitle
    ) {
      continue;
    }

    let sourceLabels: string[] = [];
    if (extraLabels.length > 0) {
      sourceLabels = extraLabels;
    } else if (storedBaseTitle !== null) {
      sourceLabels = titleLabels;
    } else if (options.allowTitleManagedMigration && titleLabels.length > 0) {
      sourceLabels = titleLabels;
    } else {
      sourceLabels = extractManualBasicLabelsFromTitle(originalTitle);
    }

    if (sourceLabels.length === 0) {
      continue;
    }

    if (!(await updateItemWithManagedLabels(item, sourceLabels, options))) {
      continue;
    }

    await saveItemWithInternalGuard(item);
    normalizedCount++;
  }

  return normalizedCount;
}

export async function ensureLabelConsistencyBeforeActivation(): Promise<void> {
  let normalizedCount = 0;

  for (const library of Zotero.Libraries.getAll()) {
    const items = await Zotero.Items.getAll(library.libraryID);
    normalizedCount += await reconcileLabelsOnItems(items, {
      allowTitleManagedMigration: true,
    });
  }

  Zotero.debug(
    `[${ADDON_NAME}] Startup label consistency check normalized ${normalizedCount} item(s)`,
  );
}

export async function getBasicItems(): Promise<{
  items: Zotero.Item[];
  recidToLabel: Map<string, string>;
  errors: string[];
}> {
  const itemsToScan = await getCurrentScopeItems();

  Zotero.debug(`[FileRenamer] getBasicItems: total items to scan = ${itemsToScan.length}`);

  const basicItems: Zotero.Item[] = [];
  const recidToLabel = new Map<string, string>();
  const errors: string[] = [];

  for (const item of itemsToScan) {
    if (!item.isRegularItem()) continue;
    const title = item.getField("title") as string;
    const labels = getLabelsFromItem(item);
    if (labels.length === 0) continue;

    const bases = labels.filter(isBaseLabel);
    if (bases.length > 1) {
      errors.push(`File "${title.substring(0, 30)}..." has multiple basic labels (${bases.join(", ")}). Ignored.`);
      continue;
    }

    if (bases.length === 1) {
      const label = bases[0];
      const recid = deriveRecidFromItem(item);
      Zotero.debug(`[FileRenamer] Found base [${label}] in "${title.substring(0, 40)}" -> recid=${recid}`);
      if (recid) {
        basicItems.push(item);
        recidToLabel.set(recid, label);
      } else {
        errors.push(`Basic file "${title.substring(0, 30)}..." ([${label}]) has no INSPIRE recid.`);
      }
    }
  }

  Zotero.debug(`[FileRenamer] getBasicItems: found ${basicItems.length} basic items, ${errors.length} errors`);
  return { items: basicItems, recidToLabel, errors };
}

async function getNextBasicIndex(prefix: string): Promise<number> {
  const items = await getCurrentScopeItems();
  let maxIndex = 0;

  for (const item of items) {
    if (!item.isRegularItem()) continue;
    const baseLabel = getSingleBaseLabel(getLabelsFromItem(item));
    if (!baseLabel) continue;

    const num = getBasicIndexForPrefix(baseLabel, prefix);
    if (num !== null && num > maxIndex) {
      maxIndex = num;
    }
  }

  return maxIndex;
}

function getSingleBaseLabel(labels: string[]): string | null {
  const bases = normalizeLabels(labels).filter(isBaseLabel);
  return bases.length === 1 ? bases[0] : null;
}

function getNumericSuffix(label: string): number | null {
  const match = label.match(/(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

export async function rewriteBasicLabelsToCurrentPrefix(): Promise<void> {
  const prefix = Settings.basicLabelPrefix;
  const scopeItems = await getCurrentScopeItems();

  const baseItems = scopeItems.filter(
    item => item.isRegularItem() && hasBasicLabel(getLabelsFromItem(item)),
  );

  if (baseItems.length === 0) {
    showCornerNotification(
      ADDON_NAME,
      "No basic references found to rewrite.",
      "warning",
    );
    return;
  }

  const warnings: string[] = [];
  const sortedBaseItems = [...baseItems].sort((a, b) => {
    const labelA = getSingleBaseLabel(getLabelsFromItem(a)) ?? "";
    const labelB = getSingleBaseLabel(getLabelsFromItem(b)) ?? "";
    const numA = getNumericSuffix(labelA);
    const numB = getNumericSuffix(labelB);

    if (numA !== null && numB !== null && numA !== numB) {
      return numA - numB;
    }
    if (numA !== null && numB === null) return -1;
    if (numA === null && numB !== null) return 1;

    const titleA = stripLabel(a.getField("title") as string);
    const titleB = stripLabel(b.getField("title") as string);
    const titleCmp = titleA.localeCompare(titleB);
    if (titleCmp !== 0) return titleCmp;

    return labelA.localeCompare(labelB);
  });

  let renamedCount = 0;
  let nextIndex = 0;
  for (const item of sortedBaseItems) {
    const currentLabels = getLabelsFromItem(item);
    const currentBase = getSingleBaseLabel(currentLabels);
    if (!currentBase) {
      warnings.push(`"${stripLabel(item.getField("title") as string)}" has multiple basic labels and was skipped.`);
      continue;
    }

    const derived = currentLabels.filter(isDerivedLabel);
    const nextBase = generateBasicLabel(nextIndex, prefix);
    nextIndex++;

    if (currentBase === nextBase) continue;

    if (!(await updateItemWithManagedLabels(item, [nextBase, ...derived]))) {
      continue;
    }

    await saveItemWithInternalGuard(item);
    renamedCount++;
  }

  await numberFromBasics(scopeItems);

  showCornerNotification(
    ADDON_NAME,
    [
      `Rewrote ${renamedCount} basic label(s) to the current prefix scheme.`,
      ...warnings.slice(0, 5),
    ],
    warnings.length > 0 ? "warning" : "success",
  );
}

export async function markAsBasic(items: Zotero.Item[]): Promise<void> {
  const prefix = Settings.basicLabelPrefix;
  let nextIndex = await getNextBasicIndex(prefix);

  for (const item of items) {
    if (!item.isRegularItem()) continue;

    const currentTitle = item.getField("title") as string;
    const labels = getLabelsFromItem(item);

    if (hasBasicLabel(labels)) {
      Zotero.debug(`[${ADDON_NAME}] Item "${currentTitle}" already marked basic.`);
      continue;
    }

    const label = generateBasicLabel(nextIndex, prefix);
    nextIndex++;

    labels.push(label);
    if (!(await updateItemWithManagedLabels(item, labels))) {
      continue;
    }

    await saveItemWithInternalGuard(item);

    Zotero.debug(`[${ADDON_NAME}] Marked "${stripLabel(currentTitle)}" as [${label}]`);
  }
}

export async function numberFromBasics(
  items: Zotero.Item[],
  options: NumberFromBasicsOptions = {},
): Promise<void> {
  const silent = options.silent ?? false;
  const allowUnlabeledLookup = options.createBasicForUnlabeled ?? false;
  const { recidToLabel, errors: baseErrors } = await getBasicItems();

  const skipReasons: string[] = [...baseErrors];

  if (recidToLabel.size === 0) {
    if (!silent) {
      showCornerNotification(
        ADDON_NAME,
        allowUnlabeledLookup
          ? [
              "No basic references found in the current view.",
              "Update Labels only derives labels from existing basic items.",
              "Use Mark as Basic if you want to create a new basic label.",
              ...baseErrors.slice(0, 5),
            ]
          : [
              "No basic references found in the current view.",
              "Basic items need a label such as [1] or [N1].",
              "Each basic item also needs an INSPIRE recid.",
              ...baseErrors.slice(0, 5),
            ],
        "warning",
        6500,
      );
    }
    return;
  }

  const sourcesMap = new Map<string, string>(recidToLabel);
  const baseDataMap = new Map<
    string,
    {
      references: Map<string, number>;
      citations: Map<string, number>;
    }
  >();

  Zotero.debug(`[${ADDON_NAME}] Extracting data for ${sourcesMap.size} root structures...`);
  for (const [recid, label] of sourcesMap.entries()) {
    let data = getLocalCachedRelations(recid);
    if (data) {
      Zotero.debug(`[${ADDON_NAME}] Using FileRenamer local relation cache for recid ${recid}`);
    } else {
      data = await fetchBaseItemData(recid);
      setLocalCachedRelations(recid, data);
    }
    setLocalCachedLabels(recid, [label]);
    baseDataMap.set(label, data);
  }

  let processedCount = 0;
  let skippedCount = 0;

  for (const item of items) {
    if (!item.isRegularItem()) continue;

    const title = item.getField("title") as string;
    const shortTitle = title.length > 30 ? title.substring(0, 30) + "..." : title;
    const extra = (item.getField("extra") as string) || "";
    const mode = getLabelUpdateMode(title, extra);

    if (mode === "unlabeled" && !allowUnlabeledLookup) {
      continue;
    }

    if (mode === "invalid-prefix") {
      skipReasons.push(`"${shortTitle}" has a hand-written label that was left unchanged.`);
      skippedCount++;
      continue;
    }

    let labels = getLabelsFromItem(item);
    const bases = labels.filter(isBaseLabel);
    if (bases.length > 1) {
      skipReasons.push(`"${shortTitle}" has multiple base tags, skipping.`);
      skippedCount++;
      continue;
    }

    const recid = deriveRecidFromItem(item);
    if (!recid) {
      skipReasons.push(`"${shortTitle}" has no INSPIRE recid.`);
      skippedCount++;
      continue;
    }

    try {
      const derivedLabels: string[] = [];

      for (const [baseLabel, baseData] of baseDataMap.entries()) {
        if (bases.includes(baseLabel)) continue;

        if (baseData.references.has(recid)) {
          derivedLabels.push(`${baseLabel}-${baseData.references.get(recid)}`);
        }

        if (baseData.citations.has(recid)) {
          derivedLabels.push(`${baseLabel}-C${baseData.citations.get(recid)}`);
        }
      }

      if (derivedLabels.length === 0) {
        if (mode === "unlabeled") {
          skipReasons.push(
            `"${shortTitle}" was not found in FileRenamer cache, INSPIRE cache, or live INSPIRE lookup. No label was created.`,
          );
          skippedCount++;
          continue;
        }

        if (
          bases.length === 1 &&
          (await updateItemWithManagedLabels(item, bases, {
            preferCurrentTitle: options.preferCurrentTitle,
          }))
        ) {
          await saveItemWithInternalGuard(item);
          setLocalCachedLabels(recid, bases);
          processedCount++;
        }
        skipReasons.push(`"${shortTitle}" is not cited by, and does not cite, any basic papers.`);
        skippedCount++;
        continue;
      }

      labels = [...bases, ...derivedLabels];
      if (
        await updateItemWithManagedLabels(item, labels, {
          preferCurrentTitle: options.preferCurrentTitle,
        })
      ) {
        await saveItemWithInternalGuard(item);
        setLocalCachedLabels(recid, labels);
        if (mode === "unlabeled") {
          const ownData = await fetchBaseItemData(recid);
          setLocalCachedRelations(recid, ownData);
        }
        processedCount++;
      }

      Zotero.debug(`[${ADDON_NAME}] Labeled "${shortTitle}"`);
    } catch (err) {
      skipReasons.push(`"${shortTitle}": Error - ${err}`);
      skippedCount++;
    }
  }

  const win = Zotero.getMainWindow();
  if (!silent && win) {
    const lines = [
      `${processedCount} item(s) labeled`,
      `${skippedCount} item(s) skipped`,
      ...skipReasons.slice(0, 6),
    ].filter(Boolean) as string[];
    if (skipReasons.length > 6) {
      lines.push(`...and ${skipReasons.length - 6} more`);
    }
    showCornerNotification(
      ADDON_NAME,
      lines,
      skippedCount > 0 ? "warning" : "success",
    );
  }
}

export async function clearLabels(items: Zotero.Item[]): Promise<void> {
  let clearedCount = 0;

  for (const item of items) {
    if (!item.isRegularItem()) continue;

    const currentTitle = item.getField("title") as string;
    const strippedTitle = stripLabel(currentTitle);

    let hasChanges = false;
    if (strippedTitle !== currentTitle) {
      item.setField("title", strippedTitle);
      hasChanges = true;
    }

    const extra = (item.getField("extra") as string) || "";
    const managedExtra = splitManagedExtra(extra);
    if (extra && extra.includes(LABEL_LINE_PREFIX)) {
      const newExtra = buildManagedExtra(managedExtra.otherLines, [], managedExtra.baseTitle);
      item.setField("extra", newExtra);
      hasChanges = true;
    }

    if (hasChanges) {
      await saveItemWithInternalGuard(item);
      clearedCount++;
    }
  }

  Zotero.debug(`[${ADDON_NAME}] Cleared labels from ${clearedCount} item(s)`);
}

export async function autoCorrectLabels(_items: Zotero.Item[]): Promise<void> {
  const { items: baseItems, errors } = await getBasicItems();
  if (baseItems.length === 0) {
    showCornerNotification(
      ADDON_NAME,
      "No basic references found to auto-correct.",
      "warning",
    );
    return;
  }

  const usedNumbers = new Set<number>();
  for (const item of baseItems) {
    const labels = getLabelsFromItem(item);
    const bases = labels.filter(isBaseLabel);
    for (const b of bases) {
      const m = b.match(/^(\d+)$/);
      if (m) usedNumbers.add(parseInt(m[1], 10));
    }
  }

  baseItems.sort((a, b) => {
    const sa = stripLabel(a.getField("title") as string);
    const sb = stripLabel(b.getField("title") as string);
    return sa.localeCompare(sb);
  });

  let nextNum = 1;
  for (const item of baseItems) {
    const labels = getLabelsFromItem(item);
    const bases = labels.filter(isBaseLabel);

    if (bases.length === 1 && /^\d+$/.test(bases[0])) {
      continue;
    }

    while (usedNumbers.has(nextNum)) nextNum++;
    usedNumbers.add(nextNum);

    const derived = labels.filter(isDerivedLabel);
    if (await updateItemWithManagedLabels(item, [`${nextNum}`, ...derived])) {
      await saveItemWithInternalGuard(item);
    }
    nextNum++;
  }

  const collectionItems = await getCurrentScopeItems();
  await numberFromBasics(collectionItems);

  if (errors.length > 0) {
    showCornerNotification(
      ADDON_NAME,
      ["Auto-correct warnings", ...errors.slice(0, 5)],
      "warning",
    );
  }
}

export async function removeLabelsFromFile(): Promise<void> {
  const win = Zotero.getMainWindow();
  if (!win) return;

  const fp = Components.classes["@mozilla.org/filepicker;1"].createInstance(
    Components.interfaces.nsIFilePicker,
  );
  fp.init(win, "Select a text or bib file", Components.interfaces.nsIFilePicker.modeOpen);
  fp.appendFilter("Text and Bib file", "*.txt;*.bib");
  fp.appendFilter("All Files", "*.*");

  fp.open((result: number) => {
    if (result !== Components.interfaces.nsIFilePicker.returnOK || !fp.file) return;

    try {
      const file = fp.file;
      const path = file.path;
      const decoder = new TextDecoder("utf-8");
      const data = Zotero.File.getContents(file);
      if (typeof data !== "string" && !data) {
        showCornerNotification(ADDON_NAME, "Failed to read file.", "error");
        return;
      }
      const rawText = typeof data === "string" ? data : decoder.decode(data);

      const STRIP_REGEX = /\[[^\]\s]+\]\s*/g;
      const newText = rawText.replace(STRIP_REGEX, "");

      const extIndex = path.lastIndexOf(".");
      let newPath = "";
      if (extIndex !== -1) {
        newPath = path.substring(0, extIndex) + "_C" + path.substring(extIndex);
      } else {
        newPath = path + "_C";
      }

      Zotero.File.putContents(Zotero.File.pathToFile(newPath), newText);
      showCornerNotification(
        ADDON_NAME,
        ["Labels stripped successfully.", newPath],
        "success",
      );
    } catch (err) {
      Zotero.logError(err as Error);
      showCornerNotification(
        ADDON_NAME,
        `Error processing file: ${String(err)}`,
        "error",
      );
    }
  });
}
