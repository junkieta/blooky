// blooky-fp.test.ts

// --- 型定義のインポート ---
import type { 
    DripperStream,
    DripStrategy,
    Prop,
    DripEffect,
} from '../blooky-types.d';

// --- テスト対象の関数のインポート ---
import { 
    drip, stream,
    isStream, isDripperStream,
    clear,
    merge,
    map, filter,
    hold, accum, lift, remap, when,
    proxy,
    pipe,
    collapse, registerTickHandler,
    blooky
} from '../blooky-fp';


describe('blooky-fp.ts', () => {
    
    // Jestのタイマーモックを有効にする
    beforeEach(() => {
        jest.useFakeTimers({
            advanceTimers: true,
            timerLimit: 1000,
            legacyFakeTimers: false
        });
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    // =================================
    // ストリーム生成と型ガード
    // =================================
    describe('Stream Creation and Type Guards', () => {
        test('stream() should create a dripper stream with immediate strategy by default', () => {
            const s = stream();
            expect(isStream(s)).toBe(true);
            expect(isDripperStream(s)).toBe(true);
            expect((s as DripperStream<any>).dripStrategy.type).toBe('immediate');
        });

        test('stream() should handle shorthand strategies', () => {
            const sDebounce = stream({ debounce: 100 });
            expect((sDebounce as DripperStream<any>).dripStrategy).toEqual({ type: 'debounce', delay: 100 });
            
            const sThrottle = stream({ throttle: 200 });
            expect((sThrottle as DripperStream<any>).dripStrategy).toEqual({ type: 'throttle', interval: 200 });
        });

        test('isStream() should correctly identify streams', () => {
            const s = stream();
            expect(isStream(s)).toBe(true);
            expect(isStream({})).toBe(false);
            expect(isStream(null)).toBe(false);
        });

        test('isDripperStream() should correctly identify dripper streams', () => {
            const s1 = stream();
            const s2 = stream();
            const merged = merge([s1, s2]);
            expect(isDripperStream(s1)).toBe(true);
            expect(isDripperStream(merged)).toBe(false);
        });
    });

    // =================================
    // ストリームオペレーター
    // =================================
    describe('Stream Operators', () => {
        test('map() should transform stream values', async () => {
            const s = stream<number>();
            const p = pipe(s, map(v => v * 2), hold(0));
            
            await collapse(drip(10)(s));

            expect(p()).toBe(20);
        });

        test('filter() should filter stream values', async () => {
            const s = stream<number>();
            const p = pipe(s, filter(v => v > 5), hold(0));
            
            // フィルターを通過しない値
            await collapse(drip(4)(s));
            expect(p()).toBe(0); // 初期値のまま

            // フィルターを通過する値
            await collapse(drip(10)(s));
            expect(p()).toBe(10);
        });
        
        test('merge() should merge multiple streams', async () => {
            const s1 = stream<number>();
            const s2 = stream<string>();
            const merged = merge<number|string>([s1, s2]);
            const p = hold<number|string>(0)(merged);

            // s1から流す
            await collapse(drip(100)(s1));
            expect(p()).toBe(100);

            // s2から流す
            await collapse(drip("hello")(s2));
            expect(p()).toBe("hello");
        });
    });

    // =================================
    // Prop（プロパティ）関連
    // =================================
    describe('Prop Handling', () => {
        test('hold() should create a prop from a stream', async () => {
            const s = stream<number>();
            const p = hold(10)(s); // 初期値は10
            
            expect(p()).toBe(10);
            
            await collapse(drip(20)(s));
            
            expect(p()).toBe(20);
        });

        test('accum() should accumulate values over time', async () => {
            const s = stream<number>();
            const sum = accum((current:number, value:number) => current + value, 0)(s);
            
            expect(sum()).toBe(0);

            await collapse(drip(5)(s));
            expect(sum()).toBe(5);

            await collapse(drip(10)(s));
            expect(sum()).toBe(15);
        });

        test('remap() should create a derived prop', async () => {
            const s = stream<number>();
            const p1 = hold(5)(s);
            const p2 = remap(v => `Value is ${v}`)(p1);

            expect(p2()).toBe('Value is 5');
            
            await collapse(drip(10)(s));
            
            expect(p2()).toBe('Value is 10');
        });

        test('lift() should combine multiple props', async () => {
            const s1 = stream<number>();
            const s2 = stream<number>();
            const p1 = hold(2)(s1);
            const p2 = hold(3)(s2);
            const sum = lift(values => values.reduce((a, b) => a + b, 0))([p1, p2]);

            expect(sum()).toBe(5);

            await collapse(drip(10)(s1));
            expect(sum()).toBe(13); // 10 + 3

            await collapse(drip(20)(s2));
            expect(sum()).toBe(30); // 10 + 20
        });

        test('when() should create a promise that resolves when a condition is met', async () => {
            const s = stream<number>();
            const p = hold(0)(s);
            const pWhen = when<number>(v => v > 5)(p);
            
            let resolvedValue: number | undefined;
            pWhen.then(v => {
                resolvedValue = v;
            });
            
            // まだ解決されない
            await jest.runAllTimersAsync();
            expect(resolvedValue).toBeUndefined();

            // 条件を満たさない値を流す
            await collapse(drip(4)(s));
            await jest.runAllTimersAsync();
            expect(resolvedValue).toBeUndefined();
            
            // 条件を満たす値を流す
            await collapse(drip(10)(s));
            await jest.runAllTimersAsync();
            expect(resolvedValue).toBe(10);
        });
    });

    // =================================
    // DripとCollapse（コア実行部分）
    // =================================
    describe('Drip and Collapse', () => {
        test('immediate strategy should execute immediately via collapse', async () => {
            const s = stream<number>({ type: 'immediate' });
            const p = hold(0)(s);
            
            const promise = collapse(drip(100)(s));
            
            expect(p()).toBe(0); // collapseは非同期なので、まだ更新されていない

            await promise;
            
            expect(p()).toBe(100); // promiseが解決されたら更新されている
        });

        test('debounce strategy should delay execution', async () => {
            const s = stream<number>({ debounce: 100 });
            const p = hold(0)(s);

            collapse(drip(10)(s));
            
            // 50ms経過 -> まだ実行されない
            await jest.advanceTimersByTimeAsync(50);
            expect(p()).toBe(0);
            
            // 新しいdrip -> タイマーリセット
            collapse(drip(20)(s));
            await jest.advanceTimersByTimeAsync(50);
            expect(p()).toBe(0);

            // 100ms経過 -> 実行される
            await jest.advanceTimersByTimeAsync(100);
            
            expect(p()).toBe(20); // 最後の値で更新
        });

        test('throttle strategy should limit execution frequency', async () => {
            const s = stream<number>({ throttle: 100 });
            const p = hold(0)(s);
            
            // 1回目: 実行される
            await collapse(drip(10)(s));
            expect(p()).toBe(10);
            
            // 2回目 (50ms後): スロットルされる (rejectされるがここでは確認しない)
            await jest.advanceTimersByTimeAsync(50);
            collapse(drip(20)(s)).catch(() => {}); // Promiseがrejectされるのでcatch
            await jest.runAllTicks();
            expect(p()).toBe(10); // 値は変わらない

            // 3回目 (さらに70ms後、合計120ms): 実行される
            await jest.advanceTimersByTimeAsync(70);
            await collapse(drip(30)(s));
            expect(p()).toBe(30);
        });
    });

    // =================================
    // その他ユーティリティ
    // =================================
    describe('Utilities', () => {
        
        test('pipe() should chain operations', async () => {
            const s = stream<number>();
            const p = pipe(
                s,
                map(x => x + 1),      // 10 -> 11
                filter(x => x > 10),  // 11 > 10 -> pass
                map(x => x * 2),      // 11 -> 22
                hold(0)
            );
            
            await collapse(drip(10)(s));
            
            expect(p()).toBe(22);
        });

        test('clear() should remove connections', async () => {
            const s1 = stream<number>();
            const s2 = pipe(s1, map(v => v));
            const p = hold(0)(s2);
            
            // @ts-ignore // テストのために内部プロパティにアクセス
            expect(s1.next.has(s2)).toBe(true);

            clear(s1);

            // @ts-ignore
            expect(s1.next.has(s2)).toBe(false);
            
            // clear後は値が流れなくなる
            await collapse(drip(100)(s1));
            expect(p()).toBe(0); // 更新されない
        });

        test('proxy() should link an object property', async () => {
            const obj = { value: 10 };
            const [s, p] = proxy(obj, 'value');

            expect(p()).toBe(10);

            // Streamに流すとオブジェクトのプロパティが更新される
            await collapse(drip(50)(s));
            expect(obj.value).toBe(50);
            expect(p()).toBe(50);
        });

        test('blooky.error() should create a custom error', () => {
            const err = blooky.error('user', {
                code: 'TEST_ERROR',
                message: 'This is a test',
                recoverable: false,
                originalError: new Error()
            });

            expect(err).toBeInstanceOf(Error);
            expect(err.message).toBe('This is a test');
            expect(err.category).toBe('user');
            // @ts-ignore
            expect(err.cause.code).toBe('TEST_ERROR');
        });
    });
});