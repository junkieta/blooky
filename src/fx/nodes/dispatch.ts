import type { INodeDefinition, FxNode, FxRef, FxNodeCompiler, FxExecutionContext, FxCompiledNode, FxDispatchSettings } from '../types';
import { NodeDefinition } from '../NodeDefinition';

type ThisNode = Extract<FxNode, { type: 'dispatch' }>;
type ThisCompiledNode = Extract<FxCompiledNode, { type: 'dispatch' }>;

export class DispatchNodeDefinition extends NodeDefinition<'dispatch'> {
  public readonly type = 'dispatch';

  public factory(name: FxRef<string>, settings: FxDispatchSettings<any>, child?: FxNode): ThisNode {
    return { type: 'dispatch', name, settings, child };
  }

  public compile(node: ThisNode, compiler: FxNodeCompiler) {
    return Object.create(node, {
      name: { value: compiler.resolveValue(node.name) },
      settings: { 
        value: Object.create(node.settings, {
          detail: { value: node.settings.detail ? compiler.resolveValue(node.settings.detail) : undefined }
        })
      },
      child: { value: node.child ? compiler.compileNode(node.child) : undefined }
    });
  }

  public async handle({ node, execute }: FxExecutionContext & { node: ThisCompiledNode }) {
    let target: EventTarget = window;
    if (typeof node.settings.target === 'string') {
        const element = document.querySelector(node.settings.target);
        if (element) target = element;
    } else if (node.settings.target instanceof EventTarget) {
        target = node.settings.target;
    }
    
    const event = new CustomEvent(node.name(), {
      ...node.settings,
      detail: node.settings.detail ? node.settings.detail() : undefined
    });

    const dispatchedSuccessfully = target.dispatchEvent(event);

    if (dispatchedSuccessfully && node.child) {
      await execute(node.child);
    }
  }
}