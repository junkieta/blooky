// blooky-fx.test.ts
import type { FxNode, AppContext, ExecContext, FxExecutionContext, INodeDefinition, FxNodeType, FxRef } from '../fx/types';

// =================================================================
// --- モックのセットアップ ---
// 
// `blooky-fx.ts`は`nodeDefinitionMap`に依存しているため、
// テスト用にシンプルな振る舞いをするモックのNode定義を作成します。
// =================================================================

// モック用のNode型
type MockDoNode = FxNode & { type: 'do', run: (...args: any[]) => any, args?: any[] };
type MockSequenceNode = FxNode & { type: 'sequence', steps: FxNode[] };
type MockContextNode = FxNode & { type: 'context', value: any };
type MockFxNode = MockDoNode|MockSequenceNode|MockContextNode;
type MockFxNodeType = MockFxNode["type"];

interface MockINodeDefinition<T extends MockFxNodeType> extends INodeDefinition<any> {
  readonly type: T;
  factory(...args: any[]): Extract<MockFxNode, { type: T }>;
  step(
    context: FxExecutionContext & { node: Extract<MockFxNode, { type: T }> }
  ): Generator<MockFxNode, any, any>;
  getChildNodes(node: Extract<FxNode, { type: T }>) : null|MockFxNode[]
  handle(
    context: FxExecutionContext & { node: Extract<MockFxNode, { type: T }> }
  ): Promise<any>;
}

// モックNode定義の基底クラス (ユーザー提供のコードを参考に作成)
abstract class MockNodeDefinition<T extends MockFxNode> implements MockINodeDefinition<T['type']> {
    abstract readonly type: T['type'];
    abstract factory(...args: any[]): T;
    getChildNodes(node: T): MockFxNode[] | null { return null; }
    handle(context: FxExecutionContext & { node: T }): any {
        throw new Error(`Node type "${this.type}" does not have a direct handler.`);
    }
    *step({ node }: FxExecutionContext & { node: T }): Generator<FxNode, any, any> {
        return yield node;
    }
}

// 1. 'do' Node: 単純な関数実行
const doMockHandler = jest.fn();
class DoNodeDef extends MockNodeDefinition<MockDoNode> {
    readonly type = 'do';
    factory(props: Omit<MockDoNode, 'type'>): MockDoNode { return { type: 'do', ...props }; }
    async handle({ node, context }: FxExecutionContext & { node: MockDoNode }): Promise<any> {
        const fn = await context.resolve(node.run);
        const args = (node.args || []).map(arg => context.resolve(arg)());
        doMockHandler(fn, args);
        return fn(...args);
    }
}

// 2. 'sequence' Node: 子ノードを順番に実行
class SequenceNodeDef extends MockNodeDefinition<MockSequenceNode> {
    readonly type = 'sequence';
    factory(props: Omit<MockSequenceNode, 'type'>): MockSequenceNode { return { type: 'sequence', ...props }; }
    getChildNodes(node: MockSequenceNode) { return node.steps; }
    *step({ run, node }: FxExecutionContext & { node: MockSequenceNode }): Generator<FxNode, any, any> {
        const results = [];
        for (const step of node.steps) {
            results.push(yield* run(step));
        }
        return results;
    }
}

// 3. 'context' Node: 固定値を返す
class ContextNodeDef extends MockNodeDefinition<MockContextNode> {
    readonly type = 'context';
    factory(props: Omit<MockContextNode, 'type'>): MockContextNode { return { type: 'context', ...props }; }
    handle({ node }: FxExecutionContext & { node: MockContextNode }) {
        return node.value;
    }
}

// `nodeDefinitionMap`をモックし、上記で作成した定義を登録します
const mockNodeDefinitionMap = new Map<string, INodeDefinition<any>>([
    ['do', new DoNodeDef()],
    ['sequence', new SequenceNodeDef()],
    ['context', new ContextNodeDef()],
]);

// Jestにモジュールをモックするよう指示
// './fx/nodes'の部分は、`nodeDefinitionMap`をエクスポートしている実際のファイルパスに置き換えてください
jest.mock('../fx/nodes', () => ({
    nodeDefinitionMap: mockNodeDefinitionMap,
}));

import { fx, prepare, execute, query, ref, isFxRef, createCancelToken } from '../blooky-fx';
import { blooky } from '../blooky-fp';
import { RETURN_VALUE } from '../fx/nodes/return'; // For testing initial context



// --- テストコード本体 ---

