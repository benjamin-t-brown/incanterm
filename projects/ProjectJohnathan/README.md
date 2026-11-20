# ProjectJohnathan

This is an Incanterm game project. `incanterm.json` defines its name, asset directory,
and entry scene (`classroom1`). Assets, scripts, story notes, and project runtime settings
belong here; the Incanterm engine and editor live outside the project.

Start the Incanterm editor and open this directory. The bundled checkout lists this
project automatically, but the folder can also be moved elsewhere and opened by path.
Use the editor's Game zone to play the project.

From the engine repository:

```sh
npm run editor
npm run loopback -- --project projects/ProjectJohnathan
npm run loopback -- --project projects/ProjectJohnathan --scene hallwayGym
npm run dev -- --project projects/ProjectJohnathan
```

For a relocated project, replace the path with its new location. To start at a different
scene temporarily, append `--scene <scene-id-or-label>` (quote labels containing spaces);
to change the default, edit `entryScene`
in `incanterm.json`.

`assets/session-config.json` contains project-owned dialogue and portrait animation settings.
Engine tests do not depend on this project's content.

## School envelope puzzle script shim

`assets/scripts/schoolPuzzle.rpgscript` implements the **School + School Hallway**
section of `story/PUZZLES.txt`. New dialogue and cutscene descriptions are deliberately
robotic placeholders. The existing classroom dismissal, Ralgo conversation, Otis
approach, and Ada/Skye locker introduction are preserved.

This is a **script-hooks-only** pass: no scenes, hotspots, characters, item assets,
or artwork were created. The complete sequence can be exercised with the terminal
RPGScript shim, but it is **not yet playable end-to-end in the Game zone**.
The office/Overseer/Dedrick story section is not part of this puzzle.

### Existing interactions connected

- Ralgo assigns the errand; the podium gives `OfficeEnvelope`.
- The first hallway Otis cutscene records `schoolPuzzle.otisIntroduced`.
  Otis is no longer removed on hallway re-entry once the missing pass is known.
- The office lift barrier remains locked until `schoolPuzzle.officeReset`.
  Its terminal now calls the office PA and eventually resets security.
- Ada/Skye's existing talk interaction handles the book return and Skye's drink
  request. Ada is removed on subsequent room loads after her book is returned.
- The gym energy machine exchanges `SpareChange` for `EnergyDrink`.
- The gym and office lift trash cans share the last-can-searched mechanic.
  Only distinct searches **after Skye requests the drink** count. Either search
  order works; repeat searches cannot generate more money.

### Bindings still needed

Names below are RPGScript script/trigger names, not new scene IDs.

| Scene / entity to finish | Binding |
| --- | --- |
| Maintenance post inspection hotspot | Action trigger `schoolPuzzle_inspectMaintenancePost` |
| Maintenance phone | Action trigger `schoolPuzzle_useMaintenancePhone` |
| Repair crew at the south elevator | Character talk script `southLifts_MaintenanceTalk` |
| Haddy near the repair crew | Character talk script `southLifts_HaddyTalk` |
| Returning Otis | Character talk script `hallway1_OtisTalk` |
| Vivi, available after Otis's introduction | Character talk script `hallway1_ViviTalk` |
| Library returned-books bin | Action trigger `schoolPuzzle_searchReturnedBooks` |
| Iroha in classroom 8 | Character talk script `schoolPuzzle_talkIroha` |
| Office worker, if directly talkable | Character talk script `officeLift_OfficeTalk` |
| Future office scene entry | Load trigger `schoolPuzzle_officeLoad` |

Character talk scripts are assigned in the scene inspector; action/load triggers
must also be added to the scene's trigger list. New speakers can display text
without portrait assets. The Otis/Vivi confrontation currently uses dialogue and
cutscene toasts rather than new movement/exit markers; stage the characters and
replace those toasts with walking/exit choreography when their scene is ready.
Use `schoolPuzzle.otisArgumentSeen` to omit Vivi after she storms off.
The current hallway Otis instance still needs its return-visit talk script assigned.

