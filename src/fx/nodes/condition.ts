// src/fx/nodes/condition.ts
import type { FxConditionNode, ExecutionContext, FxNote, FxRef, ExecutionStep } from '../types';
import { NodeDefinition } from '../NodeDefinition';

type ThisNode = Extract<FxNote, { type: 'condition' }>;

export class ConditionNodeDefinition extends NodeDefinition<'condition'> {
  public readonly type = 'condition';

  public factory(ifCond: FxRef<boolean>, thenBranch: FxNote, elseBranch?: FxNote): ThisNode {
    return { type: 'condition', if: ifCond, then: thenBranch, else: elseBranch };
  }

  public getSubNotes(node: FxConditionNode): FxNote[] {
    return node.else ? [node.then, node.else] : [node.then];
  }
  
  public async *execute(context: ExecutionContext & { node: ThisNode }): AsyncGenerator<ExecutionStep, any> {
    const {node, executeChild} = context;
    yield {
      phase: 'evaluating',
      node,
      visual: { label: 'Evaluating condition', color: '#3B82F6' }
    };
    
    const condition = context.resolve(node.if)();
    
    yield {
      phase: 'branching',
      node,
      data: { condition, branch: condition ? 'then' : 'else' },
      visual: { 
        label: `Taking ${condition ? 'THEN' : 'ELSE'} branch`,
        color: condition ? '#10B981' : '#F59E0B',
        icon: condition ? '→' : '↓'
      }
    };
    
    const targetBranch = condition ? node.then : node.else;
    
    if (targetBranch) {
      const childGen = executeChild(targetBranch);
      let result;
      for await (const childStep of childGen) {
        yield childStep;
        result = childStep;
      }
      
      yield {
        phase: 'completed',
        node,
        data: { result },
        visual: { label: 'Condition completed', color: '#10B981' }
      };
      
      return result;
    }
    
    yield {
      phase: 'completed',
      node,
      visual: { label: 'No branch taken', color: '#6B7280' }
    };
  }
}