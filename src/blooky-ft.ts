// blooky-ft.ts
import { stream as coreStream, collapse as coreCollapse, blooky, drip, DripEffect, hold, Prop, Stream, vertex, clear, when, filter, PromisedProp, remap, disconnect } from './blooky-fp';
import { ShortDripStrategy, DripStrategy, StrategicDripper, DripperStream, CollapseObservationType, PropObserver, PropObserverArg, CollapseReservation, BlookyError, BlookyErrorCauseMap, FilterStream, ClockEffect } from './blooky-types';


const stream = <A>(strategy: ShortDripStrategy|DripStrategy = { type: "immediate" }) : StrategicDripper<A> => {
    if(!("type" in strategy))
        return "throttle" in strategy
            ? stream({ type: "throttle", interval: strategy.throttle })
            : "debounce" in strategy
            ? stream({ type: "debounce", delay: strategy.debounce })
            : "lock" in strategy
            ? stream({ type: "lock", mode: strategy.lock })
            : stream({ type: "immediate" });
    const s = coreStream() as StrategicDripper<A>;
    s.dripStrategy = strategy;
    return s;
};


const debounce = <A>(delay: number): StrategicDripper<A> => stream({ type: 'debounce', delay });

const throttle = <A>(interval: number): StrategicDripper<A> => stream({ type: 'throttle', interval });

const lock = <A>(mode: 'ignore' | 'queue' | 'restart'): StrategicDripper<A> => stream({ type: 'lock', mode });

// dobounce で一時保管するDrip情報
const PendingEffect = new WeakMap<DripperStream<any>,{
    pid: ReturnType<typeof setTimeout>
    resolvers: ((t:number)=>void)[]
}>();

// Throttleで処理中のドリッパーと時刻
const ThrottleRecord = new WeakMap<DripperStream<any>, {
    time: number
    resolvers: ((t:number)=>void)[]
}>();

// lock用の内部状態
const LockRecord = new WeakMap<DripperStream<any>, {
    locked: boolean
    queue: ((t:number)=>void)[]
    resolvers: ((t:number)=>void)[]
}>();

/**
 * DripEffectを実行する。blookyにおける「実行」の唯一のエントリーポイント。
 * drip()で生成したEffectは、collapse()を呼ぶまで実行されない。
 * 
 * Dripperのstrategyに応じて実行タイミングが制御される:
 * - immediate: 即座に実行
 * - debounce: 連続入力の最後だけ実行
 * - throttle: 一定間隔で間引いて実行
 * - lock: 実行中の新しいdripを制御
 *   - ignore: 実行中は無視
 *   - queue: 実行後にキューを順次処理
 *   - restart: 実行中を中断して新しい値で再開
 * @param effect - drip()で生成したDripEffect
 * @returns 実行完了時のタイムスタンプを返すPromise
 */
