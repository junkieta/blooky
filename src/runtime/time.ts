import { stream, drip, hold, commit, conflict } from "../blooky-fp";
import { FVRuntime, ObservedDripPlan } from "../blooky-fv";
import { DripPlan, Prop } from "../blooky-types";

type Clock = Prop<number> & FVRuntime;

const beat$ = stream<number>();
const scheduler = globalThis.requestAnimationFrame || 
  ((f:(t:number)=>void) => setTimeout(()=>f(performance.now()), Math.ceil(1000/60)));

type Reservation = {
  plan: DripPlan
  resolve: (v:DripPlan)=>void
  reject: (v:unknown)=>void
}

const tickQueue: Reservation[] = [];

let clockRunning: number | NodeJS.Timeout = 0;
const advanceClock = () => {
    if(!clockRunning) clockRunning = scheduler((t:number) => {
        clockRunning = 0;
        if(!tickQueue.length && !clockObservers.size) return;
        const reservations = tickQueue.splice(0);
        const plan = drip(t)(beat$).concat(...reservations.map(({plan})=>plan));
        const errors = notifyClockObservers(plan);
        try {
            commit(plan);
            reservations.forEach(({resolve})=>resolve(plan));
        } catch(err) {
            reservations.forEach(({reject})=>reject(err));
        }
        if(errors.length)
            console.error('clockObserver: thrown errors', ...errors);
        advanceClock();
    });
}

const notifyClockObservers = (plan: DripPlan) : Error[] => {
    const errors: Error[] = [];
    clockObservers.forEach((props,f) => {
        const m = new Map(plan.filter(([p])=>props.has(p)));
        if(m.size) {
            try {
                f(m);
            } catch(err) {
                errors.push(err);
            }
        }
    });
    return errors;
}

const tick = (plan:DripPlan) => 
    new Promise((resolve,reject) => {
        tickQueue.push({ plan: plan, resolve, reject });
        advanceClock();
    });

const clockObservers = new Map<(plan: ObservedDripPlan) => void, Set<Prop<unknown>>>();

export const clock: Clock = Object.assign<Prop<number>, FVRuntime>(hold(0)(beat$), {

    observe(f: (plan: ObservedDripPlan) => void) {
        return (p: Prop<any>) => {
            if(!clockObservers.has(f)) 
                clockObservers.set(f, new Set([p]));
            else
                clockObservers.get(f)!.add(p);
            return clock.unobserve(f).bind(null, p);
        }
    },

    unobserve(f:(plan:ObservedDripPlan)=>void) {
        return (p?: Prop<unknown>) => {
            if(!clockObservers.has(f))
                return;
            if(!p) {
                clockObservers.delete(f)
            } else {
                const props = clockObservers.get(f)!;
                props.delete(p);
                if(!props.size)
                    clockObservers.delete(f);
            }
        }
    },

    submit: tick

});


export const time = { tick, clock };