import { stream, hold, map, filter, merge } from '../blooky-fp';
import { prime } from '../blooky-dom';
import { JSHTMLNodeSource } from '../blooky-dom-types';
import { CollapseObserver, Dripper, Prop } from '../blooky-types';

// 検索APIが返す結果セット
type SearchResult = { id: number, title: string }[];

// UI
type SearchBoxContext = {
  searchInput$: Dripper<Event>
  searchDone$: Dripper<SearchResult>
  searchRunning$: Dripper<boolean>
  $searchTerm: Prop<string>
  $searchStatus: Prop<JSHTMLNodeSource>
  $searchAPIIgnite: Prop<CollapseObserver|"none">
}

// コンポーネント宣言
const SearchBox = prime(({
  $searchTerm,
  searchInput$,
  searchRunning$,
  $searchStatus,
  $searchAPIIgnite,
  searchDone$
}: SearchBoxContext) => ({
  div: [
    { h2: "Live Search" },
    { input: null,
      $: {
        type: "search",
        placeholder: "Type to search...",
        oninput: searchInput$
      }
    },
    { div: $searchStatus },
    { "fx-effect": [
        { "fx-collapse": null, $: { dripper: searchRunning$, value: "true" } },
        { "fx-call": null, $: { fn: searchAPI, arg: $searchTerm, id: "searchResult" } },
        { "fx-collapse": null, $: { dripper: searchDone$, value: "#searchResult" } }
    ], $: { ignite: $searchAPIIgnite }}
  ]
}));

// debounce付きの検索ストリーム
const searchInput$ = stream<Event>({ type: 'debounce', delay: 300 });
// 2文字以上の入力値が発生したストリームとして変換
const termUpdated$ = filter<string>((term)=>term.length>=2)
    (map<string,Event>((e)=>(e.target as HTMLInputElement).value)(searchInput$));
// 検索文字列のProp
const $searchTerm = hold("")(termUpdated$);
// 検索開始イベントのストリーム
const searchRunning$ = stream<boolean>();
// 検索API（モック）
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

// サーチAPIの実行タイミング制御
const $searchAPIIgnite = hold<CollapseObserver|"none">("none")(merge([
    map(()=>"quantum" as const)(termUpdated$),
    map(()=>"none" as const)(searchDone$)
]));

// サーチ状況に応じたメッセージ、結果のProp
const $searchStatus = hold<JSHTMLNodeSource>({ p: "input search term" })(merge<JSHTMLNodeSource>([
    map(({ p: "input search term" }))(termUpdated$),
    map(({ p: "search started..." }))(searchRunning$),
    map((results: SearchResult)=>({ ul: results.map((r)=>({ li: r.title })) }))(searchDone$)
]));

export const createSearchBox = () => SearchBox({
  $searchTerm,
  searchInput$, 
  searchRunning$,
  $searchStatus,
  $searchAPIIgnite,
  searchDone$
})