const collapse = async <A>(effect:DripEffect<A> | (DripEffect<A> & { dripper: StrategicDripper<A> })) => new Promise<number>((resolve, reject) => {
    const dripper = effect.dripper;
    const strategy = "dripStrategy" in dripper ? dripper.dripStrategy : null;
    const now = performance.now();
    if(!strategy) 
        executeCollapse({ now, effect, resolve, reject });

    else switch (strategy.type) {

        case 'throttle':
            let lastRecord: { time: number, resolvers: ((n:number)=>void)[] }
            if(!ThrottleRecord.has(dripper)) {
                // 新しいスロット開始
                lastRecord = { time: now, resolvers: [resolve] };
                ThrottleRecord.set(dripper, lastRecord);
            } else {
                lastRecord = ThrottleRecord.get(dripper)!;
                lastRecord.resolvers.push(resolve);
                // クールタイム中なら実行待ちに溜めるだけでbreak
                if((now - lastRecord.time) < strategy.interval)  break;
                // でなければ前回がintervalより前なので継続
                lastRecord.time = now;
            }
            executeCollapse({
                now,
                effect,
                reject,
                resolve: (t:number) => {
                    lastRecord.resolvers.forEach((r)=>r(t));
                    lastRecord.resolvers.length = 0;
                }
            });
            break;

        case 'debounce':
            let pending: { pid: ReturnType<typeof setTimeout>, resolvers: ((t:number)=>void)[] };
            if(PendingEffect.has(dripper)) {
                pending = PendingEffect.get(dripper)!;
                pending.resolvers.push(resolve);
                clearTimeout(pending.pid);
            } else {
                pending = { pid: 0 as any, resolvers: [resolve] }
                PendingEffect.set(dripper, pending);
            }
            pending.pid = setTimeout(()=>{
                PendingEffect.delete(dripper);
                // timeout後のnowに切り替える
                executeCollapse({ now: performance.now(), effect, reject, resolve: (t:number) => pending.resolvers.forEach((r)=>r(t)) });
            }, strategy.delay);
            break;

        case 'lock':
            let record = LockRecord.get(dripper);
            if (!record) {
                record = { locked: false, queue: [], resolvers: [] };
                LockRecord.set(dripper, record);
            }

            if (record.locked) {
                switch (strategy.mode) {
                case 'ignore':
                    return;
                case 'queue':
                    record.queue.push((t:number) =>
                    executeCollapse({ now: t, effect, resolve, reject })
                    );
                    return;
                case 'restart':
                    // resolve/reject が複数呼ばれないよう、前の完了を伝達
                    record.resolvers.push(resolve);
                    break;
                }
            }

            record.locked = true;

            const releaseLock = (v: any) => {
                // resolve待ちをすべて通知
                record!.resolvers.forEach((f) => f(v));
                record!.resolvers.length = 0;
                record!.locked = false;

                // 次のキュー処理をスケジュール
                const next = record!.queue.shift();
                if (next) next(performance.now());
            };

            const wrappedResolve = (v: any) => {
                resolve(v);
                releaseLock(v);
            };

            const wrappedReject = (e: any) => {
                reject(e);
                releaseLock(e);
            };

            executeCollapse({ now, effect, resolve: wrappedResolve, reject: wrappedReject });
            break;
            
    }
});


// Effect処理のミドルウェア
const tickHandlers: { [key in CollapseObservationType]: Set<PropObserver> } = {
    immediate: new Set(),
    visual: new Set(),
    quantum: new Set(),
    sequential: new Set(),
    thrown: new Set()
}

/**
 * collapse実行時のオブザーバーを登録する。
 * 
 * オブザーバーの種類:
 * - immediate: 同期実行
 * - quantum: queueMicrotask
 * - visual: requestAnimationFrame
 * - sequential: setTimeout
 * - thrown: エラー時のみ
 * @param type - オブザーバーの種類
 * @param observer - 実行されるハンドラ（DripEffect<any>を受け取る）
 * @returns 登録解除用の関数
*/
function registerCollapseObserver(type: CollapseObservationType, observer: PropObserverArg) {
  if(observer.props) {
    const props = observer.props;
    return registerCollapseObserver(type, {
        handler: observer.handler,
        filter: typeof observer.filter !== "function"
            ? props.has.bind(props)
            : (p:Prop<any>) => props.has(p) && observer.filter(p)
    });
  }
  tickHandlers[type].add(observer);
  return () => tickHandlers[type].delete(observer);
}

