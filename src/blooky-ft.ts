// blooky-ft.ts
import { DripEffect, PropEffect } from "./blooky-types";
import { accum, clock, collapse, drip, getPropId, isChainedProp, Prop, stream } from "./blooky-fp";
import { registerTickHandler } from "./blooky-fp";

// --- 型定義 ---
type StateSnapshot = {
  id: string
  [key:symbol]: PropEffect<any>
};

// --- モジュール内部状態 ---

const ALL_SNAPSHOTS = new Map<string, StateSnapshot>();
const BRANCHES = new Map<object, Record<string, string>>(); // context -> { branchName: snapshotId }
const HEAD = new Map<object, string>(); // context -> branchName

type Worldline = Record<string,string>;
const WORLDLINES = new Map<object, Worldline>();

const snapshotStream = stream<StateSnapshot>();
const $ALL_SNAPSHOT_ITEMS = accum((items: { [key:string]: StateSnapshot }, snapshot: StateSnapshot) => {
  items[snapshot.id] = snapshot;
  return items;
}, {})(snapshotStream);

// --- API ---

/**
 * 指定されたコンテキストの追跡を開始し、初期化する。
 * @param ctx 追跡したいコンテキスト
 */
function _init(ctx: object): void {
  if (BRANCHES.has(ctx)) return;
  // 関数の冒頭で、コンテキストが凍結されたものか検証する
  if (!Object.isFrozen(ctx)) {
    throw new TypeError(
      "The context passed to ft.snapshot() must be frozen. " +
      "Please ensure it was created with fc.build() or Object.freeze()"
    );
  }
  const id = `snap_root_${Math.random().toString(36).slice(2)}`;
  const rootSnapshot = {
    id,
    trigger: {
      created: clock(),
      dripper: snapshotStream,
    },
  } as StateSnapshot;
  getContextProps(ctx).forEach((p)=>rootSnapshot[getPropId(p)]=[p,p()]);
  ALL_SNAPSHOTS.set(rootSnapshot.id, rootSnapshot);
  BRANCHES.set(ctx, { "main": rootSnapshot.id });
  HEAD.set(ctx, "main");
  collapse(drip(rootSnapshot)(snapshotStream));
}

/**
 * 指定されたコンテキストの現在の状態をスナップショットとして記録する。
 * @param ctx 記録したいコンテキスト
 */
export function snapshot(ctx: object): Promise<StateSnapshot> {
  if(!BRANCHES.has(ctx)) _init(ctx);
  return new Promise((resolve) => {
    const unregister = registerTickHandler((allDripEffects) => {
      const props = getContextProps(ctx);
      const relevantEffects = allDripEffects.flatMap(effects => effects.filter(([p]) => props.has(p)));

      // 変更がなければ、スナップショットは作らない
      if (relevantEffects.length === 0) {
        unregister();
        resolve(ALL_SNAPSHOTS.get(BRANCHES.get(ctx)![HEAD.get(ctx)!])!);
        return;
      }
      
      const headBranchName = HEAD.get(ctx)!;
      const parentSnapshotId = BRANCHES.get(ctx)![headBranchName];
      
      const newSnapshot: StateSnapshot = Object.create(ALL_SNAPSHOTS.get(parentSnapshotId)!, {
        id: { value: `snap_${Math.random().toString(36).slice(2)}` },
      });
      relevantEffects.forEach(([p,v])=>newSnapshot[getPropId(p)]=v);
      
      ALL_SNAPSHOTS.set(newSnapshot.id, newSnapshot);
      BRANCHES.get(ctx)![headBranchName] = newSnapshot.id;

      unregister();
      resolve(newSnapshot);
    });
  });
}

/**
 * 新しいブランチを作成する。
 * @param ctx 対象のコンテキスト
 * @param branchName 新しいブランチの名前
 */
export function branch(ctx: object, branchName: string): void {
  const branches = BRANCHES.get(ctx);
  if (!branches || branchName in branches) {
    throw new Error(`Branch "${branchName}" already exists or context is not initialized.`);
  }
  const currentSnapshotId = branches[HEAD.get(ctx)!];
  branches[branchName] = currentSnapshotId;
}

/**
 * 指定されたブランチ、またはスナップショットIDに状態を復元（チェックアウト）する。
 * @param ctx 対象のコンテキスト
 * @param targetBranchOrId チェックアウト先のブランチ名、またはスナップショットID
 */
export function checkout(ctx: object, targetBranchOrId: string): void {
  const branches = BRANCHES.get(ctx)!;
  if (!branches) throw new Error("Context is not initialized.");

  const targetSnapshotId = branches[targetBranchOrId] || targetBranchOrId;
  const targetSnapshot = ALL_SNAPSHOTS.get(targetSnapshotId);
  if (!targetSnapshot) throw new Error(`Target "${targetBranchOrId}" not found.`);

  const effectsToApply: DripEffect = 
    [...getContextProps(ctx)].flatMap((prop) => {
      const propId = getPropId(prop);
      if (!(propId in targetSnapshot)) {
        throw new Error(
          `Checkout failed: The current context has a Prop ` +
          `that did not exist in the target snapshot ("${targetBranchOrId}"). ` +
          `The context's shape must remain consistent.`
        );
      }
      const effect = targetSnapshot[propId];
      // 目的の値と現在の値が違う場合のみ、Effectを生成
      return prop() === effect[1] ? [] : [effect];
    });  

  if(effectsToApply.length) {
    collapse(effectsToApply).then(()=>{
      HEAD.set(ctx, branches[targetBranchOrId] ? targetBranchOrId : 'detached');
    });
  } else {
    HEAD.set(ctx, branches[targetBranchOrId] ? targetBranchOrId : 'detached');
  }
}

const getContextProps = (context: object) => {
  const props = new Set<Prop<any>>();
  if(typeof context[Symbol.iterator] === "function") {
    for(let value of (context as { [Symbol.iterator]: ()=>any })) {
      if(isChainedProp(value))
        props.add(value);
    }
  } else {
    for(let key in context) {
      const value = context[key];
      if(isChainedProp(value))
        props.add(value);
    }
  }
  return props;
}
