import { stream, drip, hold, collapse } from "../blooky-fp";
import { DripEffect, Prop } from "../blooky-types";

type ClockEffect = DripEffect<number> & { unbind: (p:Prop<unknown>)=>void }
type Clock = Prop<number> & {
    observe: (f:(effect:ClockEffect)=>void) => (p: Prop<unknown>) => ()=>void
    unobserve: (f:(effect:ClockEffect)=>void) => (p?: Prop<unknown>) => void
};


const beat$ = stream<number>();
const scheduler = globalThis.requestAnimationFrame || 
  ((f:(t:number)=>void) => setTimeout(()=>f(performance.now()), Math.ceil(1000/60)));

type Reservation = {
  effect: DripEffect<any>
  resolve: (v:DripEffect<number>)=>void
  reject: (v:Error[])=>void
}
const tickQueue: Reservation[] = [];

let clockRunning: number | NodeJS.Timeout = 0;
const advanceClock = () => {
    if(!clockRunning) clockRunning = scheduler((t:number) => {
        if(!tickQueue.length && !clockObservers.size) return;
        clockRunning = 0;
        const reservations = tickQueue.splice(0).reverse();
        const clockEffect = drip(t)(beat$);
        const errors = notifyClockObservers(clockEffect)(reservations);
        collapse(clockEffect);
        if(!errors.length) {
            reservations.forEach((r) => r.resolve(clockEffect));
        } else {
            reservations.forEach((r) => r.reject(errors));
        }
//        reservations.forEach((r) => r.resolve(clockEffect));
        advanceClock();
    });
}

const tick = (effect:DripEffect<any>) => 
    new Promise((resolve,reject) => {
        tickQueue.push({ effect, resolve, reject });
        advanceClock();
    });

const clockObservers = new Map<(effect: ClockEffect) => void, Set<Prop<unknown>>>();


const clock = Object.assign(hold(0)(beat$), {

    observe: (f:(effect:ClockEffect)=>void) => (p: Prop<unknown>) => {
        if(!clockObservers.has(f)) 
            clockObservers.set(f, new Set([p]));
        else
            clockObservers.get(f)!.add(p);
        return clock.unobserve(f).bind(null, p);
    },

    unobserve: (f:(effect:ClockEffect)=>void) => (p?: Prop<unknown>) => {
        if(!clockObservers.has(f)) return;
        if(!p) {
            clockObservers.delete(f)
        } else {
            const props = clockObservers.get(f)!;
            props.delete(p);
            if(!props.size)
                clockObservers.delete(f);
        }
    }

}) as Clock;

const notifyClockObservers = (effect: DripEffect<any>) => (reservations: Reservation[]) : Error[] => {
    const propEffects = effect.effects;
    reservations.forEach((r) => {
        r.effect.effects.forEach((v,p) => {
            if(!propEffects.has(p))
                propEffects.set(p,v);
        });
    });

    const errors: Error[] = [];
    clockObservers.forEach((props,f) => {
        const m = new Map(propEffects.entries().filter(([p])=>props.has(p)));
        if(m.size) {
            try {
                f(Object.assign({}, effect, {
                    effects: m,
                    unbind: clock.unobserve(f)
                }));
            } catch(err) {
                errors.push(err);
            }
        }
    });
    return errors;
}

export const time = { tick, clock };
