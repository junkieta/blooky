// -- 0. 事前ロード ---
import { stream, accum, merge, hold, map, remap, when, pipe, PromisedProp, filter } from "./blooky-fp";
import { jshtml, mutations, prime } from "./blooky-fv";
import { fxdom,EffectElementTagNameMap, dumpGraphDOT } from "./blooky-devtools";
// dot視覚化用にviz
import { instance as viz_instance } from "@viz-js/viz";
import { BlookyMutationEvent, JSHTMLNodeSource } from "./blooky-fv-types";
import { DripperStream, Prop } from "./blooky-types";


// New: import DebugController and debugMiddleware
import DebugController from "./fx/debugger";
import { debugMiddleware } from "./blooky-devtools";

// debuggerとしてdefine
fxdom.defineEffectElements(EffectElementTagNameMap);

// create a global debug controller for the demo
const debugCtrl = new DebugController();

// function to attach debugController to every fx-effect element in the page and expose controls
function attachDevtoolsToEffects() {

    const hasEffectClosest = (n: Node) => {
        if(n.nodeType !== 1) return n.parentElement ? hasEffectClosest(n.parentElement) : false;
        return (n as Element).closest("fx-effect") !== null || (n as Element).querySelector("fx-effect") !== null;
    };

    const effectMutations = filter((evt: BlookyMutationEvent)=>
        evt.detail.records.some((record)=> Array.from(record.addedNodes).some(hasEffectClosest) || Array.from(record.removedNodes).some(hasEffectClosest))
    )(mutations({ childList: true, subtree: true })(document.body));

    const $effectElements = hold([])(
        map((evt:BlookyMutationEvent)=>{
            const effects = (evt.currentTarget as HTMLElement).getElementsByTagName('fx-effect');
            return Array.from(effects).map((el, idx)=>{
                const fxEl = el as any;

                
                // inject _execContext.debugController so prepare/execute will see it
                fxEl._execContext = { ...(fxEl._execContext || {}), debugController: debugCtrl, middlewares: [debugMiddleware] };

                try {

                    const hasDebugMiddleware = fxEl._preparedFx?.execContext?.middlewares?.includes?.(debugMiddleware);
                    if (!hasDebugMiddleware) {
                        // re-prepare with force to recreate execContext containing debugMiddleware
                        fxEl.prepare(true);
                        // If there is a running handle and you want to debug the running flow, restart it:
                        // const prevHandle = fxEl._handle;
                        // if(prevHandle) {
                        //   prevHandle.cancel(); // cancel previous run
                        //   fxEl.execute();      // restart (will use new execContext with debugMiddleware)
                        // }
                    }

                    const prepared = fxEl._preparedFx || fxEl.prepare();
                    const execId = prepared.execContext.executionId;
                    return {
                        div: [
                            { div: [
                                `fx-effect #${idx} `,
                                { code: execId, $: { style: { color: '#9AE6B4' } } }
                                ],
                                $: {
                                    id: `blooky-debug-fx-effect-${idx}`,
                                    style: { fontSize: '12px' }
                                }
                            },
                            { div: [
                                { button: "Pause", $: { type: "button", dataset: { exec: execId, action: "pause" } } },
                                { button: "Resume", $: { type: "button", dataset: { exec: execId, action: "resume" } } },
                                { button: "Step Into", $: { type: "button", dataset: { exec: execId, action: "step-into" } } },
                                { button: "Step Over", $: { type: "button", dataset: { exec: execId, action: "step-over" } } }
                                ],
                                $: { 
                                    id: `blooky-debug-fx-effect-${idx}-controls`,
                                    style: { marginTop: '4px' },
                                    onclick: clickToDebugAction
                                }
                            }
                        ],
                        $: {
                            style: { marginTop: '6px' }
                        }
                    };
                } catch(e) {
                // prepare may fail if context missing; ignore
                }
            })
        })(effectMutations)
    );

    const panel = prime(()=>({
      div: [
        { strong: "Blooky Debug" },
        { div: $effectElements, $: { id: "blooky-debug-list" } }
      ],
      $: {
        id: 'blooky-debug-panel',
        style: {
          position: 'fixed',
          right: '12px',
          bottom: '12px',
          background: 'rgba(0,0,0,0.8)',
          color: '#fff',
          padding: '8px',
          borderRadius: '6px',
          zIndex: '99999'
        }
      }
    }))(undefined) as HTMLElement;

    function clickToDebugAction (ev: MouseEvent) {
        const actionable = (ev.target as HTMLElement)?.closest('[data-action]') as HTMLElement | null;
        if(!actionable) return;
        const action = actionable.dataset.action!;
        const shownExec = actionable.dataset.exec!;
        // find the corresponding fx-effect element (we stored one in the row earlier)
        const row = actionable.closest('[id^="blooky-debug-fx-effect-"]')!;
        const fxEl = (row as any).__fxEffectElement as any;

        // Ensure prepared exists and uses debug middleware
        if(!fxEl._preparedFx || !fxEl._preparedFx.execContext?.middlewares?.includes(debugMiddleware)) {
            // re-prepare to attach debug middleware
            fxEl._execContext = { ...(fxEl._execContext||{}), debugController: debugCtrl, middlewares: [debugMiddleware] };
            try {
            fxEl.prepare(true);
            } catch(e) {
            console.warn('prepare failed (context may be missing)', e);
            }
        }

        const actualExecId = fxEl._preparedFx?.execContext?.executionId;
        if(!actualExecId) {
            console.warn('Effect not prepared. Click Prepare/Start first.');
            return;
        }

        if(action === 'pause') debugCtrl.pauseExecution(actualExecId);
        if(action === 'resume') debugCtrl.resumeExecution(actualExecId);
        if(action === 'step-into') debugCtrl.stepExecution(actualExecId, 'into');
        if(action === 'step-over') debugCtrl.stepExecution(actualExecId, 'over');
    }
    return panel;

}

