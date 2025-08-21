// src/blooky-git.ts

import type { Prop } from './blooky-fp';
import { drip, clock } from './blooky-fp'; // ★ fpからclockをインポート
import type { StateSnapshot, Branch, DripTrigger, DripperEffect, DripResult } from './blooky-types'; // git用の型定義

// --- Module-Scoped State (Internal Implementation) ---

const snapshots = new Map<string, StateSnapshot>();
const branches = new Map<string, Branch>();
let HEAD: string = 'main';
const managedProps = new Map<Prop<any>, ((value: any, _?:any)=>void)>();

// --- Automatic Initialization ---

// ★ モジュールが読み込まれた瞬間に、歴史の創世記が自動的に記録される
const rootSnapshot: StateSnapshot = (() => {
  const initialState = new Map<Prop<any>, any>([[clock, clock()]]);
  const snapshot: StateSnapshot = {
    id: 'root-' + Math.random().toString(36).substring(2, 9),
    parent: null,
    trigger: { dripper: null as any, value: 'initial_state' },
    effects: [],
    fullState: initialState,
  };
  snapshots.set(snapshot.id, snapshot);
  branches.set('main', { name: 'main', commitId: snapshot.id });
  return snapshot;
})();


// --- Private Helper Methods ---

function findCommonAncestor(snapA: StateSnapshot, snapB: StateSnapshot): StateSnapshot | null {
  const historyA = getCommitHistory(snapA);
  const historyA_ids = new Set(historyA.map(s => s.id));
  
  for (const snap of getCommitHistory(snapB)) {
    if (historyA_ids.has(snap.id)) {
      return snap;
    }
  }
  return null;
}

function getCommitHistory(start: StateSnapshot, stopAtId?: string): StateSnapshot[] {
  const history: StateSnapshot[] = [];
  let current: StateSnapshot | undefined = start;
  while (current && current.id !== stopAtId) {
    history.push(current);
    if (current.parent === null) break;
    current = snapshots.get(current.parent);
  }
  return history;
}

// --- Public API (Exported Functions) ---

/**
 * 新しい状態をコミットする
 */
export function commit(dripResult: DripResult<any>): string {
  const { trigger, effects } = dripResult;

  // commitのたびに、未知のPropとそのupdate関数を「学習」する
  effects.forEach(({ prop, update }) => {
    if (!managedProps.has(prop)) {
      managedProps.set(prop, update);
    }
  });
  
  const parentId = branches.get(HEAD)!.commitId;
  const parentSnapshot = snapshots.get(parentId)!;

  const newFullState = new Map(parentSnapshot.fullState);
  effects.forEach(({ prop, nextValue }) => newFullState.set(prop, nextValue));

  const newSnapshot: StateSnapshot = {
    id: 'snap-' + Math.random().toString(36).substr(2, 9),
    parent: parentId,
    trigger: trigger,
    effects: effects,
    fullState: newFullState,
  };
  snapshots.set(newSnapshot.id, newSnapshot);
  branches.get(HEAD)!.commitId = newSnapshot.id;
  
  effects.forEach(({ update, nextValue, prevValue }) => update(nextValue, prevValue));
  return newSnapshot.id;
}

/**
 * HEADを指定したブランチに切り替え、アプリケーションの状態を復元する
 */
export function checkout(branchName: string): void {
  if (!branches.has(branchName)) throw new Error(`Branch "${branchName}" not found.`);

  const targetCommitId = branches.get(branchName)!.commitId;
  const targetSnapshot = snapshots.get(targetCommitId)!;

  managedProps.forEach((update, prop) => {
    const value = targetSnapshot.fullState.get(prop);
    update(value);
  });

  HEAD = branchName;
}

/**
 * 現在のHEADから新しいブランチを作成する
 */
export function branch(branchName: string): void {
  if (branches.has(branchName)) {
    throw new Error(`Branch "${branchName}" already exists.`);
  }
  const currentCommitId = branches.get(HEAD)!.commitId;
  branches.set(branchName, { name: branchName, commitId: currentCommitId });
}

/**
 * 指定したブランチの変更を、現在のHEADブランチにマージする
 */
export function merge(sourceBranchName: string): string | { conflicts: any[] } {
  // ... (実装は前回の提案と同じ)
  const targetSnapshot = snapshots.get(branches.get(HEAD)!.commitId)!;
  const sourceSnapshot = snapshots.get(branches.get(sourceBranchName)!.commitId)!;
  const ancestorSnapshot = findCommonAncestor(targetSnapshot, sourceSnapshot);
  if (!ancestorSnapshot) throw new Error("No common ancestor.");
  
  const conflicts: any[] = [];
  const finalEffects: DripperEffect = [];
  const allProps = new Set([...managedProps.keys()]);
  const created = clock();

  allProps.forEach(prop => {
      const ancestorValue = ancestorSnapshot.fullState.get(prop);
      const targetValue = targetSnapshot.fullState.get(prop);
      const sourceValue = sourceSnapshot.fullState.get(prop);

      const targetChanged = ancestorValue !== targetValue;
      const sourceChanged = ancestorValue !== sourceValue;

      if (!sourceChanged) return;
      if (sourceChanged && !targetChanged) {
        finalEffects.push({ created, prop, nextValue: sourceValue, prevValue: targetChanged, update: managedProps.get(prop)! });
      } else if (targetChanged && sourceChanged && targetValue !== sourceValue) {
        conflicts.push({ prop, targetValue, sourceValue });
      }
  });
  
  if (conflicts.length > 0) return { conflicts };

  const mergeTrigger = { dripper: null as any, value: `merge ${sourceBranchName} into ${HEAD}` };
  return commit({ trigger: mergeTrigger, effects: finalEffects });
}

/**
 * 現在のブランチの変更を、指定したブランチの先端に付け替える
 */
export function rebase(baseBranchName: string): void {
  const headBranchName = HEAD;
  if (headBranchName === baseBranchName) return;

  const baseSnapshot = snapshots.get(branches.get(baseBranchName)!.commitId)!;
  const headSnapshot = snapshots.get(branches.get(headBranchName)!.commitId)!;
  const ancestorSnapshot = findCommonAncestor(baseSnapshot, headSnapshot);
  if (!ancestorSnapshot) throw new Error("No common ancestor.");

  const commitsToReplay = getCommitHistory(headSnapshot, ancestorSnapshot.id);

  checkout(baseBranchName);
  
  for (const oldCommit of commitsToReplay.reverse()) {
    if(oldCommit.id === ancestorSnapshot.id) continue;
    commit(drip(oldCommit.trigger.value)(oldCommit.trigger.dripper));
  }
  
  const newCommitId = branches.get(HEAD)!.commitId;
  branches.set(headBranchName, { name: headBranchName, commitId: newCommitId });
  
  checkout(headBranchName);
}