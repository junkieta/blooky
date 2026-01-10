// src/test/debugger.test.ts
import DebugController from '../fx/debugger';

describe('DebugController basic', () => {
  test('node ids are stable and breakpoints register', () => {
    const d = new DebugController();
    const node = {};
    const id = d.getNodeId(node);
    expect(typeof id).toBe('string');
    d.addBreakpointNode(node);
    expect(d.listBreakpointsForUI()).toContain(id);
    d.removeBreakpointNode(node);
    expect(d.listBreakpointsForUI()).not.toContain(id);
  });

  test('pause/resume per execution', async () => {
    const d = new DebugController();
    const execId = 'exec-test-1';
    let started = false;
    let finished = false;

    // Simulate a node enter that will block because exec is paused
    d.pauseExecution(execId);

    const enterPromise = (async () => {
      started = true;
      await d.beforeNode({}, execId); // this should block until resumeExecution
      finished = true;
    })();

    // Let microtasks progress
    await Promise.resolve();
    expect(started).toBe(true);
    expect(finished).toBe(false);

    // resume and allow beforeNode to resolve
    d.resumeExecution(execId);
    await enterPromise;
    expect(finished).toBe(true);
  });

  test('stepExecution over behavior (depth target)', async () => {
    const d = new DebugController();
    const execId = 'exec-step-1';

    // simulate: depth goes 0 -> 1 (enter) -> 2 (enter child) -> after child -> back to 1 -> after parent
    // We'll pause at start, then step over (target depth 0) and ensure afterNode triggers pause when reaching target
    d.pauseExecution(execId);

    // Start at root: beforeNode (root)
    const rootEnter = d.beforeNode({}, execId); // increments depth to 1 and blocks
    await Promise.resolve();
    expect((d as any).executionDepth.get(execId)).toBe(1);

    // step over: should set target = depth - 1 = 0 and resume
    d.stepExecution(execId, 'over');

    // Simulate child node enter/exit and parent afterNode calls
    // child enter
    await d.beforeNode({}, execId); // depth 2
    d.afterNode({}, execId); // depth back to 1
    // parent after
    d.afterNode({}, execId); // depth back to 0 -> should pause again

    // allow pending resolvers to flush
    await Promise.resolve();
    expect((d as any).executionDepth.get(execId)).toBe(0);
    // pausedExecutions should contain execId
    expect((d as any).pausedExecutions.has(execId)).toBe(true);
  });
});