describe('blooky-fx.ts', () => {

    // モック`fx`オブジェクトの作成
    // 本来は動的に構築されるが、テストではモック定義を使って手動で作成
    const fx = {
        do: new DoNodeDef().factory,
        sequence: new SequenceNodeDef().factory,
        context: new ContextNodeDef().factory,
    };

    beforeEach(() => {
        // 各テストの前にモック関数の呼び出し履歴をリセット
        doMockHandler.mockClear();
    });

    describe('ref() and isFxRef()', () => {
        test('ref() should create a valid reference object', () => {
            const myRef: FxRef<any> = ref('myKey');
            expect(isFxRef(myRef)).toBe(true);
            expect(myRef.key).toBe('myKey');
        });

        test('isFxRef() should return false for non-ref objects', () => {
            expect(isFxRef({ key: 'myKey' })).toBe(false);
            expect(isFxRef(() => 'value')).toBe(false);
            expect(isFxRef('myKey')).toBe(false);
        });
    });

    describe('prepare()', () => {
        test('should prepare an execution context without errors for valid flow', () => {
            const appContext = { myAction: () => 'done' };
            const flow = fx.do({ run: ref('myAction') });
            const prepared = prepare(flow, appContext);

            expect(prepared).toBeDefined();
            expect(prepared.rootNode).toBe(flow);
            expect(prepared.appContext.myAction).toBeDefined();
            expect(prepared.execContext.cancelToken).toBeDefined();
        });

        test('should throw a BlookyError for missing context keys', () => {
            const flow = fx.do({ run: ref('unprovidedAction') });
            
            // `prepare`が特定のエラーをスローすることを検証
            expect(() => prepare(flow, {})).toThrow(blooky.error('dev-config', {  } as any).constructor);
            
            try {
                prepare(flow, {});
            } catch (e: any) {
                expect(e.category).toBe('dev-config');
                expect(e.cause.code).toBe('MISSING_CONTEXT_KEYS');
                expect(e.cause.missingKeys).toEqual(['unprovidedAction']);
            }
        });

        test('should correctly proxy and seal the local record for node IDs', () => {
            const flow = fx.do({ id: 'step1', run: () => {} });
            const prepared = prepare(flow, {});
            
            // #step1 は存在するが、値は未解決
            expect('#step1' in prepared.appContext).toBe(true);
            
            // シールされているので、新しいプロパティは追加できない
            expect(() => { prepared.appContext['#newId'] = 'test'; }).toThrow();
        });
    });

    describe('execute() and query()', () => {
        test('should execute a simple "do" node', async () => {
            const myAction = jest.fn(() => 42);
            const flow = fx.do({ run: myAction });

            const handle = execute(prepare(flow, {}));
            const finalContext = await handle.done;
            
            expect(myAction).toHaveBeenCalledTimes(1);
        });

        test('query() should execute a flow and resolve values from context', async () => {
            const myService = { perform: jest.fn(() => 'result') };
            const flow = fx.do({ run: ref('service.perform') });

            await query(flow, { 'service.perform': myService.perform }).done;

            expect(myService.perform).toHaveBeenCalledTimes(1);
        });
        
        test('should execute a sequence of nodes in order', async () => {
            const order: string[] = [];
            const action1 = () => order.push('first');
            const action2 = () => order.push('second');
            const flow = fx.sequence({
                steps: [fx.do({ run: action1 }), fx.do({ run: action2 })]
            });
            
            await query(flow, {}).done;
            
            expect(order).toEqual(['first', 'second']);
        });

        test('should store and allow referencing results of nodes with IDs', async () => {
            const flow = fx.do({ id: 'data', run: (data: number) => data * 2, args: [100] } as any);
            const finalContext = await query(flow, {}).done;
            expect(finalContext['#data']).toBe(200);
        });

        test('should be cancellable', async () => {
            const action1 = jest.fn();
            const action2 = jest.fn();
            // action1は実行されるが、action2はキャンセルされて実行されない
            const flow = fx.sequence({ steps: [fx.do({ run: action1 }), fx.do({ run: action2 })] });

            const handle = query(flow, {});
            handle.cancel(); // 即座にキャンセル

            await handle.done;

            // フローがキャンセルされるタイミングによるが、少なくともaction2は呼ばれない
            expect(action2).not.toHaveBeenCalled();
        });
    });

    describe('createCancelToken', () => {
        test('should manage cancellation state', () => {
            const token = createCancelToken();
            expect(token.cancelled()).toBe(false);
            token.cancel();
            expect(token.cancelled()).toBe(true);
        });

        test('should propagate cancellation from parent to child', () => {
            const parent = createCancelToken();
            const child = createCancelToken(parent);

            expect(child.cancelled()).toBe(false);
            parent.cancel();
            expect(child.cancelled()).toBe(true);
        });

        test('should not propagate cancellation from child to parent', () => {
            const parent = createCancelToken();
            const child = createCancelToken(parent);

            child.cancel();
            expect(child.cancelled()).toBe(true);
            expect(parent.cancelled()).toBe(false);
        });
    });
});