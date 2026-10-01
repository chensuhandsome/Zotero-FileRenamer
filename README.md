# Zotero FileRenamer

Zotero FileRenamer adds structured labels to Zotero item titles based on INSPIRE-HEP reference and citation relationships.

Typical results look like:

- `[N1] A basic paper`
- `[N1-4] A paper referenced by N1`
- `[N1-C2] A paper that cites N1`
- `[N1][N2-C3] A paper related to more than one basic paper`

The visible label prefix is written into the Zotero title field, while the managed state is also stored in `Extra`.

## What It Does

- marks selected items as first-order or basic papers
- derives second-layer labels from INSPIRE references and citations
- keeps managed labels stable in `Extra`
- preserves the editable title body separately from the label prefix
- supports current-view updates from the right-click menu
- keeps a local FileRenamer relation cache and a separate INSPIRE cache
- supports offline reuse of cached INSPIRE relation data
- can color basic and derived items differently in the Zotero item list

## Requirements

- Zotero 7, 8, 9 or 10 (Zotero 10 is supported from v1.1.0)
- INSPIRE recids available on items you want to derive labels for

The plugin looks for an INSPIRE recid in this order:

1. `archiveLocation` when it is numeric
2. the Zotero `URL` field when it contains an INSPIRE literature or record URL
3. the `Extra` field when it contains an INSPIRE literature or record URL

## Installation

### Install From Release

1. Download the latest `.xpi` from GitHub Releases.
2. In Zotero, open `Tools -> Plugins`.
3. Click the gear icon and choose `Install Plugin From File...`.
4. Select the `.xpi`.
5. Restart Zotero if needed.

### Build Locally

```bash
npm install
npm run build
```

The packaged add-on is written to `build/`.

## Basic Workflow

1. Put related papers in the same collection, or work from a library-level view.
2. Make sure the papers can be matched to INSPIRE recids.
3. Select one or more root papers and run `FileRenamer -> Mark as Basic`.
4. Run `FileRenamer -> Update Labels` on selected items, or `FileRenamer -> Update All` on the current view.
5. Adjust settings in the Zotero `FileRenamer` preference pane if needed.

## Menu Actions

The plugin adds a `FileRenamer` submenu to the Zotero item right-click menu.

### Update Labels

Updates the selected regular items only.

Behavior:

- already managed items are refreshed in place
- items with one legal hand-written basic label are brought under management
- unlabeled items are only given a derived label if a relationship can be caught from the current basic set
- unlabeled items are not turned into new basic items by this action

For an unlabeled selected item, relationship lookup priority is:

1. FileRenamer local relation cache
2. INSPIRE cache
3. live INSPIRE lookup

If one of those paths finds a match, the item receives the corresponding derived label. If all three fail, the item stays unlabeled and the notification explains that no match was found.

### Mark as Basic

Assigns a new first-order or basic label to the selected items.

Examples:

- with prefix `N`: `N1`, `N2`, `N3`
- with empty prefix: `1`, `2`, `3`

Use this when you want to create a new root paper deliberately. `Update Labels` does not do this.

### Clear Labels

Removes FileRenamer labels from the selected items.

Effects:

- the visible title prefix is removed
- the managed `FileRenamer:` label line is removed from `Extra`
- the stored base title is kept so the title body remains clean if the item is managed again later

### Update All

Updates all eligible items in the current view.

Rules:

- only the visible current view is processed
- plain unlabeled items are ignored
- illegal hand-written prefixes are left unchanged
- only items that already have managed labels, or one legal hand-written basic label, are updated

## Label Model

### Basic Labels

Basic labels identify first-order papers.

Examples:

- `[N1]`
- `[A3]`
- `[1]`

Legal format:

```text
^(?:[A-Za-z]+)?\d+$
```

That means:

- only ASCII letters are allowed in the prefix
- the label must end with digits
- the prefix may be empty
- non-ASCII prefixes are not treated as legal basic labels

### Derived Labels

Derived labels describe relationships to the current basic set.

Examples:

- `[N1-4]` means the item is the 4th reference in `N1`
- `[N1-C2]` means the item is the 2nd citing paper of `N1`

Legal format:

```text
^(?:[A-Za-z]+)?\d+-(?:\d+|C\d+)$
```

Rules:

- references sort before citations at the same layer
- citations use `C`
- third-layer labels such as `[N1-2-3]` are discarded
- derived labels are not accepted as hand-written unmanaged labels

### Truncation Label

If an item has more labels than the display limit, the title shows a summary such as `[+3]`.

Example:

```text
[N1][N2-C1][+3] Some paper
```

`[+N]` is only a display summary. It is rebuilt from the managed metadata whenever the title is refreshed.

## Managed Data on an Item

The plugin separates the visible title from the editable title body.

Visible title:

```text
[labels] base title
```

Managed metadata in `Extra`:

