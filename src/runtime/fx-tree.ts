// src/runtime/fx-tree.ts
//
// FxNote tree utilities — pure Score-structure operations.
// This module knows nothing about execution, scheduling, or Clock;
// it only knows the shape of FxNote itself. Both runtime/engine.ts
// and blooky-fx.ts import from here (one-directionally) to avoid
// a circular dependency between them.

import type { FxNote } from "../blooky-fx-types";

/**
 * Flattens an FxNote tree into a depth-first list of every note it contains,
 * including the root. Pure structural traversal — no execution semantics.
 */
export function flattenFxNotes(note: FxNote): FxNote[] {
  switch (note.type) {
    case "sequence":
    case "parallel":
    case "race":
      return [note, ...note.steps.flatMap(flattenFxNotes)];

    case "loop":
      return [note, ...flattenFxNotes(note.body)];

    case "condition":
      return [
        note,
        ...flattenFxNotes(note.then),
        ...(note.else ? flattenFxNotes(note.else) : []),
      ];

    case "switch":
      return [
        note,
        ...[...note.cases.values()].flatMap(flattenFxNotes),
        ...(note.default ? flattenFxNotes(note.default) : []),
      ];

    case "flow":
      return [note, ...flattenFxNotes(note.child)];

    default:
      return [note];
  }
}

const NOTE_ID_SYMBOL = Symbol.for("blooky.note_id");
let autoNoteIdCounter = 0;

/**
 * Resolves a stable identifier for an FxNote: the explicit `id` if present,
 * otherwise a lazily-generated and memoized synthetic id. Memoization is
 * attached to the note object itself, so identity is stable across repeated
 * calls within the same note's lifetime.
 */
export function resolveNoteId(note: FxNote): string {
  if (note.id && note.id.length) return note.id;
  const existing = (note as any)[NOTE_ID_SYMBOL];
  if (typeof existing === "string" && existing.length) return existing;
  const generated = `note-${autoNoteIdCounter++}`;
  (note as any)[NOTE_ID_SYMBOL] = generated;
  return generated;
}
