import { fx, FxNode, runCancelable } from "./blooky-effect"; // assume effect-core exists

// ---- Abstract Base ----

export abstract class EffectElement extends HTMLElement {
  abstract toFxNode(): FxNode;

  protected childrenToFxNodes(): FxNode[] {
    return Array.from(this.children)
      .filter((n): n is EffectElement => n instanceof EffectElement)
      .map((n) => n.toFxNode());
  }
}

// ---- Core Elements ----

class FxSequence extends EffectElement {
  toFxNode(): FxNode {
    return fx.sequence(...this.childrenToFxNodes());
  }
}
customElements.define("fx-sequence", FxSequence);

class FxParallel extends EffectElement {
  toFxNode(): FxNode {
    return fx.parallel(...this.childrenToFxNodes());
  }
}
customElements.define("fx-parallel", FxParallel);

class FxRace extends EffectElement {
  toFxNode(): FxNode {
    return fx.race(...this.childrenToFxNodes());
  }
}
customElements.define("fx-race", FxRace);

class FxDelay extends EffectElement {
  toFxNode(): FxNode {
    const ms = Number(this.getAttribute("ms") || "0");
    return fx.call(() => new Promise(res => setTimeout(res, ms)));
  }
}
customElements.define("fx-delay", FxDelay);

class FxCall extends EffectElement {
  toFxNode(): FxNode {
    const src = this.getAttribute("src");
    const fn = this.getAttribute("fn");

    const args = Array.from(this.querySelectorAll("arg"))
      .map(arg => {
        const raw = arg.getAttribute("value") ?? arg.textContent ?? "null";
        try {
          return JSON.parse(raw);
        } catch {
          throw new Error(`Invalid arg value: ${raw}`);
        }
      });

    if (src && fn) {
      return fx.call(async () => {
        const mod = await import(src);
        const func = mod[fn];
        if (typeof func !== "function") throw new Error(`Function '${fn}' not found`);
        await func(...args);
      });
    }

    return fx.call(() => {
      throw new Error("<fx-call> requires src and fn attributes");
    });
  }
}
customElements.define("fx-call", FxCall);

class FxIf extends EffectElement {
  toFxNode(): FxNode {
    const condStr = this.getAttribute("when") ?? "false";
    const cond = (() => {
      try { return JSON.parse(condStr); }
      catch { return false; }
    })();
    const thenNode = this.querySelector('[slot="then"]') as EffectElement | null;
    const elseNode = this.querySelector('[slot="else"]') as EffectElement | null;
    return cond
      ? thenNode?.toFxNode() ?? fx.none()
      : elseNode?.toFxNode() ?? fx.none();
  }
}
customElements.define("fx-if", FxIf);

class FxRepeat extends EffectElement {
  toFxNode(): FxNode {
    const count = Number(this.getAttribute("count") || "0");
    const each = this.childrenToFxNodes()[0] ?? fx.none();
    return fx.sequence(...Array.from({ length: count }, () => each));
  }
}
customElements.define("fx-repeat", FxRepeat);

class FxCancel extends EffectElement {
  toFxNode(): FxNode {
    const target = this.getAttribute("target");
    if (!target) return fx.none();
    return fx.call(() => fx.cancel(target));
  }
}
customElements.define("fx-cancel", FxCancel);

// ---- FxEffect Root Element ----

class FxEffect extends EffectElement {
  private _cancel?: () => void;

  connectedCallback() {
    this.attachShadow({ mode: "open" }).innerHTML = `<slot></slot>`;
    const fxNode = this.childrenToFxNodes()[0] ?? fx.none();
    const { cancel } = runCancelable(fxNode);
    this._cancel = cancel;
  }

  disconnectedCallback() {
    this._cancel?.();
  }

  toFxNode(): FxNode {
    return this.childrenToFxNodes()[0] ?? fx.none();
  }
}
customElements.define("fx-effect", FxEffect);