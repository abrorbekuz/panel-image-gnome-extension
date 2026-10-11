// transition-choices.js
//
// Data only (no gi:// imports) so both prefs.js (runs in the GTK process,
// where Clutter/St don't exist) and transitions.js (runs inside the shell)
// can import it. The ids must match the <choices> of the "transition-effect"
// key in the schema and the keys of TRANSITIONS in transitions.js.

export const TRANSITION_CHOICES = [
  ["none", "None (instant)"],
  ["crossfade", "Crossfade"],
  ["chessboard", "Chessboard"],
  ["snap", "Thanos snap"],
  ["blinds", "Blinds"],
];

export const DEFAULT_TRANSITION = "crossfade";
