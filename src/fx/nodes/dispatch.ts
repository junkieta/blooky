import type { FxNode, FxRef, FxExecutionContext, FxDispatchSettings } from '../types';
import { NodeDefinition } from '../NodeDefinition';
import {isFxRef} from "../engine"

type ThisNode = Extract<FxNode, { type: 'dispatch' }>;
type ThisCompiledNode = Extract<FxNode, { type: 'dispatch' }>;

export class DispatchNodeDefinition extends NodeDefinition<'dispatch'> {
  public readonly type = 'dispatch';

  public factory(name: FxRef<string>, settings: FxDispatchSettings<any>, child?: FxNode): ThisNode {
    return { type: 'dispatch', name, settings, child };
  }

  public async handle({ node, context, execute }: FxExecutionContext & { node: ThisNode }) {
    let target: EventTarget = window;
    if (typeof node.settings.target === 'string') {
        const element = document.querySelector(node.settings.target);
        if (element) target = element;
    } else if (node.settings.target instanceof EventTarget) {
        target = node.settings.target;
    }

    const name = context.resolve(node.name);
    const detail = isFxRef(node.settings.detail) ? context.resolve(node.settings.detail)() : node.settings.detail;
    const event = new CustomEvent(name(), { ...node.settings, detail });
    const dispatchedSuccessfully = target.dispatchEvent(event);
    if (dispatchedSuccessfully && node.child) {
      await execute(node.child);
    }
  }
}