Create four item assets with these exact **Script Name** values (choose any
temporary visuals):

| Script Name | Display label |
| --- | --- |
| `OfficeEnvelope` | Office Envelope |
| `AdaBook` | Ada's Physics Textbook |
| `SpareChange` | Spare Change |
| `EnergyDrink` | Energy Drink |

There are currently no item assets in this project, including for the pre-existing
envelope script. In-game `acquireItem` requires them; the scene-free terminal shim
does not. Book/drink handoffs happen through talking, so item combination rules
are not required.

Once the office scene exists, configure its actual ID or label in a load script:

```rpgscript
+schoolPuzzle.officeScene="your_actual_office_scene_id"
+schoolPuzzle.officeEntryMarker="fromOfficeLift"
```

Create that entry marker in the destination scene and bind `schoolPuzzle_officeLoad`
there. The office lift door then changes scenes only after the reset. Until an
office destination is configured, it displays an explicit unconnected-scene
placeholder instead of trying to load a nonexistent room. The office arrival hook
sets `schoolPuzzle.reachedOffice` once and leaves the envelope in inventory for
the next story section.

### Expected walkthrough

1. Watch dismissal, talk to Ralgo, take the envelope, and leave classroom 1.
2. Watch Otis's hallway approach.
3. Inspect the blocked office lift and/or contact the PA at its terminal.
4. Inspect the maintenance post; call the office from its phone or the lift terminal.
5. Talk to the south elevator crew, then Haddy, then Otis.
6. Ask Vivi out. Report her refusal to Otis: the argument plays, Vivi storms off,
   and Otis apologizes and names Skye.
7. Talk to Ada/Skye, search the library returns bin, and return Ada's book.
8. Skye requests an energy drink. Search both trash cans; the second distinct can
   provides change. Buy the drink and bring it to Skye.
9. Talk to Iroha in classroom 8, then contact the PA again. The PA finds the pass
   in office lost and found and resets the system from their end.
10. Use the office lift and run the future office scene's arrival hook.

The pass is intentionally **not** an inventory item: the office worker recovers it.
The book can be resolved before the Otis lead, and Vivi can be asked out after the
introduction without first discovering the missing pass. Neither shortcut skips
the required pass clues, drink, classroom 8 report, or final reset.

### Scene-free walkthrough

Run from the repository root (Bash syntax; the multiline argument is one snippet):

```sh
npm run run-rpgscript -- --project projects/ProjectJohnathan '
+:classroom1Load()
+:classroom1_RalgoTalk()
+:classroom1_podium()
+:hallway1_OtisApproach()
+:officeLift_blueDoor()
+:officeLift_terminal1()
+:schoolPuzzle_inspectMaintenancePost()
+:schoolPuzzle_useMaintenancePhone()
+:southLifts_MaintenanceTalk()
+:southLifts_HaddyTalk()
+:hallway1_OtisTalk()
+:hallway1_ViviTalk()
+:hallway1_OtisTalk()
+:hallway3_SkyeAdaTalk()
+:schoolPuzzle_searchReturnedBooks()
+:hallway3_SkyeAdaTalk()
+:hallwayGym_trash()
+:officeLift_trash()
+:hallwayGym_vendEnergy()
+:hallway3_SkyeAdaTalk()
+:schoolPuzzle_talkIroha()
+:officeLift_terminal1()
+:officeLift_enterOffice()
+:schoolPuzzle_enterOffice()
+log("Reached office: {schoolPuzzle.reachedOffice}")
'
```

The last arrival call simulates the not-yet-built office's load trigger; the CLI
validates scene commands but does not move characters or load rooms.
All new progress is session-global under `schoolPuzzle.*`; inventory remains
`vars.inventory` and the existing classroom quest state remains `vars.hasEnvelopeQuest`.
If more trash cans are added, extend `schoolPuzzle_searchTrash`'s two-can tracking
before binding them, and give every can a unique stable ID.