// 予約されたEffectを処理する（内部実装）
function executeCollapse(reservation: CollapseReservation) {
    
    const now = reservation.now;
    const effects = reservation.effect.effects;
    if(!effects.size) return;

    const errors: BlookyError<keyof BlookyErrorCauseMap>[] = [];
    
    const observers: { [key in Exclude<CollapseObservationType,"thrown">]: (f:()=>void)=>void } = {
        "immediate": (f)=>f(),
        "visual": globalThis.requestAnimationFrame || (globalThis as any).nextTick || (globalThis as any).setImmediate,
        "sequential": setTimeout,
        "quantum": queueMicrotask
    };
    
    const promises: Promise<unknown>[] =
        Object.entries(observers).flatMap(([key,ticker])=> {
            const handlers = tickHandlers[key as CollapseObservationType];
            return !handlers.size
                ? []
                : new Promise((resolve) => ticker(()=>{
                    handlers.forEach((observer) => {
                        try {
                            const relevantEffects = observer.filter
                                ? new Map([...effects].filter(([p])=>observer.filter(p)))
                                : effects;
                            if(relevantEffects.size) observer.handler(relevantEffects);
                        } catch(err) {
                            errors.push(err instanceof Error && 'category' in err 
                                ? err as BlookyError<any>
                                : blooky.error("user", {
                                    code: "TICK_HANDLER_ERROR",
                                    message: "Tick handler threw error",
                                    originalError: err,
                                    recoverable: true
                                }));
                        }
                    });
                    resolve(void 0);
                }));
        });
    
    Promise.allSettled(promises).then(()=>{
        if (errors.length && tickHandlers.thrown.size) {
            const errorEffects = errors.map((error) => drip(error)(blooky.errorStream[error.category]));
            tickHandlers.thrown.forEach((observer) => {
                try {
                    observer.handler(errorEffects[0].effects);
                } catch (thrownError) {
                    console.error('Error in thrown handler:', thrownError);
                }
            });
        }
        coreCollapse(reservation.effect);
        if(errors.length)
            reservation.reject(errors);
        else
            reservation.resolve(now);
    });
}

// --- 時間の源泉 ---
const beat$ = coreStream<number>();

const scheduler = globalThis.requestAnimationFrame || ((f:(t:number)=>void) => setTimeout(()=>f(performance.now()), Math.ceil(1000/60)));

type Reservation = {
  effect: DripEffect<any>
  resolve: (v:DripEffect<number>)=>void
  reject: (v:BlookyError<keyof BlookyErrorCauseMap>[])=>void
}
const tickQueue: Reservation[] = [];

let clockRunning: number | NodeJS.Timeout = 0;
const advanceClock = () => {
    if(!clockRunning) clockRunning = scheduler((t:number) => {
        if(!tickQueue.length && !clockObservers.size) return;
        
        const clockEffect = drip(t)(beat$);
        const propEffects = clockEffect.effects;
        const reservations = tickQueue.splice(0);
        reservations.reverse().forEach((r) => {
            r.effect.effects.forEach((v,p) => {
                if(!propEffects.has(p))
                    propEffects.set(p,v);
            });
        });

        clockRunning = 0;
        clockObservers.forEach((props,f) => {
            const m = new Map(propEffects.entries().filter(([p])=>props.has(p)));
            if(m.size)
                f(Object.assign({}, clockEffect, { effects: m, unbind: unobserve(f) }));
        });
        coreCollapse(clockEffect);
        reservations.forEach((r) => r.resolve(clockEffect));
        
        advanceClock();
    });
}
const tick = (effect:DripEffect<any>) => 
    new Promise((resolve,reject) => {
        tickQueue.push({ effect, resolve, reject });
        advanceClock();
    });

const clock = hold(0)(beat$);

const clockObservers = new Map<(effect: ClockEffect) => void, Set<Prop<unknown>>>();

const observe = (f:(effect:ClockEffect)=>void) => (p: Prop<unknown>) => {
    if(!clockObservers.has(f)) 
        clockObservers.set(f, new Set([p]));
    else
        clockObservers.get(f)!.add(p);
    return unobserve(f).bind(null, p);
};

const unobserve = (f:(effect:ClockEffect)=>void) => (p?: Prop<unknown>) => {
    if(!clockObservers.has(f)) return;
    if(!p) {
        clockObservers.delete(f)
    } else {
        const props = clockObservers.get(f)!;
        props.delete(p);
        if(!props.size)
            clockObservers.delete(f);
    }
};

export {
    stream,debounce,throttle,lock,collapse,
    tick, clock, observe, unobserve,
    registerCollapseObserver
}
