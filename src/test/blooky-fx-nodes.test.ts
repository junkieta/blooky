// fx-nodes.test.ts

import {
    CallNodeDefinition,
    CollapseNodeDefinition,
    ConditionNodeDefinition,
    ContextNodeDefinition,
    LoopNodeDefinition,
    NoneNodeDefinition,
    ParallelNodeDefinition,
    RaceNodeDefinition,
    ReturnNodeDefinition,
    SequenceNodeDefinition,
    SwitchNodeDefinition,
    WaitNodeDefinition,
    YieldNodeDefinition
} from '../fx/nodes/'; // テスト対象のNode定義クラスをインポート（パスは要調整）

import { stream, hold, collapse as coreCollapse, drip as coreDrip} from "../blooky-fp";// コア機能と型
import { query, ref, fx as coreFx, FxRef } from '../blooky-fx'; 
import { RETURN_VALUE } from '../fx/nodes/return';
import { FxContextNode, FxNode } from '../fx/types';

// `collapse`ノードのテストのために、blooky-fpの一部をモックする
const mockDrip = jest.fn();
const mockCollapse = jest.fn();
jest.mock('../blooky-fp', () => {
    const original = jest.requireActual('../blooky-fp');
    mockDrip.mockImplementation((value, options) => original.drip(value, options)); // dripは元の実装を使いつつspyする
    return {
        ...original,
        collapse: mockCollapse,
    };
});


