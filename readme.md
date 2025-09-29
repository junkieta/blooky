# blooky

**宣言的オーケストレーション・TypeScriptフレームワーク** *データフロー、UI、そして複雑な副作用までを、一つのフローとして統合する*

## Current Status: Professional & Experimental

> ⚠️ **コミュニティプレビュー** \> `blooky`のコアアーキテクチャは安定しており、`blooky`が解決しようとする課題に対する明確なビジョンを持っています。しかしプロダクトとして発展途上であり、APIはまだ変更される可能性があります。エコシステムも未整備のため、現時点での本番環境（プロダクション）での利用は推奨しません。アプローチの可能性を検証するために、コミュニティからのフィードバックを求めています。

## What is blooky?

現代のWebアプリケーション開発は、UI（React/Vue）、状態管理（Redux/Pinia）、副作用（Saga/Query）といった、強力ですが**分断された**ツール群を「接着剤」となるコードで繋ぎ合わせる複雑な作業になりがちです。

`blooky`はこの分断に問題意識を持ち、**シームレスに統合するアーキテクチャ**として設計したものです。検索、ストリーミング、ワークフローのように、UIと非同期処理が密接に絡むアプリケーションで特に力を発揮します。

  * **`blooky-fp` (Reactive Core)**: FRPの思想に基づき、予測可能でメモリ安全なデータフローを構築します。
  * **`blooky-dom` (Declarative UI)**: リアクティブな状態を、仮想DOMを介さず効率的にDOMに反映させます。
  * **`blooky-fx` (Orchestration Engine)**: アプリケーション全体の複雑な非同期処理やシナリオを、HTMLタグのように宣言的に記述し、**実行過程そのものを可視化・デバッグ**可能にします。

`blooky`の主眼はこれらの要素を「寄せ集める」のではなく、\*\*「オーケストレーション（指揮）」\*\*という統一的な視点から設計し、開発者が本質的なロジックの記述に集中できる、これまでにない開発体験を提供することにあります。

* blooky は「学習コストや移行性」といった現実的な課題を解決するものではありません。
* 代わりに「状態・UI・副作用を一つの視座から統合する」という新しい開発体験を提示します。

## Who is it for?
* **一般的なWeb制作の道具ではありません**
blookyは、小規模サイト制作のような作業を効率化するツールではなく、複雑な状態遷移や非同期フローが絡み合うアプリケーションを持続的に構築するためのアーキテクチャです。

* **学習は必要ですが、その見返りがあります**
新しい概念（Stream/Prop/fx）を理解するには一定の学習曲線があります。しかしそれは、長期的な安定性、可観測性、拡張性を手に入れるための前段階です。

* **制御と可視化を取り戻す**
宣言的フローとdevtoolsにより、アプリケーションの振る舞いを可視化し、再現性の低い非同期バグを効率的に特定できます。結果として、コードベースを安心して成長させられます。

## Core Features

  * ✨ **統一されたアーキテクチャ**: 状態、UI、副作用の間に、「接着剤」は必要ありません。
  * ✍️ **宣言的な副作用**: `async/await`の連鎖やコールバック地獄を、`<fx-sequence>`や`<fx-race>`といった見通しの良いフロー定義に置き換えます。
  * 🔍 **圧倒的なデバッグ体験**: `devtools`が副作用のライフサイクルをリアルタイムに可視化。複雑な非同期処理が「見てわかる」ようになります。
  * 🔒 **型安全**: TypeScriptの能力を引き出し、FRPの複雑な型推論をスムーズに行えます。
  * 🧠 **自動メモリ管理**: `FinalizationRegistry`や`WeakMap`を活用し、不要になった`Stream`や`Prop`の参照を自動的にクリーンアップします。

### Code at a Glance

```typescript
// 1. debounce戦略を持つStreamを定義
const searchInput$ = stream<Event>({ type: 'debounce', delay: 300 });
const $query = hold("")(map(e => e.target.value)(searchInput$));

// 2. UIを定義
const SearchUI = jshtml([
  { input: null, $: { oninput: searchInput$ } },
  { p: ["Searching for: ", $query] }
]);

// 3. 副作用を定義
const fetchUsers$ = stream();
const SearchEffect = jshtml({
  "fx-effect": [
    { "fx-wait": null, $: { until: $query } },
    { "fx-call": null, $: { fn: api.search, arg: $query, id: "users" } },
    { "fx-collapse": null, $: { dripper: fetchUsers$, value: ref("#users") } }
  ],
  $: { ignite: "quantum" }
});

document.body.append(SearchUI, SearchEffect);
```

<!-- 準備中 --

## Getting Started & Contribution

`blooky`の思想に共感し、この旅に参加してくれるコントリビューターを歓迎します！

  * **📖 Tutorial**: [（ここにチュートリアルへのリンクを設置）]
  * **🔧 API Reference**: [（ここにAPIリファレンスへのリンクを設置）]

インストール:

```bash
npm install blooky
```

バグ報告、機能提案、そして`blooky`の思想に関するディスカッションは、GitHubのIssuesやDiscussionsでいつでもお待ちしています。

-->
