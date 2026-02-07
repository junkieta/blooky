// fx-nodes.test.ts

// `collapse`ノードのテストのために、blooky-fpの一部をモックする
import * as BlookyFp from "../blooky-fp";
const {stream,hold,collapse,drip} = BlookyFp;

import { query, ref, fx as coreFx } from '../blooky-fx'; 
import { RETURN_VALUE } from '../fx/nodes/return';
import { FxNote, FxRef } from '../fx/types';
import { DripperStream, Prop } from '../blooky-types';

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




describe('Individual FxNote Definitions', () => {
    
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
        do: (run: FxRef<any>, options?: { id?: string, arg?: FxRef<any> }): FxNote => 
            new CallNodeDefinition().factory(run, options),
    };

    beforeEach(() => {
        // モックのクリア
        jest.clearAllMocks();
        // Jestタイマーのセットアップ
        jest.useFakeTimers({ advanceTimers: true, timerLimit: 1000, legacyFakeTimers: false });
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
            const values = ['none','none'];
            const step1 = () => new Promise<string>(res => setTimeout(() => res('100ms'), 100)).then((t)=>values[0]=t);
            const step2 = () => new Promise<string>(res => setTimeout(() => res('50ms'),   50)).then((t)=>values[1]=t);
            const flow = fx.parallel([fx.do(step1), fx.do(step2)]);
            
            const promise = query(flow).done;
            await jest.advanceTimersByTimeAsync(50);
            expect(values).toEqual(['none','50ms']);

            await promise;
            expect(values).toEqual(['100ms','50ms']);
        });
    });

    describe('RaceNodeDefinition', () => {
        it('should return the result of the first step to complete', async () => {
            let result = 'none';
            const slowStep = () => new Promise<string>(res => setTimeout(() => res('slow'), 200)).then((v)=>result=v);
            const fastStep = () => new Promise<string>(res => setTimeout(() => res('fast'), 100)).then((v)=>result=v);
            const flow = fx.race([fx.do(slowStep), fx.do(fastStep)]);

            await query(flow).done;
            expect(result).toBe('fast');
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
            const cases = new Map<any, FxNote>([
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
            const finalContext = await query(flow, { obj: myObject, ["obj.method"]: myObject.method }).done;

            expect(myObject.method).toHaveBeenCalled();
            expect(finalContext['#result']).toBe(42);
        });
    });

    describe('CollapseNodeDefinition', () => {
        it('should call drip and collapse from blooky-fp', async () => {
            const mockDrip = jest.spyOn(BlookyFp, "drip");
            const mockCollapse = jest.spyOn(BlookyFp, "collapse");
            const myDripper = stream();
            const flow = fx.collapse(ref<any>('value'), ref<DripperStream<any>>('dripper'));
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
            const s = stream<boolean>();
            const conditionProp = hold(false)(s);
            const flow = fx.wait({ until: ref<Prop<boolean>>('cond') });
            const promise = query(flow, { cond: conditionProp }).done;

            // まだ解決しないことを確認
            let isDone = false;
            promise.then(() => isDone = true);
            expect(isDone).toBe(false);
            
            // Propを更新してフローを解決させる
            await collapse(drip(true)(s));
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
            jest.spyOn(console, 'error').mockImplementation(() => {});
            const flow = fx.return('my-result');
            await expect(query(flow).done).rejects.toThrow('fx-return: This node must be called within a flow initiated by fx-yield');
            (console.error as jest.Mock).mockRestore();
        });
    });

    describe('YieldNodeDefinition', () => {
        it('should execute a sub-flow and return its result', async () => {
            // サブフロー：受け取った値を返す
            const subFlow = fx.context({}, fx.return(ref("$_")), 'sub');
            // メインフロー：サブフローをyieldで呼び出す
            const mainFlow = fx.yield({ for: subFlow, value: 1, id: 'yieldResult' });
            const finalContext = await query(mainFlow).done;
            expect(finalContext['#yieldResult']).toBe(1);
        });
    });

    describe('NoneNodeDefinition', () => {
        it('should do nothing and complete successfully', async () => {
            const flow = fx.none();
            await expect(query(flow).done).resolves.toBeDefined();
        });
    });

});