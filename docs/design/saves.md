# Local saves and save codes

[Design index](../../README.md)

## Local saves and copyable save codes

Keep persistence simple: a versioned JSON data object owned by the player. No signatures, encryption, or tamper protection are required. Editing a save is acceptable. Save only data, never live layers, UI trees, class instances, or client scripts.

The save contains inventory, room/location and x/y position, flags, and variables. Example schema (identifiers are illustrative):

```json
{
  "v": 1,
  "room": "observatory",
  "xy": [24, 12],
  "inv": ["brass_key", "map"],
  "flags": ["guard_distracted"],
  "vars": {"door_attempts": 2}
}
```

- Store only true flags; missing flags mean false.
- Inventory is a list of item-ID strings, including duplicates; removal consumes one occurrence.
- Omit variables equal to their defined defaults.
- Use stable room, item, flag, and variable identifiers.
- Preserve a readable named-field schema internally; avoid positional packing merely to save characters.
- Apply defaults and construct fresh game state when loading. Rebuild transient UI/focus/rendering state rather than saving it.

For copy/paste, serialize without whitespace, compress, and Base64url-encode the payload. Prefix the result with IT1. to identify the save-code format. The precise compression algorithm is still to be chosen and must be consistent across implementations. Save-code format version and JSON schema version are distinct versioning concerns.

```text
SaveState JSON → compact serialization → compression → Base64url
Save code: IT1.<encoded-data>
Load: decode → decompress → parse → validate/apply defaults → construct game state
```

Accept surrounding whitespace and line breaks in pasted codes. Local JSON files and copyable codes represent the same logical save state.

- Node testing client: write local save files and upload them to resume.
- Browser: local storage plus download/import for backup and moving devices; exact storage API remains open.
- SSH: display a copyable save code and accept a pasted code on load. Standard SSH cannot silently write a file onto the player's computer.
- Send committed snapshots at checkpoints so capable clients can persist them automatically. SSH players must copy a code to retain it outside the session.

## Committed checkpoints

Keep live state separate from the latest committed SaveState snapshot. Commit a snapshot on each room load after room construction and saved-state restoration, before room-entry scripts run. A game/script function can explicitly commit a new snapshot after a sequence or other chosen point. Copy durable data into the snapshot so later mutations do not alter it.

Players can request Save at any time; that exports/displays the latest committed snapshot, not partially completed live script state. Loading reconstructs the checkpoint room/state; uncommitted progress is intentionally excluded. Do not persist script stacks or transient action progress. The precise checkpoint API remains to be named.

This supersedes earlier proposals to capture live state whenever Save is requested or retain live server sessions for reconnect. Recovering from the latest local checkpoint is sufficient.

Perform basic input checks: encoded/decompressed size limits, valid format/schema versions, expected field types, known identifiers, finite numbers, and sensible value ranges. This is malformed-input handling, not tamper prevention. A local save is sufficient to resume; no account or server-side save lookup is necessary.
