/**
状態 (Prop):
    $mapTiles: マップ全体の地形データを保持する配列。{ terrain: 'plain', owner: 'Red', building: 'city' }のようなオブジェクトの集まり。
    $units: 全ユニットの配列。{ id: 'u1', type: 'tank', owner: 'Red', hp: 10, x: 5, y: 3, hasMoved: false }のようなオブジェクトの集まり。
    $turn: 現在のターン数。
    $currentPlayer: 'Red' | 'Blue'。
    $funds: 各プレイヤーの資金を保持するオブジェクト。{ Red: 5000, Blue: 4800 }。
    $selectedUnit: プレイヤーが現在選択しているユニットのID。
    $gameState: 'unit-selection' | 'move-selection' | 'action-selection' | 'enemy-turn'。ゲームのフェーズを管理します。
イベント (Stream):
    tileClick$: プレイヤーがマップ上のタイルをクリックしたイベント。ペイロードは{ x, y }。
    menuCommand$: 「生産」「待機」「攻撃」などのメニューコマンドが選択されたイベント。ペイロードは{ command: 'produce', unitType: 'infantry' }。
    endTurn$: ターン終了ボタンが押されたイベント。
*/

import { stream, pipe, filter, map, hold, DripperStream, Prop, junction, lift } from "../blooky-fp";
import { prime } from "../blooky-fv"

type Point = { x:number, y:number }
type GameState = 'unit-selection' | 'move-selection' | 'action-selection' | 'enemy-turn';

const $mapTiles = { terrain: 'plain', owner: 'Red', building: 'city' };
const $units = { id: 'u1', type: 'tank', owner: 'Red', hp: 10, x: 5, y: 3, hasMoved: false }
const $turn = {};
const $currentPlayer: 'Red' | 'Blue' = 'Red';
const $funds: { Red: number, Blue: number };
const $selectedUnit: {}
const $gameState = hold<GameState>("unit-selection")(stream());

const tileClick$ : DripperStream<Point> = stream();
const menuCommand$: DripperStream<{ command: 'produce', unitType: 'infantry' }> = stream();
const endTurn$ = stream();

junction<GameState,Point>({
  
  'unit-selection': // クリックされた位置のユニットを探す
    filter<Point>(({ x, y }) => existsUnitAt(x, y, $units()))(tileClick$),

  'move-selection':// 選択中のユニットが移動可能か検証するロジック
    filter<Point>(({ x, y }) => isValidMove($selectedUnit(), x, y))(tileClick$),

  'action-selection': // メニューから特定のアクションを選択している
    filter<Point>(({ x, y }) => false)(tileClick$),
    
  'enemy-turn': // コンピューター側の動作中
    filter<Point>(({ x, y }) => false)(tileClick$),

})($gameState);

// `selectUnit$`がdripされたら、$selectedUnit Propを更新し、gameStateを'move-selection'に変える
hold(null, map(unit => {
    $selectedUnit.set(unit.id);
    $gameState.set('move-selection');
})(selectUnit$));

// `selectDestination$`がdripされたら、ユニットを移動させる
hold(null, map(destination => {
    moveUnit($selectedUnit(), destination); // 副作用を伴うロジック
    $gameState.set('action-selection');
})(selectDestination$));

// ゲームボード全体を描画
export const GameBoard = prime((ctx) => [
  // マップタイルとユニットを重ねて表示
  { div:
    { svg: lift(([tiles, units, selectedUnitId]) => [
        // 地形を描画
        tiles.map(tile => renderTile(tile)),
        // ユニットを描画
        units.map(unit => renderUnit(unit)),
        // 選択中のユニットの移動可能範囲などをハイライト表示
        renderMoveRange(selectedUnitId, units, tiles),
      ])([ctx.$mapTiles, ctx.$units, ctx.$selectedUnit]),
      $: { width: 512, height: 512, viewBox: "0 0 256 256" },
    },
    $: { class: "game-board" }
  },
  // ユニット情報やメニューなどのUI
  { div: [],
    $: { class: "game-ui" } 
  }
]);


const e = 
{ "fx-effect":
  { "fx-loop": [
    { "fx-context":
      { "fx-loop": [
        { "fx-wait": null, $: { until: "endTurn$" } },
        { "fx-call": null, $: { fn: "calculateIncome" } },
        { "fx-call": null, $: { fn:"() => $currentPlayer.set('Blue')" } }
        ],
        $: {
          while: "map(p => p === 'Red')($currentPlayer)" 
        }
      },
      $: {id: "player-turn"}
    },
    { "fx-context":
      { "fx-if": 
        { "fx-sequence": [
          { "fx-collapse": null, $: { dripper: "$statusMessage", value:"'Enemy Turn'" } },
          { "fx-wait": null, $: { ms: "1000" } }, 
          { "fx-call": null, $: { fn: "enemyAI.takeTurn", arg:"$gameState", id:"enemyActions" } },
          { "fx-loop": [
            { "fx-call": null, $: { fn: "animateUnitMove", arg:"ref('currentItem')" } },
            { "fx-wait": null, $: { ms: "500" } },
            { "fx-call": null, $: { fn: "() => $currentPlayer.set('Red')" } }
            ],
            $: {
              in: "ref('#enemyActions')"          
            }
          }
          ]
        },
        $: { when: "map(p => p === 'Blue')($currentPlayer)" }
      },
      $: { id: "enemy-turn" }
    }
    ],
    $: { while:"map(s => s !== 'game-over')($gameState)" }
  }
};
