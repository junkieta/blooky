/**
 * @jest-environment jsdom
 */
// blooky-fxdom.test.ts

import { jshtml } from '../blooky-dom';
import { fxdom, EffectElementTagNameMap, FxEffectElement } from '../blooky-fxdom'; // テスト対象
import { prepare, execute, fx, ref } from '../blooky-fx'; // 依存モジュール
import { FxCollapseElement } from '../blooky-fxdom';
import { FxCollapseNode } from '../fx/types';

// ---- モックのセットアップ ----

// FxEffectElementが呼び出すコア関数をモック化
jest.mock('../blooky-fx', () => {
    const original = jest.requireActual('../blooky-fx');
    return {
        ...original,
        prepare: jest.fn((...args) => original.prepare(...args)),
        execute: jest.fn((preparedFx) => ({
            cancel: jest.fn(),
            done: new Promise(() => {}), //
        })),
    };
});

// FxIncludeElementが使う `fetch` をグローバルにモック
global.fetch = jest.fn();

describe('blooky-fx-dom.ts', () => {
    
    // 全てのテストの前に、カスタムエレメントを一度だけ定義する
    beforeAll(() => {
        fxdom.defineEffectElements();
    });

    // 各テストの前にDOMとモックをクリーンアップ
    beforeEach(() => {
        document.body.innerHTML = '';
        (prepare as jest.Mock).mockClear();
        (execute as jest.Mock).mockClear();
        (global.fetch as jest.Mock).mockClear();
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });
    
    // =================================
    //  各EffectElementのtoFxNode()メソッドのテスト
    // =================================
    describe('EffectElement toFxNode() Conversion', () => {

        it('<fx-sequence> should convert to a sequence node', () => {
            const el = jshtml({ "fx-sequence": [{ "fx-call": null, $: { fn: "a" } }] });
            const node = (el as any).toFxNode();
            expect(node.type).toBe('sequence');
            expect(node.steps).toHaveLength(1);
            expect(node.steps[0].type).toBe('call');
        });

        it('<fx-call> should convert attributes to a call node', () => {
            const el = jshtml({ "fx-call": null, $: { fn: "myFunc", arg: "myArg", id: "c1" } });
            const expectedNode = fx.call(ref("myFunc"), { arg: ref("myArg"), id: "c1" });
            expect((el as any).toFxNode()).toEqual(expect.objectContaining(expectedNode));
        });

        it('<fx-if> should convert to a condition node', () => {
            const el = jshtml({ "fx-if": [
                { "fx-sequence": null, $: { slot: "then" } },
                { "fx-sequence": null, $: { slot: "else" } },
            ], $: { when: "isReady" }});
            const node = (el as any).toFxNode();
            expect(node.type).toBe('condition');
            expect(node.if).toEqual(ref('isReady'));
            expect(node.then).toBeDefined();
            expect(node.else).toBeDefined();
        });

        it('<fx-loop> should convert to a loop node with options', () => {
            const el = jshtml({ "fx-loop": null, $: { while: "isLooping", "max-iterations": "10" } });
            const node = (el as any).toFxNode();
            expect(node.type).toBe('loop');
            expect(node.cond).toEqual(ref('isLooping'));
            expect(node.maxIterations).toBe(10);
        });

        it('<fx-collapse> should convert to a collapse node', () => {
            const el = jshtml({ "fx-collapse": null, $: { dripper: "myStream", value: "myValue" } });
            const node = (el as any).toFxNode();
            expect(node.type).toBe('collapse');
            expect(node.dripper).toEqual(ref('myStream'));
            expect(node.value).toEqual(ref('myValue'));
        });
        
        it('<fx-collapse> should use text content as value if attribute is missing', () => {
            const el = document.createElement('fx-collapse') as FxCollapseElement;
            el.setAttribute('dripper', 'myStream');
            el.textContent = ' "hello world" '; // JSONとしてパース
            const node = el.toFxNode() as FxCollapseNode;
            expect(node.type).toBe('collapse');
            expect(node.value).toBe('hello world');
        });
    });

    // =================================
    //  FxEffectElementのライフサイクル
    // =================================
    describe('FxEffectElement Lifecycle', () => {

        it('should call prepare and execute on connectedCallback', async () => {
            const el = jshtml({ "fx-effect": [] });
            document.body.appendChild(el);
            
            // connectedCallback内のqueueMicrotaskを実行
            await jest.runAllTicks();
            
            expect(prepare).toHaveBeenCalledTimes(1);
            expect(execute).toHaveBeenCalledTimes(1);
        });

        it('should NOT execute if ignite="none" is present', async () => {
            const el = jshtml({ "fx-effect": null, $: { ignite: "none" } });
            document.body.appendChild(el);
            await jest.runAllTicks();

            expect(prepare).toHaveBeenCalledTimes(1); // prepareは呼ばれる
            expect(execute).not.toHaveBeenCalled();
        });

        it('should call handle.cancel on disconnectedCallback', async () => {
            const mockCancel = jest.fn();
            (execute as jest.Mock).mockReturnValue({ cancel: mockCancel, done: new Promise(() => {}) });

            const el = jshtml({ "fx-effect": [] }) as FxEffectElement;
            document.body.appendChild(el);
            await jest.runAllTicks();

            el.remove(); // DOMから削除 -> disconnectedCallback
            
            expect(mockCancel).toHaveBeenCalledTimes(1);
        });
    });
    
    // =================================
    //  FxContextElementのコンテキスト管理
    // =================================
    describe('FxContextElement Management', () => {

        it('should retrieve values from its own context', () => {
            const el = document.createElement('fx-context') as import('../blooky-fxdom').FxContextElement;
            el.setContext({ myKey: 'myValue' });
            expect(el.getContextValue('myKey')).toBe('myValue');
        });

        it('should retrieve values from parent context', () => {
            const parent = document.createElement('fx-context') as import('../blooky-fxdom').FxContextElement;
            const child = document.createElement('fx-context') as import('../blooky-fxdom').FxContextElement;
            parent.appendChild(child);
            
            parent.setContext({ parentKey: 'parentValue' });
            
            expect(child.getContextValue('parentKey')).toBe('parentValue');
        });

        it('should prioritize its own context over parent context', () => {
            const parent = document.createElement('fx-context') as import('../blooky-fxdom').FxContextElement;
            const child = document.createElement('fx-context') as import('../blooky-fxdom').FxContextElement;
            parent.appendChild(child);
            
            parent.setContext({ key: 'fromParent' });
            child.setContext({ key: 'fromChild' });
            
            expect(child.getContextValue('key')).toBe('fromChild');
        });
    });
    
    // =================================
    //  FxIncludeElementの外部ファイル読み込み
    // =================================
    describe('FxIncludeElement', () => {

        it('should fetch and render content from a src attribute', async () => {
            const mockFlow = [{ "fx-call": null, $: { fn: "test" } }];
            (fetch as jest.Mock).mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(mockFlow),
            });
            
            const el = document.createElement('fx-include') as import('../blooky-fxdom').FxIncludeElement;
            el.setAttribute('src', '/test.json');
            
            document.body.appendChild(el);
            
            // fetchとjson()のPromiseを解決
            await Promise.resolve();
            await Promise.resolve();

            expect(fetch).toHaveBeenCalledWith('/test.json', expect.anything());

            // 中身が正しくレンダリングされたか（<fx-call>が作られているか）
            expect(el.firstElementChild?.tagName.toLowerCase()).toBe('fx-call');
        });

        it('should clear content if fetch fails', async () => {
            (fetch as jest.Mock).mockResolvedValue({ ok: false });
            jest.spyOn(console, 'error').mockImplementation(() => {}); // console.errorを抑制
            
            const el = document.createElement('fx-include') as import('../blooky-fxdom').FxIncludeElement;
            el.innerHTML = '<fx-call fn="old"></fx-call>'; // 既存のコンテンツ
            el.setAttribute('src', '/fail.json');

            document.body.appendChild(el);
            await Promise.resolve();

            expect(el.children.length).toBe(0); // コンテンツが空になっている
            (console.error as jest.Mock).mockRestore();
        });
    });
});