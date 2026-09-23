import type { FxNote, NoteDefinition, Registry } from "../blooky-fx-types";
import {
  callNoteDefinition,
  conditionNoteDefinition,
  flowNoteDefinition,
  loopNoteDefinition,
  noneNoteDefinition,
  parallelNoteDefinition,
  raceNoteDefinition,
  returnNoteDefinition,
  sequenceNoteDefinition,
  switchNoteDefinition,
  waitNoteDefinition,
  yieldNoteDefinition,
} from "./note-definitions";

export const createRegistry = (): Registry => ({
  definitions: new Map(),
});

export const registerDefault = (reg: Registry) => {
  const definitions: Array<NoteDefinition<any, any>> = [
    noneNoteDefinition,
    returnNoteDefinition,
    callNoteDefinition,
    waitNoteDefinition,
    yieldNoteDefinition,
    sequenceNoteDefinition,
    parallelNoteDefinition,
    raceNoteDefinition,
    conditionNoteDefinition,
    switchNoteDefinition,
    loopNoteDefinition,
    flowNoteDefinition,
  ];

  for (const definition of definitions) {
    reg.definitions.set(definition.type as FxNote["type"], definition);
  }
};
