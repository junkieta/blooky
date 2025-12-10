# Blooky

> **「データが流れる」ことを軸に、開発体験を再設計する。**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Status](https://img.shields.io/badge/status-community%20preview-yellow.svg)]()
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

## Web開発の分断と向け合う

React、RxJS、Redux、Saga... 優れたツール群はあれど、それぞれが異なる世界観を持ち、開発者は「翻訳」と「接着」に時間を費やしています。

Blookyは、**データフロー・UI・副作用を一つの抽象で統合**します。

```typescript
// これが全て - データ、UI、副作用が同じ言語で繋がる
const search$ = stream({ debounce: 300 });
const $results = hold([])(search$);

const App = jshtml({
  input: null,
  $: { oninput: search$ },
  div: $results  // 自動的にリアクティブ
});

const Effect = jshtml({
  "fx-effect": {
    "fx-call": null,
    $: { fn: api.search, arg: $results }
  }
});
```

## コア思想

### 1. 開発体験の再設計

`blooky`が目指すのは、単なる「生産性の向上」ではありません。開発という行為そのものにまつわる**体験**を再設計することです。

**概念を理解する体験**  
「データが流れる」という一つの概念から、すべてが派生します。理解は直線的に深まり、断片化しません。

**問題を分解する体験**  
Stream / Prop / fx が明確な役割を持ち、問題は自然に分解されます。

**デバッグする体験**  
DevToolsがデータフローと副作用の実行を統一的に可視化し、問題の所在を明らかにします。

**コードを成長させる体験**  
Streamの接続を変えるだけで、影響は自動的に伝播します。コードは有機的に成長します。

### 2. 統一された抽象

```
Stream → Prop → DOM
   ↓      ↓      ↓
  全て同じデータフローの一部
```

useState、useEffect、dispatch、saga... 異なる概念を覚える必要はありません。  
**「データが流れる」** - この一つの概念から全てが派生します。

### 3. Web標準へのリスペクト

- 仮想DOMではなく、実DOM
- 独自テンプレートではなく、JavaScript
- 特殊なイベントではなく、標準EventTarget

MDNが最高のドキュメント。Web標準の知識がそのまま活きます。

### 4. 可視化可能な副作用

```html
<fx-sequence>
  <fx-wait ms="1000" />
  <fx-parallel>
    <fx-call fn="fetchUser" />
    <fx-call fn="fetchPosts" />
  </fx-parallel>
  <fx-if when="hasData">
    <fx-call fn="render" />
  </fx-if>
</fx-sequence>
```

複雑な非同期処理が「見える」。DevToolsでリアルタイムに実行状態を追跡できます。

## アーキテクチャ

```
blooky-fp       # Stream/Propによるリアクティブコア
blooky-fv       # 宣言的DOM構築
blooky-fx       # 副作用オーケストレーション
blooky-fxdom    # HTMLでの副作用記述
blooky-devtools # 開発ツール
```

各モジュールは疎結合。必要なものだけを段階的に学習・使用できます。

## Quick Start

```bash
npm install blooky
```

```typescript
import { stream, hold, map } from 'blooky-fp';
import { jshtml, prime } from 'blooky-fv';

// 最小のカウンター
const click$ = stream();
const $count = accum((count)=>count+1,0)(click$);

const Counter = prime(({ $count, click$ }) => ({
  div: [
    { h1: ["Count: ", $count] },
    { button: "+", $: { onclick: click$ } }
  ]
}));

document.body.append(Counter({ $count, click$ }));
```

## 誰のために

### 🎯 特に適している

- **初学者**: 一つの概念から段階的に学べる
- **データ駆動開発者**: 複雑なフローを扱う
- **標準技術愛好者**: フレームワーク独自の魔法を避けたい

### ⚠️ 向いていないかも

- 既存React/Vueプロジェクトの移行
- 豊富なUIライブラリが今すぐ必要
- エコシステムの成熟度を重視

## 開発体験

### データフローの可視化

```typescript
import { dumpGraphDOT } from 'blooky-devtools';

// あなたのアプリケーションの全体像を一瞬で把握
const graph = dumpGraphDOT({ 
  click$, 
  $count, 
  saveEffect$ 
});
```

### リアルタイムデバッグ

fx要素の実行状態がCSS-CustomStateSetで可視化：
- `running`: 実行中
- `paused`: 待機中  
- `failed`: エラー
- `completed`: 完了

## Status: Community Preview

コアは安定していますが、エコシステムは発展途上です。  
現時点での本番利用は推奨しませんが、**このビジョンに共感する方のフィードバックを歓迎します**。

## Learn More

- [チュートリアル](./docs/tutorial.md) - 段階的に学ぶ
- [サンプル集](./docs/examples.md) - 実践的な15のサンプル
- [Blooky Vision](./docs/vision.md) - Blookyをもっと知る
- [API Reference](./docs/api.md) - 詳細なAPIドキュメント

## Contributing

Blookyの思想に共感し、この旅に参加してくれる方を歓迎します。

- [GitHub Issues](https://github.com/junkieta/blooky/issues)
- [Discussions](https://github.com/junkieta/blooky/discussions)

---

**blooky** — 統合された視座から、Web 開発を再び「理解できるもの」に。
