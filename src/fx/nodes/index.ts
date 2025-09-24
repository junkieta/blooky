// src/blooky-fx/nodes/index.ts
import type { FxNodeBase, FxNodeType, INodeDefinition } from '../types';
import {NoneNodeDefinition} from "./none";
import {SequenceNodeDefinition} from "./sequence";
import {ParallelNodeDefinition} from "./parallel";
import {RaceNodeDefinition} from "./race";
import {WaitNodeDefinition} from "./wait";
import {LoopNodeDefinition} from "./loop";
import {ConditionNodeDefinition} from "./condition";
import {SwitchNodeDefinition} from "./switch";
import {ContextNodeDefinition} from './context';
import {CallNodeDefinition} from "./call";
import {CollapseNodeDefinition} from "./collapse";
import {YieldNodeDefinition} from "./yield";
import {ReturnNodeDefinition} from "./return";

export const allNodeDefinitions = [
  new NoneNodeDefinition(),
  new SequenceNodeDefinition(),
  new ParallelNodeDefinition(),
  new RaceNodeDefinition(),
  new WaitNodeDefinition(),
  new LoopNodeDefinition(),
  new ConditionNodeDefinition(),
  new ContextNodeDefinition(),
  new SwitchNodeDefinition(),
  new CallNodeDefinition(),
  new CollapseNodeDefinition(),
  new YieldNodeDefinition(),
  new ReturnNodeDefinition()
].map(def => [def.type, def] as [FxNodeType, INodeDefinition<any>]); // Mapにしやすいように[key, value]のペアに変換

export const nodeDefinitionMap = new Map<FxNodeType, INodeDefinition<any>>(allNodeDefinitions);
export {
  NoneNodeDefinition,
  SequenceNodeDefinition,
  ParallelNodeDefinition,
  RaceNodeDefinition,
  WaitNodeDefinition,
  LoopNodeDefinition,
  ConditionNodeDefinition,
  SwitchNodeDefinition,
  ContextNodeDefinition,
  CallNodeDefinition,
  CollapseNodeDefinition,
  YieldNodeDefinition,
  ReturnNodeDefinition, 
}