import type { Prop, DripperEffect } from './blooky-fp';
import { drip } from './blooky-fp';
import type { StateSnapshot, Branch, DripTrigger } from './blooky-types';

export class StateStore {
  private snapshots = new Map<string, StateSnapshot>();
  private branches = new Map<string, Branch>();
  private HEAD: string = 'main';
  private readonly managedProps: Readonly<Map<Prop<any>, (value: any) => void>>;

  private constructor(rootSnapshot: StateSnapshot) {
    this.snapshots.set(rootSnapshot.id, rootSnapshot);
    this.branches.set('main', { name: 'main', commitId: rootSnapshot.id });

    const propsMap = new Map();
    rootSnapshot.effects.forEach(({ prop, update }) => {
      propsMap.set(prop, update);
    });
    this.managedProps = propsMap;
  }

  public static create(initialEffects: DripperEffect, initialTrigger: DripTrigger<any>): StateStore {
    const initialState = new Map<Prop<any>, any>();
    initialEffects.forEach(({ prop, nextValue }) => initialState.set(prop, nextValue));

    const rootSnapshot: StateSnapshot = {
      id: 'root-' + Math.random().toString(36).substr(2, 9),
      parent: null,
      trigger: initialTrigger,
      effects: initialEffects,
      fullState: initialState,
    };

    const store = new StateStore(rootSnapshot);
    initialEffects.forEach(({ update, nextValue }) => update(nextValue));
    return store;
  }

  public commit<A>(trigger: DripTrigger<A>): string {
    const parentId = this.branches.get(this.HEAD)!.commitId;
    const parentSnapshot = this.snapshots.get(parentId)!;
    const effects = drip(trigger.value)(trigger.dripper);
    
    return this.internalCommit(effects, trigger, [parentSnapshot]);
  }

  public checkout(branchName: string): void {
    if (!this.branches.has(branchName)) throw new Error(`Branch "${branchName}" not found.`);
    const targetCommitId = this.branches.get(branchName)!.commitId;
    const targetSnapshot = this.snapshots.get(targetCommitId)!;

    this.managedProps.forEach((update, prop) => {
      const value = targetSnapshot.fullState.get(prop);
      update(value);
    });

    this.HEAD = branchName;
  }

  public branch(branchName: string): void {
    if (this.branches.has(branchName)) {
      throw new Error(`Branch "${branchName}" already exists.`);
    }
    const currentCommitId = this.branches.get(this.HEAD)!.commitId;
    this.branches.set(branchName, { name: branchName, commitId: currentCommitId });
  }

  public merge(sourceBranchName: string): string | { conflicts: any[] } {
    if (!this.branches.has(sourceBranchName)) {
      throw new Error(`Branch "${sourceBranchName}" not found.`);
    }

    const targetBranch = this.branches.get(this.HEAD)!;
    const sourceBranch = this.branches.get(sourceBranchName)!;
    const targetSnapshot = this.snapshots.get(targetBranch.commitId)!;
    const sourceSnapshot = this.snapshots.get(sourceBranch.commitId)!;
    const ancestorSnapshot = this.findCommonAncestor(targetSnapshot, sourceSnapshot);

    if (!ancestorSnapshot) {
      throw new Error("Cannot merge branches with no common ancestor.");
    }

    const finalEffects: DripperEffect = [];
    const conflicts: { prop: Prop<any>, targetValue: any, sourceValue: any }[] = [];

    this.managedProps.forEach((update, prop) => {
      const ancestorValue = ancestorSnapshot.fullState.get(prop);
      const targetValue = targetSnapshot.fullState.get(prop);
      const sourceValue = sourceSnapshot.fullState.get(prop);

      const targetChanged = ancestorValue !== targetValue;
      const sourceChanged = ancestorValue !== sourceValue;

      if (!sourceChanged) {
        return; // ソースが変更していない場合はターゲットの変更を維持（何もしない）
      }
      if (sourceChanged && !targetChanged) {
        const created = Date.now();
        finalEffects.push({ created, prop, nextValue: sourceValue, update });
      } else if (targetChanged && sourceChanged && targetValue !== sourceValue) {
        conflicts.push({ prop, targetValue, sourceValue });
      }
    });

    if (conflicts.length > 0) {
      return { conflicts };
    }

    const mergeTrigger = { dripper: null as any, value: `merge ${sourceBranchName} into ${this.HEAD}` };
    return this.internalCommit(finalEffects, mergeTrigger, [targetSnapshot, sourceSnapshot]);
  }

