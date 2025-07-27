// blooky-effect-dom.ts

import { FxNode, fx, runCancelable } from "./blooky-effect";

abstract class EffectElement extends HTMLElement {
  abstract toFxNode(): FxNode;

  connectedCallback() {
    const { promise, cancel } = runCancelable(this.toFxNode());
    this._cancel = cancel;
  }

  disconnectedCallback() {
    this._cancel?.();
  }

  private _cancel?: () => void;
}

//  カスタム要素例：<fx-sequence>
class FxSequence extends EffectElement {
  toFxNode(): FxNode {
    const children = Array.from(this.children).filter(
      (n): n is EffectElement => n instanceof EffectElement
    );
    return fx.sequence(children.map(c => c.toFxNode()));
  }
}
customElements.define("fx-sequence", FxSequence);

// <fx-call>
class FxCall extends EffectElement {
  toFxNode(): FxNode {
    const code = this.getAttribute("code") || "";
    return fx.call(() => new Function(code)());
  }
}
customElements.define("fx-call", FxCall);

// <fx-delay ms="500">
class FxDelay extends EffectElement {
  toFxNode(): FxNode {
    const ms = parseInt(this.getAttribute("ms") || "0");
    return fx.delay(ms);
  }
}
customElements.define("fx-delay", FxDelay);