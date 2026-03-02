# Blooky

## 注意
2026.3時点、仕様書の凍結や記述も含め、フレームワークの全作業が現状では思考実験の産物です。
仕様書の書き方の勉強を兼ねていますので、現在の資料中に書かれた凍結状況等も言葉のまま信用しないでください。
> ** 広く利用や議論をできる段階だと作者が判断したらreadmeを更新します。 **

## コア思想

> **「データが流れる」ことを軸に、開発体験を再設計する。**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Status](https://img.shields.io/badge/status-community%20preview-yellow.svg)]()
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

### 1. 統一された抽象

```
Stream → Prop → UI/Fx
   ↓      ↓      ↓
  全て同じデータフローの一部
```

### 2. 可視化可能な副作用

```html
<fx-sequence>
  <fx-wait ms="1000" />
  <fx-parallel>
    <fx-call fn="fetchUser" />
    <fx-call fn="fetchPosts" />
  </fx-parallel>
  <fx-if test="hasData">
    <fx-call fn="render" />
  </fx-if>
</fx-sequence>
```

## アーキテクチャ

```
blooky-fp       # Stream/Propによるリアクティブコア
blooky-fv       # 宣言的DOM構築
blooky-fx       # 副作用オーケストレーション
blooky-fxdom    # HTMLでの副作用記述
blooky-devtools # 開発ツール
```

## Quick Start

```typescript
import { stream, accum } from 'blooky-fp';
import { prime } from 'blooky-fv';

// 最小のカウンター
const click$ = stream();
const $count = accum((count)=>count+1,0)(click$);
const Counter = prime(({ $count, click$ }: { $count: Prop<number>, click$: DripperStream<MouseEvent> }) => ({
  div: [
    { h1: ["Count: ", $count] },
    { button: "+", $: { onclick: click$ } }
  ]
}));

document.body.append(Counter({ $count, click$ }));
```

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

---

**blooky** — 統合された視座から、Web 開発を再び「理解できるもの」に。