  public rebase(baseBranchName: string): void {
    const headBranchName = this.HEAD;
    if (headBranchName === baseBranchName) return;

    const baseSnapshot = this.snapshots.get(this.branches.get(baseBranchName)!.commitId)!;
    const headSnapshot = this.snapshots.get(this.branches.get(headBranchName)!.commitId)!;
    const ancestorSnapshot = this.findCommonAncestor(baseSnapshot, headSnapshot);
    if (!ancestorSnapshot) throw new Error("No common ancestor to rebase from.");

    const commitsToReplay = this.getCommitHistory(headSnapshot, ancestorSnapshot.id);
    
    // 現在のHEADを、リベースの土台となるブランチの先端に一時的に移動
    this.HEAD = baseBranchName;
    
    // コミットを古い順に、新しい土台の上で再生していく
    for (const oldCommit of commitsToReplay.reverse()) {
      if(oldCommit.id === ancestorSnapshot.id) continue;
      // 再dripして新しいeffectsを計算し、それを元に新しいコミットを作成
      this.commit(oldCommit.trigger);
    }
    
    // 元のブランチ名を、新しく作り直した歴史の先端に付け替える
    const newCommitId = this.branches.get(this.HEAD)!.commitId;
    this.branches.set(headBranchName, { name: headBranchName, commitId: newCommitId });
    
    // 最後に、HEADを元のブランチに戻す
    this.HEAD = headBranchName;
  }

  // --- Private Helper Methods ---

  private internalCommit(effects: DripperEffect, trigger: DripTrigger<any>, parents: StateSnapshot[], updateProps: boolean = true): string {
    const parentSnapshot = parents[0]; // 簡略化のため最初の親を記録
    const newFullState = new Map(parentSnapshot.fullState);
    effects.forEach(({ prop, nextValue }) => newFullState.set(prop, nextValue));

    const newSnapshot: StateSnapshot = {
      id: this.generateId(parentSnapshot.id),
      parent: parentSnapshot.id,
      trigger: trigger,
      effects: effects,
      fullState: newFullState,
    };
    this.snapshots.set(newSnapshot.id, newSnapshot);

    // 現在のブランチのポインタを新しいスナップショットに進める
    this.branches.get(this.HEAD)!.commitId = newSnapshot.id;

    if (updateProps) {
      effects.forEach(({ update, nextValue }) => update(nextValue));
    }

    return newSnapshot.id;
  }

  private findCommonAncestor(snapA: StateSnapshot, snapB: StateSnapshot): StateSnapshot | null {
    const historyA = this.getCommitHistory(snapA);
    const historyA_ids = new Set(historyA.map(s => s.id));
    
    for (const snap of this.getCommitHistory(snapB)) {
      if (historyA_ids.has(snap.id)) {
        return snap;
      }
    }
    return null;
  }

  private getCommitHistory(start: StateSnapshot, stopAtId?: string): StateSnapshot[] {
    const history: StateSnapshot[] = [];
    let current: StateSnapshot | undefined = start;
    while (current && current.id !== stopAtId) {
      history.push(current);
      if (current.parent === null) break;
      current = this.snapshots.get(current.parent);
    }
    return history;
  }

  private generateId(seed: string): string {
    return 'snap-' + (parseInt(seed.slice(-4), 36) + Math.random()).toString(36).slice(2, 11);
  }
}