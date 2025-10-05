# Blooky Framework サンプル集

実践的なユースケースを通じてBlookyの使い方を学ぶサンプル集です。

## 📚 サンプル一覧

### 基礎編（1-5）
1. [カウンター](#example-1) - 最もシンプルな状態管理
2. [リアルタイム検索](#example-2) - debounceとフィルタリング
3. [タブUI](#example-3) - 状態による表示切り替え
4. [フォームバリデーション](#example-4) - 複数フィールドの検証
5. [無限スクロール](#example-5) - 非同期データ読み込み

### 応用編（6-10）
6. [TODOアプリ](#example-6) - CRUD操作の実装
7. [チャットUI](#example-7) - リアルタイム通信
8. [ドラッグ&ドロップ](#example-8) - 複雑なインタラクション
9. [ダッシュボード](#example-9) - 複数データソースの統合
10. [ウィザードフォーム](#example-10) - ステップ型UI

### 実践編（11-15）
11. [画像ギャラリー](#example-11) - レイジーロードと最適化
12. [オートセーブエディタ](#example-12) - 定期保存とコンフリクト解決
13. [通知システム](#example-13) - トースト/モーダル管理
14. [ショッピングカート](#example-14) - 状態の永続化
15. [リアルタイムグラフ](#example-15) - データビジュアライゼーション

---

## 基礎編

### <a name="example-1"></a>1. カウンター
**学習ポイント**: Stream、Prop、基本的なイベント処理

```typescript
import { stream, merge, accum, map } from 'blooky-fp';
import { jshtml, prime } from 'blooky-dom';

// ストリーム定義
const increment$ = stream();
const decrement$ = stream();
const reset$ = stream();

// 状態管理
const changes$ = merge([
  map(() => 1)(increment$),
  map(() => -1)(decrement$),
  map(() => (current: number) => -current)(reset$) // リセット用関数
]);

const $count = accum((count, change) => 
  typeof change === 'function' ? change(count) : count + change,
  0
)(changes$);

// UI定義
const Counter = prime(({ $count, increment$, decrement$, reset$ }) => ({
  div: [
    { h1: "Counter" },
    { h2: $count },
    {
      div: [
        { button: "-", $: { onclick: decrement$ } },
        { button: "Reset", $: { onclick: reset$ } },
        { button: "+", $: { onclick: increment$ } }
      ],
      $: { class: "controls" }
    }
  ],
  $: { class: "counter-app" }
}));

document.body.append(Counter({ $count, increment$, decrement$, reset$ }));
```

---

### <a name="example-2"></a>2. リアルタイム検索
**学習ポイント**: debounce、非同期処理、ローディング状態

```typescript
import { stream, hold, map, filter, merge, remap } from 'blooky-fp';
import { jshtml, prime } from 'blooky-dom';
import { fx, execute, prepare } from 'blooky-fx';

// debounce付きの検索ストリーム
const searchInput$ = stream<Event>({ type: 'debounce', delay: 300 });
// 2文字以上の入力値が発生したストリームとして変換
const termUpdated$ = filter<string>((term)=>term.length>=2)
    (map<string,Event>((e)=>(e.target as HTMLInputElement).value)(searchInput$));
// 検索文字列のProp
const $searchTerm = hold("")(termUpdated$);
// 検索を開始イベントのストリーム
const searchRunning$ = stream<string>();
// 検索API（モック）
type SearchResult = { id: number, title: string }[];
const searchAPI = async (term: string) => {
  await new Promise(r => setTimeout(r, 500));
  return [
    { id: 1, title: `Result for "${term}" #1` },
    { id: 2, title: `Result for "${term}" #2` },
    { id: 3, title: `Result for "${term}" #3` }
  ];
};
// 検索結果を受け取るストリーム
const searchDone$ = stream<SearchResult>();
// 検索結果配列
const $results = hold([])(searchDone$);

// サーチAPIの実行タイミング制御
const $searchAPIIgnite = hold("none")(merge([
    map(()=>"quantum")(termUpdated$),
    map(()=>"none")(searchDone$)
]));

// サーチ状況に応じたメッセージ、結果のProp
const $searchStatus = hold({ p: "input search term" })(merge([
    map(()=>({ p: "input search term" }))(termUpdated$),
    map(()=>({ p: "search started..." }))(searchRunning$),
    map((results)=>({ ul: results.map((r)=>({ li: r.title })) })(searchDone$)
]));

// UI
const SearchBox = prime(({ $searchTerm, searchInput$, $searchStatus, $searchAPIIgnite, searchDone$ }) => ({
  div: [
    { h2: "Live Search" },
    {
      input: null,
      $: {
        type: "search",
        placeholder: "Type to search...",
        oninput: searchInput$
      }
    },
    {
      div: $searchStatus
    },
    { "fx-effect": [
        { "fx-collapse": null, $: { dripper: searchRunning$, value: "true" } },
        { "fx-call": null, $: { fn: searchAPI, arg: $searchTerm, id: "searchResult" } },
        { "fx-collapse": null, $: { dripper: searchDone$, value: "#searchResult" } }
    ], $: { ignite: $searchAPIIgnite }}
  ]
}));
```

---

### <a name="example-3"></a>3. タブUI
**学習ポイント**: 状態による表示切り替え、動的クラス

```typescript
import { stream, hold } from 'blooky-fp';
import { jshtml, prime } from 'blooky-dom';

type TabId = 'overview' | 'details' | 'reviews';

const tabClick$ = stream<TabId>();
const $activeTab = hold<TabId>('overview')(tabClick$);

const tabs: { id: TabId; label: string; content: string }[] = [
  { id: 'overview', label: 'Overview', content: 'Product overview content...' },
  { id: 'details', label: 'Details', content: 'Technical details...' },
  { id: 'reviews', label: 'Reviews', content: 'Customer reviews...' }
];

const TabUI = prime(({ $activeTab, tabClick$ }) => ({
  div: [
    {
      ul: tabs.map(tab => ({
        li: {
          button: tab.label,
          $: {
            onclick: () => collapse(drip(tab.id)(tabClick$)),
            class: remap(active => 
              active === tab.id ? 'tab active' : 'tab'
            )($activeTab)
          }
        }
      })),
      $: { class: "tab-list" }
    },
    {
      div: remap(activeId => {
        const tab = tabs.find(t => t.id === activeId);
        return tab ? { p: tab.content } : null;
      })($activeTab),
      $: { class: "tab-content" }
    }
  ]
}));
```

---

### <a name="example-4"></a>4. フォームバリデーション
**学習ポイント**: 複数Propの組み合わせ、リアルタイムバリデーション

```typescript
import { stream, hold, lift, remap } from 'blooky-fp';
import { jshtml, prime } from 'blooky-dom';

// フィールドごとのストリーム
const email$ = stream();
const password$ = stream();
const confirmPassword$ = stream();

// 値の保持
const $email = hold("")(email$);
const $password = hold("")(password$);
const $confirmPassword = hold("")(confirmPassword$);

// バリデーション
const $emailError = remap(email => {
  if (!email) return "Email is required";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) 
    return "Invalid email format";
  return null;
})($email);

const $passwordError = remap(pass => {
  if (!pass) return "Password is required";
  if (pass.length < 8) return "Password must be at least 8 characters";
  if (!/(?=.*[A-Z])(?=.*[0-9])/.test(pass)) 
    return "Password must contain uppercase and number";
  return null;
})($password);

const $confirmError = lift((pass, confirm) => {
  if (!confirm) return "Please confirm password";
  if (pass !== confirm) return "Passwords do not match";
  return null;
})([$password, $confirmPassword]);

const $isValid = lift((emailErr, passErr, confirmErr) => 
  !emailErr && !passErr && !confirmErr
)([$emailError, $passwordError, $confirmError]);

// UIコンポーネント
const FormField = prime(({ label, type, stream$, $value, $error }) => ({
  div: [
    { label },
    {
      input: null,
      $: {
        type,
        oninput: (e) => collapse(drip(e.target.value)(stream$)),
        class: remap(err => err ? "error" : "")(($error))
      }
    },
    remap(err => err ? { span: err, $: { class: "error-msg" } } : null)($error)
  ],
  $: { class: "form-field" }
}));

const ValidationForm = prime((context) => ({
  form: [
    { h2: "Registration Form" },
    FormField({
      label: "Email",
      type: "email",
      stream$: email$,
      $value: $email,
      $error: $emailError
    }),
    FormField({
      label: "Password",
      type: "password", 
      stream$: password$,
      $value: $password,
      $error: $passwordError
    }),
    FormField({
      label: "Confirm Password",
      type: "password",
      stream$: confirmPassword$,
      $value: $confirmPassword,
      $error: $confirmError
    }),
    {
      button: "Submit",
      $: {
        type: "submit",
        disabled: remap(valid => !valid)($isValid)
      }
    }
  ],
  $: {
    onsubmit: (e) => {
      e.preventDefault();
      console.log("Form submitted!");
    }
  }
}));
```

---

### <a name="example-5"></a>5. 無限スクロール
**学習ポイント**: スクロールイベント、非同期ロード、配列の追加

```typescript
import { stream, hold, accum } from 'blooky-fp';
import { jshtml, prime, mutations } from 'blooky-dom';
import { fxdom } from 'blooky-fxdom';

// 状態管理
const loadMore$ = stream({ type: 'throttle', interval: 500 });
const $items = accum((items, newItems) => 
  [...items, ...newItems], []
)(stream());
const $isLoading = hold(false)(stream());
const $hasMore = hold(true)(stream());
const $page = accum((p, _) => p + 1, 0)(loadMore$);

// データ取得（モック）
const fetchItems = async (page: number) => {
  await new Promise(r => setTimeout(r, 1000));
  const items = Array.from({ length: 20 }, (_, i) => ({
    id: page * 20 + i,
    title: `Item ${page * 20 + i + 1}`,
    content: `Content for item ${page * 20 + i + 1}`
  }));
  return { items, hasMore: page < 5 };
};

// 無限スクロールコンポーネント
const InfiniteScroll = prime(({ $items, $isLoading, $hasMore, loadMore$ }) => ({
  div: [
    { h2: "Infinite Scroll" },
    {
      div: remap(items => 
        items.map(item => ({
          article: [
            { h3: item.title },
            { p: item.content }
          ],
          $: { key: item.id }
        }))
      )($items),
      $: { class: "items-container" }
    },
    {
      div: lift(([isLoading, hasMore]) => {
        if (isLoading) return { p: "Loading..." };
        if (!hasMore) return { p: "No more items" };
        return null;
      })([$isLoading, $hasMore])),
      $: { 
        id: "sentinel",
        class: "loading-indicator"
      }
    },
    // IntersectionObserverを使用
    {
      "fx-effect": {
        "fx-call": jshtml.$({
          fn: () => {
            const sentinel = document.getElementById('sentinel');
            const observer = new IntersectionObserver(
              entries => {
                if (entries[0].isIntersecting && $hasMore() && !$isLoading()) {
                  collapse(drip(null)(loadMore$));
                }
              },
              { threshold: 0.1 }
            );
            observer.observe(sentinel);
            return () => observer.disconnect();
          }
        })
      }
    }
  ],
  $: { class: "infinite-scroll" }
}));
```

---

## 応用編

### <a name="example-6"></a>6. TODOアプリ
**学習ポイント**: CRUD操作、ローカルストレージ、フィルタリング

```typescript
import { stream, hold, accum, remap, lift } from 'blooky-fp';
import { jshtml, prime } from 'blooky-dom';

// Todo型定義
interface Todo {
  id: number;
  text: string;
  completed: boolean;
  createdAt: Date;
}

type FilterType = 'all' | 'active' | 'completed';

// ストリーム
const addTodo$ = stream<string>();
const toggleTodo$ = stream<number>();
const deleteTodo$ = stream<number>();
const clearCompleted$ = stream();
const setFilter$ = stream<FilterType>();

// 状態
const $todos = accum((todos: Todo[], action: any) => {
  if (action.type === 'add') {
    return [...todos, {
      id: Date.now(),
      text: action.text,
      completed: false,
      createdAt: new Date()
    }];
  }
  if (action.type === 'toggle') {
    return todos.map(t => 
      t.id === action.id ? { ...t, completed: !t.completed } : t
    );
  }
  if (action.type === 'delete') {
    return todos.filter(t => t.id !== action.id);
  }
  if (action.type === 'clear') {
    return todos.filter(t => !t.completed);
  }
  return todos;
}, [])(
  merge()([
    map(text => ({ type: 'add', text }))(addTodo$),
    map(id => ({ type: 'toggle', id }))(toggleTodo$),
    map(id => ({ type: 'delete', id }))(deleteTodo$),
    map(() => ({ type: 'clear' }))(clearCompleted$)
  ])
);

const $filter = hold<FilterType>('all')(setFilter$);

const $filteredTodos = lift((todos, filter) => {
  switch (filter) {
    case 'active': return todos.filter(t => !t.completed);
    case 'completed': return todos.filter(t => t.completed);
    default: return todos;
  }
})([$todos, $filter]);

const $stats = remap(todos => ({
  total: todos.length,
  active: todos.filter(t => !t.completed).length,
  completed: todos.filter(t => t.completed).length
}))($todos);

// TodoアプリUI
const TodoApp = prime((context) => ({
  div: [
    { h1: "Blooky Todo" },
    // 入力フォーム
    {
      form: {
        input: null,
        $: {
          type: "text",
          placeholder: "What needs to be done?",
          onkeypress: (e) => {
            if (e.key === 'Enter' && e.target.value.trim()) {
              e.preventDefault();
              collapse(drip(e.target.value)(addTodo$));
              e.target.value = '';
            }
          }
        }
      }
    },
    // Todoリスト
    {
      ul: remap(todos => 
        todos.map(todo => ({
          li: [
            {
              input: null,
              $: {
                type: "checkbox",
                checked: todo.completed,
                onchange: () => collapse(drip(todo.id)(toggleTodo$))
              }
            },
            {
              span: todo.text,
              $: {
                class: todo.completed ? "completed" : "",
                ondblclick: (e) => {
                  // インライン編集の実装
                }
              }
            },
            {
              button: "×",
              $: {
                onclick: () => collapse(drip(todo.id)(deleteTodo$))
              }
            }
          ],
          $: { key: todo.id }
        }))
      )($filteredTodos)
    },
    // フッター
    {
      footer: [
        { span: remap(s => `${s.active} items left`)($stats) },
        // フィルターボタン
        {
          div: ['all', 'active', 'completed'].map(filter => ({
            button: filter,
            $: {
              onclick: () => collapse(drip(filter)(setFilter$)),
              class: remap(f => f === filter ? 'selected' : '')($filter)
            }
          }))
        },
        {
          button: "Clear completed",
          $: {
            onclick: clearCompleted$,
            disabled: remap(s => s.completed === 0)($stats)
          }
        }
      ]
    }
  ],
  $: { class: "todo-app" }
}));
```

---

### <a name="example-7"></a>7. チャットUI
**学習ポイント**: WebSocket統合、自動スクロール、タイピング表示

```typescript
import { stream, hold, accum } from 'blooky-fp';
import { jshtml, prime } from 'blooky-dom';
import { fx, execute, prepare } from 'blooky-fx';

interface Message {
  id: string;
  user: string;
  text: string;
  timestamp: Date;
  isOwn: boolean;
}

// WebSocket接続
const ws$ = stream<WebSocket>();
const messageReceived$ = stream<Message>();
const messageSend$ = stream<string>();
const typing$ = stream<boolean>();

// 状態
const $messages = accum((msgs: Message[], msg: Message) => 
  [...msgs, msg], []
)(messageReceived$);
const $isTyping = hold(false)(typing$);
const $onlineUsers = hold<string[]>([])(stream());

// WebSocket管理
const setupWebSocket = () => {
  const ws = new WebSocket('ws://localhost:8080');
  
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'message') {
      collapse(drip({
        ...data.message,
        isOwn: false
      })(messageReceived$));
    } else if (data.type === 'typing') {
      collapse(drip(data.isTyping)(typing$));
    } else if (data.type === 'users') {
      $onlineUsers.update(data.users);
    }
  };
  
  return ws;
};

// チャットUI
const ChatUI = prime(({ $messages, $isTyping, $onlineUsers, messageSend$ }) => ({
  div: [
    // ヘッダー
    {
      header: [
        { h2: "Chat Room" },
        { 
          span: remap(users => `${users.length} online`)($onlineUsers)
        }
      ]
    },
    // メッセージエリア
    {
      div: [
        remap(messages => 
          messages.map(msg => ({
            div: [
              { strong: msg.user },
              { span: msg.text },
              { 
                time: new Date(msg.timestamp).toLocaleTimeString()
              }
            ],
            $: { 
              class: msg.isOwn ? "message own" : "message",
              key: msg.id
            }
          }))
        )($messages),
        // タイピングインジケーター
        remap(typing => 
          typing ? { div: "Someone is typing...", $: { class: "typing" } } : null
        )($isTyping)
      ],
      $: { 
        class: "messages",
        // 自動スクロール
        onupdate: (e) => {
          e.target.scrollTop = e.target.scrollHeight;
        }
      }
    },
    // 入力エリア
    {
      form: [
        {
          input: null,
          $: {
            type: "text",
            placeholder: "Type a message...",
            oninput: (e) => {
              // タイピング通知（debounce）
            },
            onkeypress: (e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                const text = e.target.value.trim();
                if (text) {
                  collapse(drip(text)(messageSend$));
                  e.target.value = '';
                }
              }
            }
          }
        },
        { button: "Send", $: { type: "submit" } }
      ]
    }
  ],
  $: { class: "chat-ui" }
}));
```

---

### <a name="example-8"></a>8. ドラッグ&ドロップ
**学習ポイント**: マウスイベント処理、座標計算、アニメーション

```typescript
import { stream, hold, remap } from 'blooky-fp';
import { jshtml, prime } from 'blooky-dom';

interface DragItem {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  content: string;
}

// ドラッグイベント
const dragStart$ = stream<{ item: DragItem; mouseX: number; mouseY: number }>();
const dragMove$ = stream<{ mouseX: number; mouseY: number }>();
const dragEnd$ = stream();

// ドラッグ状態
const $isDragging = hold(false)(
  merge()([
    map(() => true)(dragStart$),
    map(() => false)(dragEnd$)
  ])
);

const $draggedItem = hold<DragItem | null>(null)(
  merge()([
    map(e => e.item)(dragStart$),
    map(() => null)(dragEnd$)
  ])
);

const $dragOffset = hold({ x: 0, y: 0 })(
  map(e => ({
    x: e.mouseX - e.item.x,
    y: e.mouseY - e.item.y
  }))(dragStart$)
);

const $currentPos = hold({ x: 0, y: 0 })(
  map(e => {
    const offset = $dragOffset();
    return {
      x: e.mouseX - offset.x,
      y: e.mouseY - offset.y
    };
  })(dragMove$)
);

// ドラッグ可能なアイテム
const DraggableItem = prime(({ item, dragStart$ }) => ({
  div: [
    { h3: item.content },
    {
      div: "Drag me!",
      $: { class: "handle" }
    }
  ],
  $: {
    class: "draggable-item",
    style: {
      position: "absolute",
      left: `${item.x}px`,
      top: `${item.y}px`,
      width: `${item.width}px`,
      height: `${item.height}px`
    },
    onmousedown: (e) => {
      if (e.target.classList.contains('handle')) {
        e.preventDefault();
        collapse(drip({
          item,
          mouseX: e.clientX,
          mouseY: e.clientY
        })(dragStart$));
      }
    }
  }
}));

// ドロップゾーン
const DropZone = prime(({ $isDragging, $currentPos }) => ({
  div: [
    { h2: "Drag & Drop Area" },
    // ドラッグ中のゴースト要素
    remap((isDragging, item, pos) => 
      isDragging && item ? {
        div: item.content,
        $: {
          class: "drag-ghost",
          style: {
            position: "fixed",
            left: `${pos.x}px`,
            top: `${pos.y}px`,
            pointerEvents: "none",
            opacity: 0.7
          }
        }
      } : null
    )(lift((a, b, c) => [a, b, c])([$isDragging, $draggedItem, $currentPos]))
  ],
  $: {
    class: "drop-zone",
    onmousemove: (e) => {
      if ($isDragging()) {
        collapse(drip({
          mouseX: e.clientX,
          mouseY: e.clientY
        })(dragMove$));
      }
    },
    onmouseup: () => {
      if ($isDragging()) {
        collapse(drip(null)(dragEnd$));
      }
    }
  }
}));
```

---

### <a name="example-9"></a>9. ダッシュボード
**学習ポイント**: 複数データソース、定期更新、グラフ表示

```typescript
import { stream, hold, lift } from 'blooky-fp';
import { jshtml, prime } from 'blooky-dom';
import { fxdom } from 'blooky-fxdom';

// メトリクスの定義
interface Metrics {
  cpu: number;
  memory: number;
  network: { in: number; out: number };
  requests: number;
  errors: number;
}

// データストリーム（定期更新）
const metricsUpdate$ = stream({ type: 'throttle', interval: 1000 });
const alertTriggered$ = stream<string>();

// 状態
const $metrics = hold<Metrics>({
  cpu: 0,
  memory: 0,
  network: { in: 0, out: 0 },
  requests: 0,
  errors: 0
})(metricsUpdate$);

const $history = accum((history: Metrics[], current: Metrics) => {
  const updated = [...history, current];
  return updated.slice(-60); // 最後の60データポイントを保持
}, [])(metricsUpdate$);

const $alerts = accum((alerts: string[], alert: string) => 
  [alert, ...alerts].slice(0, 10), // 最新10件
[])(alertTriggered$);

// ダッシュボードUI
const Dashboard = prime((context) => ({
  div: [
    { h1: "System Dashboard" },
    
    // メトリクスカード
    {
      div: [
        MetricCard({
          title: "CPU Usage",
          $value: remap(m => m.cpu)($metrics),
          unit: "%",
          threshold: 80
        }),
        MetricCard({
          title: "Memory",
          $value: remap(m => m.memory)($metrics),
          unit: "GB",
          threshold: 90
        }),
        MetricCard({
          title: "Requests/sec",
          $value: remap(m => m.requests)($metrics),
          unit: "",
          threshold: 1000
        }),
        MetricCard({
          title: "Error Rate",
          $value: remap(m => m.errors)($metrics),
          unit: "%",
          threshold: 5
        })
      ],
      $: { class: "metrics-grid" }
    },
    
    // グラフエリア
    {
      div: {
        canvas: null,
        $: {
          id: "chart",
          width: 800,
          height: 400
        }
      }
    },
    
    // アラート履歴
    {
      div: [
        { h2: "Recent Alerts" },
        {
          ul: remap(alerts => 
            alerts.map(alert => ({ li: alert }))
          )($alerts),
          $: { class: "alerts-list" }
        }
      ]
    },
    
    // 自動更新フロー
    {
      "fx-effect": {
        "fx-loop": [
          { "fx-call": jshtml.$({ fn: "fetchMetrics", id: "data" }) },
          { "fx-collapse": jshtml.$({ 
            dripper: "metricsUpdate$", 
            value: "#data" 
          })},
          { "fx-wait": jshtml.$({ ms: 1000 }) }
        ],
        $: { while: () => true } // 無限ループ
      }
    }
  ],
  $: { class: "dashboard" }
}));

// メトリクスカードコンポーネント
const MetricCard = prime(({ title, $value, unit, threshold }) => ({
  div: [
    { h3: title },
    {
      div: [
        remap(v => v.toFixed(1))($value),
        { span: unit }
      ],
      $: {
        class: remap(v => v > threshold ? "value warning" : "value")($value)
      }
    },
    // ミニグラフ
    {
      div: {
        svg: null // Sparkline実装
      }
    }
  ],
  $: { class: "metric-card" }
}));
```

---
### <a name="example-10"></a>10. ウィザードフォーム
**学習ポイント**: ステップ管理、進行状況、データ検証

```typescript
import { stream, hold, accum, remap, lift } from 'blooky-fp';
import { jshtml, prime } from 'blooky-dom';
import { fx, execute, prepare } from 'blooky-fx';

// ステップ定義
interface WizardStep {
  id: string;
  title: string;
  fields: FormField[];
  validate: (data: any) => string | null;
}

interface FormField {
  name: string;
  label: string;
  type: 'text' | 'email' | 'select' | 'checkbox';
  options?: string[];
  required?: boolean;
}

// ウィザード状態
const next$ = stream();
const prev$ = stream();
const jumpTo$ = stream<number>();
const fieldUpdate$ = stream<{ field: string; value: any }>();

const steps: WizardStep[] = [
  {
    id: 'personal',
    title: 'Personal Information',
    fields: [
      { name: 'firstName', label: 'First Name', type: 'text', required: true },
      { name: 'lastName', label: 'Last Name', type: 'text', required: true },
      { name: 'email', label: 'Email', type: 'email', required: true }
    ],
    validate: (data) => {
      if (!data.firstName || !data.lastName) return 'Name is required';
      if (!data.email) return 'Email is required';
      return null;
    }
  },
  {
    id: 'account',
    title: 'Account Setup',
    fields: [
      { name: 'username', label: 'Username', type: 'text', required: true },
      { name: 'password', label: 'Password', type: 'text', required: true },
      { name: 'plan', label: 'Plan', type: 'select', options: ['Free', 'Pro', 'Enterprise'] }
    ],
    validate: (data) => {
      if (!data.username) return 'Username is required';
      if (data.password?.length < 8) return 'Password too short';
      return null;
    }
  },
  {
    id: 'preferences',
    title: 'Preferences',
    fields: [
      { name: 'newsletter', label: 'Subscribe to newsletter', type: 'checkbox' },
      { name: 'notifications', label: 'Email notifications', type: 'checkbox' }
    ],
    validate: () => null
  }
];

// 現在のステップ
const $currentStep = accum((step, action: any) => {
  if (action === 'next') return Math.min(step + 1, steps.length - 1);
  if (action === 'prev') return Math.max(step - 1, 0);
  if (typeof action === 'number') return action;
  return step;
}, 0)(
  merge()([
    map(() => 'next')(next$),
    map(() => 'prev')(prev$),
    jumpTo$
  ])
);

// フォームデータ
const $formData = accum((data, update: any) => ({
  ...data,
  [update.field]: update.value
}), {})(fieldUpdate$);

// 検証状態
const $currentError = lift((step, data) => {
  return steps[step].validate(data);
})([$currentStep, $formData]);

const $canProceed = remap(err => !err)($currentError);
const $progress = remap(step => ((step + 1) / steps.length) * 100)($currentStep);

// ウィザードUI
const WizardForm = prime((context) => ({
  div: [
    // プログレスバー
    {
      div: [
        {
          div: null,
          $: {
            class: "progress-fill",
            style: {
              width: remap(p => `${p}%`)($progress)
            }
          }
        }
      ],
      $: { class: "progress-bar" }
    },
    
    // ステップインジケーター
    {
      ol: steps.map((step, index) => ({
        li: [
          { span: index + 1 },
          { span: step.title }
        ],
        $: {
          class: remap(current => {
            if (current === index) return 'step active';
            if (current > index) return 'step completed';
            return 'step';
          })($currentStep),
          onclick: () => collapse(drip(index)(jumpTo$))
        }
      })),
      $: { class: "steps" }
    },
    
    // 現在のステップ内容
    remap(stepIndex => {
      const step = steps[stepIndex];
      return {
        div: [
          { h2: step.title },
          ...step.fields.map(field => 
            WizardField({ 
              field, 
              $value: remap(data => data[field.name])($formData),
              onChange: (value) => collapse(drip({ 
                field: field.name, 
                value 
              })(fieldUpdate$))
            })
          ),
          // エラー表示
          remap(err => err ? { 
            p: err, 
            $: { class: "error" } 
          } : null)($currentError)
        ]
      };
    })($currentStep),
    
    // ナビゲーションボタン
    {
      div: [
        {
          button: "Previous",
          $: {
            onclick: prev$,
            disabled: remap(step => step === 0)($currentStep)
          }
        },
        {
          button: remap(step => 
            step === steps.length - 1 ? "Submit" : "Next"
          )($currentStep),
          $: {
            onclick: () => {
              const step = $currentStep();
              if (step === steps.length - 1) {
                // Submit
                console.log("Form submitted:", $formData());
              } else {
                collapse(drip(null)(next$));
              }
            },
            disabled: remap(can => !can)($canProceed)
          }
        }
      ],
      $: { class: "wizard-nav" }
    }
  ],
  $: { class: "wizard-form" }
}));

// フィールドコンポーネント
const WizardField = prime(({ field, $value, onChange }) => ({
  div: [
    { label: field.label },
    field.type === 'select' ? {
      select: field.options?.map(opt => ({ option: opt })),
      $: {
        onchange: (e) => onChange(e.target.value)
      }
    } : field.type === 'checkbox' ? {
      input: null,
      $: {
        type: 'checkbox',
        checked: $value || false,
        onchange: (e) => onChange(e.target.checked)
      }
    } : {
      input: null,
      $: {
        type: field.type,
        value: $value || '',
        oninput: (e) => onChange(e.target.value)
      }
    }
  ],
  $: { class: "form-field" }
}));
```

---

## 実践編

### <a name="example-11"></a>11. 画像ギャラリー
**学習ポイント**: レイジーロード、モーダル、キーボード操作

```typescript
import { stream, hold, remap } from 'blooky-fp';
import { jshtml, prime } from 'blooky-dom';

interface Image {
  id: string;
  thumb: string;
  full: string;
  title: string;
  description?: string;
}

// イベントストリーム
const imageClick$ = stream<Image>();
const closeModal$ = stream();
const nextImage$ = stream();
const prevImage$ = stream();
const imageLoad$ = stream<string>();

// 状態
const $selectedImage = hold<Image | null>(null)(
  merge()([
    imageClick$,
    map(() => null)(closeModal$)
  ])
);

const $loadedImages = accum((loaded: Set<string>, url: string) => 
  new Set([...loaded, url]), new Set()
)(imageLoad$);

const $currentIndex = hold(0)(
  merge()([
    map(img => images.findIndex(i => i.id === img.id))(imageClick$),
    map(() => ($currentIndex() + 1) % images.length)(nextImage$),
    map(() => ($currentIndex() - 1 + images.length) % images.length)(prevImage$)
  ])
);

// ギャラリーコンポーネント
const ImageGallery = prime(({ images, $selectedImage, imageClick$ }) => ({
  div: [
    // サムネイルグリッド
    {
      div: images.map(image => 
        LazyImage({
          image,
          onClick: () => collapse(drip(image)(imageClick$))
        })
      ),
      $: { class: "gallery-grid" }
    },
    
    // モーダル
    remap(selected => selected ? 
      Modal({
        image: selected,
        onClose: () => collapse(drip(null)(closeModal$)),
        onNext: () => collapse(drip(null)(nextImage$)),
        onPrev: () => collapse(drip(null)(prevImage$))
      }) : null
    )($selectedImage)
  ],
  $: {
    class: "image-gallery",
    // キーボードイベント
    onkeydown: (e) => {
      if (!$selectedImage()) return;
      switch (e.key) {
        case 'Escape': collapse(drip(null)(closeModal$)); break;
        case 'ArrowRight': collapse(drip(null)(nextImage$)); break;
        case 'ArrowLeft': collapse(drip(null)(prevImage$)); break;
      }
    },
    tabindex: 0
  }
}));

// レイジーロード画像
const LazyImage = prime(({ image, onClick }) => ({
  div: [
    {
      img: null,
      $: {
        // Intersection Observerで遅延読み込み
        "data-src": image.thumb,
        alt: image.title,
        class: "lazy",
        onclick: onClick,
        loading: "lazy"
      }
    },
    { p: image.title }
  ],
  $: { class: "gallery-item" }
}));

// モーダルコンポーネント
const Modal = prime(({ image, onClose, onNext, onPrev }) => ({
  div: [
    {
      div: [
        { button: "×", $: { onclick: onClose, class: "close" } },
        { button: "‹", $: { onclick: onPrev, class: "prev" } },
        { button: "›", $: { onclick: onNext, class: "next" } },
        {
          figure: [
            { img: null, $: { src: image.full, alt: image.title } },
            { figcaption: [
              { h3: image.title },
              image.description ? { p: image.description } : null
            ]}
          ]
        }
      ],
      $: { class: "modal-content" }
    }
  ],
  $: { 
    class: "modal",
    onclick: (e) => {
      if (e.target.classList.contains('modal')) onClose();
    }
  }
}));
```

---

### <a name="example-12"></a>12. オートセーブエディタ
**学習ポイント**: 定期保存、コンフリクト検出、差分管理

```typescript
import { stream, hold, accum, when } from 'blooky-fp';
import { jshtml, prime } from 'blooky-dom';
import { fx, execute, prepare } from 'blooky-fx';

// エディタ状態
const textChange$ = stream({ type: 'debounce', delay: 1000 });
const manualSave$ = stream();
const formatCode$ = stream();

const $content = hold("")(textChange$);
const $lastSaved = hold("")(stream());
const $isDirty = lift((current, saved) => 
  current !== saved
)([$content, $lastSaved]);

const $saveStatus = hold<'saved' | 'saving' | 'error' | 'conflict'>('saved')(stream());
const $lastSaveTime = hold<Date | null>(null)(stream());

// 自動保存フロー
const autoSaveFlow = fx.sequence([
  fx.wait({ until: ref("$isDirty") }),
  fx.call(ref("setSaveStatus"), { arg: 'saving' }),
  fx.call(ref("saveContent"), { 
    arg: ref("$content"),
    id: "saveResult",
    catcher: ref("handleSaveError")
  }),
  fx.condition(
    ref("#saveResult.success"),
    fx.sequence([
      fx.call(ref("setSaveStatus"), { arg: 'saved' }),
      fx.call(ref("updateLastSaved"))
    ]),
    fx.call(ref("handleConflict"))
  ),
  fx.wait({ ms: 2000 }),
  fx.loop({ while: () => true, body: fx.none() }) // 再帰
]);

// エディタUI
const AutoSaveEditor = prime((context) => ({
  div: [
    // ヘッダー
    {
      header: [
        { h2: "Auto-Save Editor" },
        {
          div: [
            StatusIndicator({ $status: $saveStatus }),
            remap(time => time ? 
              `Last saved: ${time.toLocaleTimeString()}` : 
              'Never saved'
            )($lastSaveTime),
            {
              button: "Save Now",
              $: {
                onclick: manualSave$,
                disabled: remap(dirty => !dirty)($isDirty)
              }
            }
          ],
          $: { class: "save-info" }
        }
      ]
    },
    
    // エディタ本体
    {
      div: [
        // 行番号
        {
          div: remap(content => {
            const lines = content.split('\n').length;
            return Array.from({ length: lines }, (_, i) => 
              ({ div: i + 1 })
            );
          })($content),
          $: { class: "line-numbers" }
        },
        
        // テキストエリア
        {
          textarea: $content,
          $: {
            oninput: (e) => collapse(drip(e.target.value)(textChange$)),
            onkeydown: (e) => {
              // Tab処理
              if (e.key === 'Tab') {
                e.preventDefault();
                const start = e.target.selectionStart;
                const end = e.target.selectionEnd;
                const value = e.target.value;
                e.target.value = value.substring(0, start) + '  ' + value.substring(end);
                e.target.selectionStart = e.target.selectionEnd = start + 2;
                collapse(drip(e.target.value)(textChange$));
              }
              // Ctrl+S
              if (e.ctrlKey && e.key === 's') {
                e.preventDefault();
                collapse(drip(null)(manualSave$));
              }
            },
            spellcheck: false
          }
        }
      ],
      $: { class: "editor-container" }
    },
    
    // コンフリクト解決UI
    ConflictResolver({ 
      $hasConflict: remap(s => s === 'conflict')($saveStatus)
    }),
    
    // 自動保存エフェクト
    {
      "fx-effect": autoSaveFlow
    }
  ],
  $: { class: "auto-save-editor" }
}));

// ステータスインジケーター
const StatusIndicator = prime(({ $status }) => ({
  span: [
    remap(status => {
      switch (status) {
        case 'saving': return '⟳';
        case 'saved': return '✓';
        case 'error': return '✗';
        case 'conflict': return '⚠';
      }
    })($status),
    remap(status => status)($status)
  ],
  $: {
    class: remap(status => `status-indicator ${status}`)($status)
  }
}));
```

---
### <a name="example-13"></a>13. 通知システム
**学習ポイント**: トースト通知、スタック管理、自動消去

```typescript
import { stream, hold, accum } from 'blooky-fp';
import { jshtml, prime } from 'blooky-dom';

type NotificationType = 'info' | 'success' | 'warning' | 'error';

interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message?: string;
  duration?: number;
  actions?: { label: string; action: () => void }[];
}

// 通知ストリーム
const notify$ = stream<Notification>();
const dismiss$ = stream<string>();
const dismissAll$ = stream();

// 通知スタック
const $notifications = accum((stack: Notification[], action: any) => {
  if (action.type === 'add') {
    return [...stack, action.notification].slice(-5); // 最大5件
  }
  if (action.type === 'remove') {
    return stack.filter(n => n.id !== action.id);
  }
  if (action.type === 'clear') {
    return [];
  }
  return stack;
}, [])(
  merge()([
    map(n => ({ type: 'add', notification: n }))(notify$),
    map(id => ({ type: 'remove', id }))(dismiss$),
    map(() => ({ type: 'clear' }))(dismissAll$)
  ])
);

// 通知システムコンポーネント
const NotificationSystem = prime(({ $notifications }) => ({
  div: remap(notifications => 
    notifications.map(notification => 
      Toast({
        notification,
        onDismiss: () => collapse(drip(notification.id)(dismiss$))
      })
    )
  )($notifications),
  $: { 
    class: "notification-container",
    "aria-live": "polite"
  }
}));

// トーストコンポーネント
const Toast = prime(({ notification, onDismiss }) => {
  // 自動消去タイマー
  if (notification.duration) {
    setTimeout(() => onDismiss(), notification.duration);
  }
  
  return {
    div: [
      {
        div: [
          { strong: notification.title },
          { button: "×", $: { onclick: onDismiss, class: "dismiss" } }
        ],
        $: { class: "toast-header" }
      },
      notification.message ? { p: notification.message } : null,
      notification.actions ? {
        div: notification.actions.map(action => ({
          button: action.label,
          $: { onclick: action.action }
        })),
        $: { class: "toast-actions" }
      } : null
    ],
    $: { 
      class: `toast toast-${notification.type}`,
      role: "alert"
    }
  };
});

// 使用例：通知ヘルパー
const notificationHelpers = {
  success: (title: string, message?: string) => 
    collapse(drip({
      id: Date.now().toString(),
      type: 'success',
      title,
      message,
      duration: 3000
    })(notify$)),
    
  error: (title: string, message?: string) =>
    collapse(drip({
      id: Date.now().toString(),
      type: 'error',
      title,
      message,
      duration: 5000
    })(notify$)),
    
  confirm: (title: string, message: string, onConfirm: () => void) =>
    collapse(drip({
      id: Date.now().toString(),
      type: 'warning',
      title,
      message,
      actions: [
        { label: 'Cancel', action: () => {} },
        { label: 'Confirm', action: onConfirm }
      ]
    })(notify$))
};
```

---

### <a name="example-14"></a>14. ショッピングカート
**学習ポイント**: 状態の永続化、計算プロパティ、在庫管理

```typescript
import { stream, hold, accum, remap, lift } from 'blooky-fp';
import { jshtml, prime } from 'blooky-dom';

interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
  image: string;
}

interface CartItem {
  product: Product;
  quantity: number;
}

// カートイベント
const addToCart$ = stream<Product>();
const removeFromCart$ = stream<string>();
const updateQuantity$ = stream<{ id: string; quantity: number }>();
const clearCart$ = stream();

// カート状態（localStorage連携）
const loadCartFromStorage = (): CartItem[] => {
  const saved = localStorage.getItem('cart');
  return saved ? JSON.parse(saved) : [];
};

const $cart = accum((cart: CartItem[], action: any) => {
  let updated = cart;
  
  switch (action.type) {
    case 'add':
      const existing = updated.find(i => i.product.id === action.product.id);
      if (existing) {
        updated = updated.map(i => 
          i.product.id === action.product.id 
            ? { ...i, quantity: Math.min(i.quantity + 1, i.product.stock) }
            : i
        );
      } else {
        updated = [...updated, { product: action.product, quantity: 1 }];
      }
      break;
      
    case 'remove':
      updated = updated.filter(i => i.product.id !== action.id);
      break;
      
    case 'updateQuantity':
      updated = updated.map(i => 
        i.product.id === action.id
          ? { ...i, quantity: Math.min(action.quantity, i.product.stock) }
          : i
      );
      break;
      
    case 'clear':
      updated = [];
      break;
  }
  
  // localStorageに保存
  localStorage.setItem('cart', JSON.stringify(updated));
  return updated;
}, loadCartFromStorage())(
  merge()([
    map(product => ({ type: 'add', product }))(addToCart$),
    map(id => ({ type: 'remove', id }))(removeFromCart$),
    map(update => ({ type: 'updateQuantity', ...update }))(updateQuantity$),
    map(() => ({ type: 'clear' }))(clearCart$)
  ])
);

// 計算プロパティ
const $subtotal = remap(cart => 
  cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0)
)($cart);

const $tax = remap(subtotal => subtotal * 0.08)($subtotal);
const $shipping = remap(subtotal => subtotal > 50 ? 0 : 10)($subtotal);
const $total = lift((subtotal, tax, shipping) => 
  subtotal + tax + shipping
)([$subtotal, $tax, $shipping]);

const $itemCount = remap(cart => 
  cart.reduce((sum, item) => sum + item.quantity, 0)
)($cart);

// ショッピングカートUI
const ShoppingCart = prime((context) => ({
  div: [
    // カートヘッダー
    {
      header: [
        { h2: ["Shopping Cart (", $itemCount, " items)"] },
        {
          button: "Clear Cart",
          $: {
            onclick: clearCart$,
            disabled: remap(count => count === 0)($itemCount)
          }
        }
      ]
    },
    
    // カートアイテム
    {
      div: remap(cart => 
        cart.length === 0 
          ? { p: "Your cart is empty" }
          : cart.map(item => 
              CartItem({
                item,
                onRemove: () => collapse(drip(item.product.id)(removeFromCart$)),
                onUpdateQuantity: (q) => collapse(drip({
                  id: item.product.id,
                  quantity: q
                })(updateQuantity$))
              })
            )
      )($cart),
      $: { class: "cart-items" }
    },
    
    // 合計
    {
      div: [
        { div: ["Subtotal: $", remap(v => v.toFixed(2))($subtotal)] },
        { div: ["Tax: $", remap(v => v.toFixed(2))($tax)] },
        { div: ["Shipping: $", remap(v => v.toFixed(2))($shipping)] },
        { hr: null },
        { div: ["Total: $", remap(v => v.toFixed(2))($total)], $: { class: "total" } }
      ],
      $: { class: "cart-summary" }
    },
    
    // チェックアウト
    {
      button: "Proceed to Checkout",
      $: {
        class: "checkout-btn",
        disabled: remap(count => count === 0)($itemCount),
        onclick: () => {
          // チェックアウトフロー
          console.log("Checkout with:", $cart());
        }
      }
    }
  ],
  $: { class: "shopping-cart" }
}));

// カートアイテムコンポーネント
const CartItem = prime(({ item, onRemove, onUpdateQuantity }) => ({
  div: [
    { img: null, $: { src: item.product.image, alt: item.product.name } },
    {
      div: [
        { h3: item.product.name },
        { p: `${item.product.price.toFixed(2)}` }
      ]
    },
    {
      div: [
        {
          button: "-",
          $: {
            onclick: () => onUpdateQuantity(Math.max(1, item.quantity - 1)),
            disabled: item.quantity <= 1
          }
        },
        { span: item.quantity },
        {
          button: "+",
          $: {
            onclick: () => onUpdateQuantity(item.quantity + 1),
            disabled: item.quantity >= item.product.stock
          }
        }
      ],
      $: { class: "quantity-controls" }
    },
    {
      div: `${(item.product.price * item.quantity).toFixed(2)}`,
      $: { class: "item-total" }
    },
    { button: "Remove", $: { onclick: onRemove } }
  ],
  $: { class: "cart-item" }
}));
```

---

### <a name="example-15"></a>15. リアルタイムグラフ
**学習ポイント**: データストリーミング、Canvas/SVG描画、パフォーマンス最適化

```typescript
import { stream, hold, accum, clock } from 'blooky-fp';
import { jshtml, prime } from 'blooky-dom';
import { fx, execute, prepare } from 'blooky-fx';

interface DataPoint {
  timestamp: number;
  value: number;
  label?: string;
}

interface ChartConfig {
  type: 'line' | 'bar' | 'area';
  maxPoints: number;
  yMin: number;
  yMax: number;
  updateInterval: number;
}

// データストリーム
const dataUpdate$ = stream<DataPoint>();
const chartResize$ = stream<{ width: number; height: number }>();
const togglePause$ = stream();

// グラフ状態
const $dataPoints = accum((points: DataPoint[], newPoint: DataPoint) => {
  const updated = [...points, newPoint];
  return updated.slice(-100); // 最新100点を保持
}, [])(dataUpdate$);

const $isPaused = hold(false)(
  map(paused => !paused)(togglePause$)
);

const $chartDimensions = hold({ width: 800, height: 400 })(chartResize$);

// リアルタイムグラフコンポーネント
const RealtimeChart = prime((context) => ({
  div: [
    // コントロールパネル
    {
      div: [
        { h2: "Real-time Performance Monitor" },
        {
          button: remap(paused => paused ? "Resume" : "Pause")($isPaused),
          $: { onclick: togglePause$ }
        },
        {
          span: ["Data points: ", remap(points => points.length)($dataPoints)]
        }
      ],
      $: { class: "chart-controls" }
    },
    
    // SVGグラフ
    {
      svg: remap((points, dimensions) => 
        renderSVGChart(points, dimensions)
      )(lift((a, b) => [a, b])([$dataPoints, $chartDimensions])),
      $: {
        width: remap(d => d.width)($chartDimensions),
        height: remap(d => d.height)($chartDimensions),
        class: "chart-svg"
      }
    },
    
    // 統計情報
    {
      div: [
        { div: ["Min: ", remap(points => {
          if (!points.length) return "N/A";
          return Math.min(...points.map(p => p.value)).toFixed(2);
        })($dataPoints)] },
        { div: ["Max: ", remap(points => {
          if (!points.length) return "N/A";
          return Math.max(...points.map(p => p.value)).toFixed(2);
        })($dataPoints)] },
        { div: ["Avg: ", remap(points => {
          if (!points.length) return "N/A";
          const avg = points.reduce((sum, p) => sum + p.value, 0) / points.length;
          return avg.toFixed(2);
        })($dataPoints)] }
      ],
      $: { class: "chart-stats" }
    },
  ]
}));

```