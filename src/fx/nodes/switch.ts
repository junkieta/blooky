// src/fx/nodes/switch.ts
import type { ExecutionContext, FxNote, FxRef, FxSwitchNode, ExecutionStep } from '../types';
import { NodeDefinition } from '../NodeDefinition';

type ThisNode = Extract<FxNote, { type: 'switch' }>;

export class SwitchNodeDefinition extends NodeDefinition<'switch'> {
  public readonly type = 'switch';

  public factory(by: FxRef<any>, cases: Map<any, FxNote>, defaultNode?: FxNote): ThisNode {
    return { type: 'switch', by, cases, default: defaultNode };
  }

  public getSubNotes(node: FxSwitchNode): FxNote[] {
    const cases = [...node.cases.values()];
    return node.default ? cases.concat(node.default) : cases;
  }

  public async *execute(context: ExecutionContext & { node: ThisNode }): AsyncGenerator<ExecutionStep, any> {
    const { node, executeChild } = context;
    yield {
      phase: 'evaluating',
      node,
      visual: { label: 'Evaluating switch value', color: '#3B82F6' }
    };
    
    const by = context.resolve(node.by)();
    
    yield {
      phase: 'selecting',
      node,
      data: { by, hasCase: node.cases.has(by) },
      visual: { 
        label: typeof by === 'string'
          ? `Switch: "${by}"`
          : typeof by === 'symbol'
          ? `Switch: ${Symbol.keyFor(by as symbol)}`
          : 'Switch: by is ' + typeof by,
        color: '#F59E0B'
      }
    };
    
    let targetNode: FxNote | undefined;
    
    if (node.cases.has(by)) {
      targetNode = node.cases.get(by)!;
    } else if (node.default) {
      targetNode = node.default;
      yield {
        phase: 'default',
        node,
        visual: { label: 'Taking default branch', color: '#6B7280' }
      };
    }
    
    if (targetNode) {
      const childGen = executeChild(targetNode);
      let result;
      for await (const childStep of childGen) {
        yield childStep;
        result = childStep;
      }
      
      yield {
        phase: 'completed',
        node,
        data: { result },
        visual: { label: 'Switch completed', color: '#10B981' }
      };
      
      return result;
    }
    
    yield {
      phase: 'completed',
      node,
      visual: { label: 'No case matched', color: '#6B7280' }
    };
  }
}