```text
FileRenamer: N1, N2-C3
FileRenamerBase: Base title without labels
```

Meaning:

- `FileRenamer:` stores the managed labels
- `FileRenamerBase:` stores the title body without the label prefix

Once an item is managed:

- editing the title body updates `FileRenamerBase:`
- managed labels stay under plugin control
- later refreshes rebuild the visible title from the stored base title

## How Label Resolution Works

### Scope

The plugin always works from the current Zotero item view.

That means:

- collection views use the visible items in that collection
- library roots use the visible items in that library view
- saved searches and filtered views follow what is currently shown

### Basic Set Detection

Inside the current view, the plugin treats an item as part of the basic set only when it:

- is a regular Zotero item
- has exactly one basic label
- has an INSPIRE recid

Those items become the roots used for derived labeling.

### Derived Label Resolution

For each current basic item, relation data is resolved in this order:

1. FileRenamer local relation cache
2. INSPIRE cache
3. live INSPIRE lookup, if allowed

The relation data contains:

- references of the basic paper
- citations to the basic paper

An item receives:

- `Base-N` when its recid appears in the base paper's references
- `Base-CN` when its recid appears in the base paper's citations

An item may receive labels from more than one basic paper.

### Ordering

- references keep the order returned by INSPIRE
- citations use INSPIRE chronological order with `dateasc`
- within the same layer, non-citation labels sort before citation labels

## Cache Layers

The plugin uses three different storage layers. They are related, but they are not the same.

### 1. Item-Local FileRenamer State

Stored directly on the item:

- title prefix
- `FileRenamer:` line in `Extra`
- `FileRenamerBase:` line in `Extra`

This is the authoritative managed state for an already labeled item.

### 2. FileRenamer Local Relation Cache

Stored in Zotero preferences under the FileRenamer namespace.

Each entry is keyed by item recid and may contain:

- `labels`
- `references`
- `citations`
- `hasFetchedRelations`
- `timestamp`

This is FileRenamer's own local database. It is used before the plugin checks INSPIRE cache.

When a new item is labeled through relationship lookup, the plugin also updates this local relation cache for that recid.

### 3. INSPIRE Cache

Stored separately in Zotero preferences.

Each entry is keyed by basic-item recid and stores:

- `references`
- `citations`
- `timestamp`

Rules:

- normal cache lifetime is 7 days
- offline mode always uses cached data when available
- if refresh fails, stale cached data is kept instead of being replaced by empty relations
- if only one side refreshes successfully, the other side keeps its previous cached value

## Settings

The plugin registers a `FileRenamer` pane in Zotero settings.

### Auto-Update

- enable or disable the background updater
- choose the refresh interval in hours

The background updater:

- scans all libraries
- silently refreshes eligible labels
- reuses or refreshes INSPIRE cache data
- only processes already managed items, or items with one legal hand-written basic label
- does not create labels for plain unlabeled items

### Network

- `Offline Mode`: use cached INSPIRE data only

When offline mode is enabled, the plugin does not make network requests. Cached INSPIRE data is still used when available.

### Labeling

- `Max labels shown per item`
- `Basic label prefix`
- `Highlight basic titles`
- `First-order title color`
- `Highlight derived titles`
- `Derived title color`

Notes:

- leaving the basic prefix empty creates numeric labels such as `1`, `2`, `3`
- changing the basic prefix affects newly created basic labels
- existing labels are not mass-rewritten automatically

## Notifications

The plugin reports status through Zotero corner notifications.

Typical warnings include:

- no basic references found in the current view
- missing INSPIRE recids
- invalid hand-written prefixes left unchanged
- items with multiple basic labels skipped
- unlabeled selected items for which no FileRenamer cache, INSPIRE cache, or live INSPIRE match was found

## Limitations

- label generation depends on INSPIRE recids being available
- `Update Labels` uses the current view basic set, even when only a few items are selected
- only `Mark as Basic` creates a new basic label on demand
- only basic labels may be created by hand on an unlabeled item

## Changelog

### 1.1.0

- Zotero 10 support: the manifest now allows Zotero up to `10.0.*`, and Zotero 7-9 remain supported.
- Title highlighting works again with the Zotero 10 items list, which no longer has the render hook used in 1.0.0.
- When the current view has no items, the label scope falls back to every selected collection or library, so selecting several rows in the Zotero 10 collections pane no longer raises an error.

## Development

Useful commands:

```bash
npm run build
npm start
```

`npm test` is still available, but no bundled automated test files are currently shipped in this repository.

Source layout:

- `src/modules/labeler.ts`: label parsing, storage, and update logic
- `src/modules/menu.ts`: right-click menu actions
- `src/modules/inspireApi.ts`: INSPIRE fetch and cache handling
- `src/modules/settings.ts`: preference access
- `src/modules/titleStyler.ts`: title coloring
- `addon/content/preferences.xhtml`: preference pane UI
