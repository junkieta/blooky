// blooky-ft.ts
import { stream as coreStream, collapse as coreCollapse, blooky, drip, DripEffect, hold, Prop, Stream, vertex, clear, when } from './blooky-fp';
import { ShortDripStrategy, DripStrategy, StrategicDripper, DripperStream, CollapseObservationType, PropObserver, PropObserverArg, CollapseReservation, BlookyError, BlookyErrorCauseMap } from './blooky-types';

// --- 時間の源泉 ---
const beat$ = coreStream<number>();

/**
 * アプリケーション全体で共有される現在時刻を表すProp。
 * collapse()実行時に自動的に更新される。
 */
const clock = hold(performance.now())(beat$) as Prop<number> & {
    resume: (p?: Prop<boolean>) => void
    pause: () => void
};
{
    let pid : number = 0;
    let ticker = globalThis.requestAnimationFrame || ((f:(t:number)=>void) => setTimeout(f, Math.ceil(1000/60)));
    let canceler = ticker === globalThis.requestAnimationFrame ? cancelAnimationFrame : clearTimeout;
    
    clock.resume = (p?: Prop<boolean>) => {
        clock.pause();
        pid = ticker(function recursion() {
            if(pid) {
                const t = performance.now();
                console.log(t - clock());
                collapse(drip(t)(beat$)).finally(()=> pid = ticker(recursion));
            }
        })

        return p
            ? registerCollapseObserver("immediate", {
                props: new Set([p]),
                handler: (v) => {
                    if(v.get(p)) {
                        clock.resume();
                    } else {
                        clock.pause();
                    }
                }
            })
            : ()=>{};
    }

    clock.pause = () => {
        canceler(pid)
        pid = 0;
    }

}

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
        tick({ now, effect, resolve, reject });

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
            tick({
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
                tick({ now: performance.now(), effect, reject, resolve: (t:number) => pending.resolvers.forEach((r)=>r(t)) });
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
                    tick({ now: t, effect, resolve, reject })
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

            tick({ now, effect, resolve: wrappedResolve, reject: wrappedReject });
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
function tick(reservation: CollapseReservation) {
    const now = reservation.now;
    if(now > clock() && reservation.effect.dripper !== beat$) {
        tick({ now, effect: drip(now)(beat$), resolve: ()=>{}, reject: ()=>{} });
    }
    
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

export {
    stream,debounce,throttle,lock,collapse,
    clock,
    registerCollapseObserver
}
