
  // blooky-fpから必要なプリミティブをすべてインポート
  import { stream, hold, accum, map, merge, lift, drip, calendar } from './blooky-fp';
  import type { Prop, DripperStream } from './blooky-fp';
  import type { StateSnapshot, Branch, DripResult } from './blooky-types';

  // --- 1. Gitの操作（コマンド）を表現するDripperStreamを定義 ---

  /** 新しいコミットの元となるDripResultを受け取るStream */
  const commit$ = stream<DripEffect<any>>();

  /** 新しいブランチ名を受け取るStream */
  const branch$ = stream<string>();

  /** チェックアウト先のブランチ名を受け取るStream */
  const checkout$ = stream<string>();


  // --- 2. Gitの状態（データ）を表現するPropを定義 ---

  /** * すべてのブランチ情報を保持するProp。
   * branch$とcommit$のイベントに応じて状態が更新される。
   */
  const $branches = accum<Map<string, Branch>, DripResult<any> | string>(
    (branchesMap, action) => {
      const newBranches = new Map(branchesMap);
      
      if (typeof action === 'string') {
        // actionが文字列なら、新しいブランチを作成
        const head = $HEAD(); // 現在のHEADを取得
        newBranches.set(action, { name: action, commitId: head.commitId });
      } else {
        // actionがDripResultなら、現在のブランチのcommitIdを更新
        const head = $HEAD();
        newBranches.set(head.name, { ...head, commitId: action.trigger.commitId }); // 仮: triggerにcommitIdを持たせる
      }
      return newBranches;
    },
    new Map([['main', { name: 'main', commitId: 'root' }]])
  )(merge<DripEffect<any> | string>()([commit$, branch$])());

  /** 現在のブランチ(HEAD)を保持するProp。checkout$に応じて状態が更新される */
  const $HEAD = hold<Branch>({ name: 'main', commitId: 'root' })(
      map((branchName: string) => $branches().get(branchName)!)(checkout$)
  );

  /**
   * すべてのスナップショット(コミット)を保持するProp。
   * commit$のイベントに応じて状態が更新される。
   */
  const $snapshots = accum<Map<string, StateSnapshot>, DripResult<any>>(
    (snapshotsMap, dripResult) => {
      const newSnapshots = new Map(snapshotsMap);
      const parentId = $HEAD().commitId;
      const parentSnapshot = snapshotsMap.get(parentId)!;

      const newFullState = new Map(parentSnapshot.fullState);
      dripResult.effects.forEach(({ prop, nextValue }) => newFullState.set(prop, nextValue));

      const newSnapshot: StateSnapshot = {
        id: 'snap-' + Math.random().toString(36).substr(2, 9),
        parent: parentId,
        trigger: dripResult.trigger,
        effects: dripResult.effects,
        fullState: newFullState,
      };
      
      // 副作用として、dripResult.triggerに新しいcommitIdをセット
      dripResult.trigger.commitId = newSnapshot.id; 

      newSnapshots.set(newSnapshot.id, newSnapshot);
      return newSnapshots;
    },
    new Map([['root', { /* ... initial root snapshot ... */ }]])
  )(commit$);


  // --- 3. 公開API：実処理はStreamへのdripに委譲 ---

  export function commit(dripResult: DripResult<any>): Promise<void> {
    // commit$ StreamにdripResultを流すだけ
    const result = drip(dripResult)(commit$);
    return calendar.schedule(result).then(() => {});
  }

  export function branch(branchName: string): Promise<void> {
    const result = drip(branchName)(branch$);
    return calendar.schedule(result).then(() => {});
  }

  export function checkout(branchName: string): Promise<void> {
    const result = drip(branchName)(checkout$);
    return calendar.schedule(result).then(() => {});
  }


  // --- 4. 状態復元（checkout）の副作用 ---

  // 現在のHEADが指すスナップショットをリアクティブに追跡するProp
  const $currentStateSnapshot = lift(([$head, $snaps]) => $snaps.get($head.commitId)!)([$HEAD, $snapshots]);

  // $currentStateSnapshotが変更されたら、アプリケーションの状態を復元する副作用
  // (この部分は、アプリケーション内の全Propを知るための仕組みが別途必要)
  map((snapshot: StateSnapshot) => {
      console.log(`Checking out state for commit: ${snapshot.id}`);
      // managedProps.forEach((updateFn, prop) => updateFn(snapshot.fullState.get(prop)))
  })($currentStateSnapshot);