describe('Individual FxNode Definitions', () => {
    
    // 各NodeDefinitionからファクトリ関数を動的に生成し、`fx`オブジェクトを構築
    const fx = {
        call: new CallNodeDefinition().factory,
        collapse: new CollapseNodeDefinition().factory,
        condition: new ConditionNodeDefinition().factory,
        context: new ContextNodeDefinition().factory,
        loop: new LoopNodeDefinition().factory,
        none: new NoneNodeDefinition().factory,
        parallel: new ParallelNodeDefinition().factory,
        race: new RaceNodeDefinition().factory,
        return: new ReturnNodeDefinition().factory,
        sequence: new SequenceNodeDefinition().factory,
        switch: new SwitchNodeDefinition().factory,
        wait: new WaitNodeDefinition().factory,
        yield: new YieldNodeDefinition().factory,
        // テスト用のシンプルなdoアクション
        do: (run: FxRef<any>, options?: { id?: string, args?: FxRef<any>[] }): FxNode => 
            new CallNodeDefinition().factory(run, options),
    };

    beforeEach(() => {
        // モックのクリア
        jest.clearAllMocks();
        // Jestタイマーのセットアップ
        jest.useFakeTimers();
    });
    
    afterEach(() => {
        jest.useRealTimers();
    });

    // =================================
    //  Control Flow Nodes
    // =================================

    describe('SequenceNodeDefinition', () => {
        it('should execute steps in order', async () => {
            const order: number[] = [];
            const flow = fx.sequence([
                fx.do(() => order.push(1)),
                fx.do(() => order.push(2)),
            ]);
            await query(flow).done;
            expect(order).toEqual([1, 2]);
        });
    });

    describe('ParallelNodeDefinition', () => {
        it('should execute all steps in parallel and return results in order', async () => {
            const step1 = () => new Promise(res => setTimeout(() => res('first'), 100));
            const step2 = () => new Promise(res => setTimeout(() => res('second'), 50));
            const flow = fx.parallel([fx.do(step1), fx.do(step2)]);
            
            const promise = query(flow).done;
            await jest.advanceTimersByTimeAsync(100);
            const finalContext = await promise;

            expect(finalContext[RETURN_VALUE]).toEqual(['first', 'second']);
        });
    });

    describe('RaceNodeDefinition', () => {
        it('should return the result of the first step to complete', async () => {
            const slowStep = () => new Promise(res => setTimeout(() => res('slow'), 200));
            const fastStep = () => new Promise(res => setTimeout(() => res('fast'), 100));
            const flow = fx.race([fx.do(slowStep), fx.do(fastStep)]);

            const promise = query(flow).done;
            await jest.advanceTimersByTimeAsync(100);
            const finalContext = await promise;

            expect(finalContext[RETURN_VALUE]).toBe('fast');
        });
    });

    describe('ConditionNodeDefinition (if)', () => {
        it('should execute the "then" branch if condition is true', async () => {
            const thenFn = jest.fn();
            const elseFn = jest.fn();
            const flow = fx.condition(true, fx.do(thenFn), fx.do(elseFn));
            await query(flow).done;
            expect(thenFn).toHaveBeenCalled();
            expect(elseFn).not.toHaveBeenCalled();
        });

        it('should execute the "else" branch if condition is false', async () => {
            const thenFn = jest.fn();
            const elseFn = jest.fn();
            const flow = fx.condition(false, fx.do(thenFn), fx.do(elseFn));
            await query(flow).done;
            expect(thenFn).not.toHaveBeenCalled();
            expect(elseFn).toHaveBeenCalled();
        });
    });
    
    describe('SwitchNodeDefinition', () => {
        it('should execute the matching case', async () => {
            const caseAFn = jest.fn();
            const caseBFn = jest.fn();
            const cases = new Map<any, FxNode>([
                ['A', fx.do(caseAFn)],
                ['B', fx.do(caseBFn)],
            ]);
            const flow = fx.switch(ref('switchValue'), cases);

            await query(flow, { switchValue: 'B' }).done;
            expect(caseAFn).not.toHaveBeenCalled();
            expect(caseBFn).toHaveBeenCalled();
        });

        it('should execute the default case if no match is found', async () => {
            const defaultFn = jest.fn();
            const flow = fx.switch('C', new Map(), fx.do(defaultFn));
            await query(flow).done;
            expect(defaultFn).toHaveBeenCalled();
        });
    });
    
    describe('LoopNodeDefinition', () => {
        it('should loop until the condition is false', async () => {
            let counter = 0;
            const action = jest.fn(() => counter++);
            const condition = () => counter < 3;
            
            const flow = fx.loop(ref<boolean>('cond'), fx.do(action));
            await query(flow, { cond: condition }).done;
            
            expect(action).toHaveBeenCalledTimes(3);
        });

        it('should throw if maxIterations is exceeded', async () => {
            const flow = fx.loop(() => true, fx.none(), { maxIterations: 2 });
            await expect(query(flow).done).rejects.toThrow('Loop exceeded maximum iterations');
        });
    });

    // =================================
    //  Action Nodes
    // =================================

    describe('CallNodeDefinition', () => {
        it('should call the specified action with arguments', async () => {
            const action = jest.fn();
            const flow = fx.call(ref('action'), { arg: 'hello' });
            await query(flow, { action }).done;
            expect(action).toHaveBeenCalledWith('hello');
        });

        it('should call the action with a specific "this" context', async () => {
            const myObject = {
                value: 42,
                method: jest.fn(function() { return this.value; })
            };
            const flow = fx.call(ref('obj.method'), { context: ref('obj'), id: 'result' });
            const finalContext = await query(flow, { obj: myObject }).done;

            expect(myObject.method).toHaveBeenCalled();
            expect(finalContext['#result']).toBe(42);
        });
    });

    describe('CollapseNodeDefinition', () => {
        it('should call drip and collapse from blooky-fp', async () => {
            const myDripper = stream();
            const flow = fx.collapse(ref('value'), ref('dripper'));
            await query(flow, { value: 123, dripper: myDripper }).done;

            expect(mockDrip).toHaveBeenCalledWith(123, { acceptPromise: 'deny' });
            expect(mockCollapse).toHaveBeenCalled();
        });
    });

    describe('WaitNodeDefinition', () => {
        it('should wait for a specified duration (ms)', async () => {
            const start = performance.now();
            const flow = fx.wait({ ms: 100 });
            const promise = query(flow).done;

            await jest.advanceTimersByTimeAsync(100);
            await promise;
            const end = performance.now();

            expect(end - start).toBeGreaterThanOrEqual(100);
        });

        it('should wait until a Prop becomes true', async () => {
            const conditionProp = hold(false);
            const flow = fx.wait({ until: ref('cond') });
            const promise = query(flow, { cond: conditionProp }).done;

            // まだ解決しないことを確認
            let isDone = false;
            promise.then(() => isDone = true);
            await jest.advanceTimersByTimeAsync(10);
            expect(isDone).toBe(false);
            
            // Propを更新してフローを解決させる
            await coreCollapse(coreDrip(true)(conditionProp['__from']));
            await promise;
            expect(isDone).toBe(true);
        });
    });

    // =================================
    //  Context and Value Nodes
    // =================================

    describe('ReturnNodeDefinition', () => {
        it('should call the RETURN_VALUE function in the context', async () => {
            const returnHandler = jest.fn();
            const appContext = { [RETURN_VALUE]: returnHandler };
            const flow = fx.return('my-result');

            await query(flow, appContext).done;
            expect(returnHandler).toHaveBeenCalledWith('my-result');
        });

        it('should throw if RETURN_VALUE is not in the context', async () => {
            const flow = fx.return('my-result');
            await expect(query(flow).done).rejects.toThrow('This node must be called within a flow initiated by fx-yield');
        });
    });

    describe('YieldNodeDefinition', () => {
        it('should execute a sub-flow and return its result', async () => {
            // サブフロー：受け取った値を2倍して返す
            const subFlow = fx.sequence([
                fx.do(ref('double'), { id: 'doubled', args: [ref('yieldedValue')] }),
                fx.return(ref('#doubled'))
            ]);

            // メインフロー：サブフローをyieldで呼び出す
            const mainFlow = fx.sequence([
                fx.context({}, subFlow, 'sub'),
                fx.yield({ for: ref<FxContextNode>('#sub'), value: 21, id: 'yieldResult' })
            ]);

            const finalContext = await query(mainFlow, { double: (x: number) => x * 2 }).done;

            expect(finalContext['#yieldResult']).toBe(42);
        });
    });

    describe('NoneNodeDefinition', () => {
        it('should do nothing and complete successfully', async () => {
            const flow = fx.none();
            await expect(query(flow).done).resolves.toBeDefined();
        });
    });
});