const debug_panel = attachDevtoolsToEffects();

// --- 1. アプリケーションの状態定義 (Props and Streams) ---
// 見分けのため、DripperStreamは名称+"$", Propは"$"+名称として命名している。
const increment$ = stream();
const decrement$ = stream();
const save$ = stream();
const $triggerSave = hold(false)(map(()=>true)(save$));

const statusMessageStream$ = stream<string>();
const changeCountStream = merge([map(() => 1)(increment$), map(() => -1)(decrement$)],((a,b)=>a+b));
const $count = accum((current: number, val: number) => current + val, 0)(changeCountStream);
const $statusMessage = hold('Ready.')(statusMessageStream$);
const $finalMessage = remap<number,string>((v) => `Saved Count:${v}`)($count);

const $colorOfCount = remap<number,string>((count)=>count % 3 ? "blue" : "red")($count);


// confirmの呼び出しを別ツリーのフローとして宣言
const confirmQuestionActivated$ = stream<string>();
const confirmButtonClicked$ = stream<MouseEvent>();
const $selectedConfirmAnswer = pipe(
    confirmButtonClicked$,
    map((evt)=>(evt.target as HTMLButtonElement).value),
    hold("yet")
);

const $confirmAnswerResolved = when<string>((answer)=>answer !== "yet")($selectedConfirmAnswer);

const $confirmQuestionDialogbox = hold<JSHTMLNodeSource>(null)(map<JSHTMLNodeSource, string>((text)=>[
    { p: text },
    { button: "OK", $: { onclick: confirmButtonClicked$, value: "yes" } },
    { button: "Cancel", $: { onclick: confirmButtonClicked$, value: "no" } },
])(confirmQuestionActivated$));

const context = {
    increment$,
    decrement$,
    save$,
    $triggerSave,
    statusMessageStream$,
    changeCountStream,
    $count,
    $colorOfCount,
    $statusMessage,
    $finalMessage,
    confirmQuestionActivated$,
    $selectedConfirmAnswer,
    $confirmAnswerResolved,
    $confirmQuestionDialogbox,
    log: (s:unknown)=>console.log(s),
};

// --- 2. UIの定義 (jshtml) ---
interface AppUIContext {
    $count: Prop<number>
    increment$: DripperStream<void>
    decrement$: DripperStream<void>
    save$: DripperStream<void>
    $statusMessage: Prop<JSHTMLNodeSource>
    $confirmQuestionDialogbox: Prop<JSHTMLNodeSource>
}

const AppUIRenderer = prime(({$count,increment$,decrement$,save$,$statusMessage,$confirmQuestionDialogbox}:AppUIContext) => ({
  div: [
    // 状態(Prop)をUIにバインド
    { p: ["Count: ", $count], $: { style: { color: $colorOfCount } } },
    // イベントをStreamに接続
    { button: "+", $: { onclick: increment$ } },
    { button: "-", $: { onclick: decrement$ } },
    { button: "Save", $: { onclick: save$, style: { marginLeft: '1em' } } },
    // 副作用の状態を表示
    { div: $statusMessage, $: { id: "status" } },
    { aside: $confirmQuestionDialogbox }
  ]
}));



// --- 副作用フローの宣言的な定義 (fxdom) ---
interface EffectContext {
    confirmQuestionActivated$: DripperStream<string>,
    $confirmAnswerResolved: PromisedProp<string>,
    $selectedConfirmAnswer: Prop<string>,
    $triggerSave: Prop<boolean>,
    statusMessageStream$: DripperStream<string>,
    $finalMessage: Prop<string>,
    save$: DripperStream<void>
}

const EffectRenderer = prime(({
    confirmQuestionActivated$,
    $confirmAnswerResolved,
    $selectedConfirmAnswer,
    $triggerSave,
    statusMessageStream$,
    $finalMessage,
    save$
}:EffectContext) => ({
    "fx-effect": 
    [
        { "fx-context": [
            { "fx-collapse": jshtml.$({ dripper: confirmQuestionActivated$, value: "$_" }) },
            { "fx-wait": jshtml.$({ until: $confirmAnswerResolved }) },
            { "fx-return": jshtml.$({ value: $selectedConfirmAnswer }) }
            ],
            $: { id: "fxConfirm" }
        },
        { "fx-wait": jshtml.$({ "until": $triggerSave }) },
        // 1. 確認メッセージを表示
        { "fx-yield": '"Confirmation needed: Save this count?"', $: { for: "#fxConfirm", id: "confirmResult" } },
        { "fx-switch": [
            // "yes"の場合のフロー
            { "fx-sequence": [
                { "fx-collapse": '"Saving..."', $: { dripper: statusMessageStream$ } },
                { "fx-wait": jshtml.$({ ms: 1500 }) },
                { "fx-collapse": jshtml.$({ dripper: statusMessageStream$, value: $finalMessage }) },
                { "fx-call": '"save complete"', $: { fn: "log" } },
                ], 
                $: { slot: "yes" }
            },
            // "no"またはdefaultの場合のフロー
            { "fx-collapse": '"Save cancelled."',
                $: { slot: "default", "dripper": statusMessageStream$ } }
            ],
            $: { by: "#confirmResult" }
        }
    ],
    $: { "onsave": save$, ignite: "quantum" },
}));

// Stream/Prop構造のdot
const dot = dumpGraphDOT(context);

const renderDot = async (dot: string) => {
    const viz = await viz_instance();
    return viz.renderSVGElement(dot);
}

// --- 3. アプリケーションのマウント ---

// UIをDOMにマウントする
document.body.append(
    debug_panel,
    AppUIRenderer(context),
    EffectRenderer(context),
    jshtml([renderDot(dot)/* jshtmlはPromiseを透過的に処理する */, { pre: dot }]),
);
    