import { ExecutionContext, YieldConditionRef, YieldLocator, FxRef as FxRefType } from "../blooky-fx-types";
import { isFxRefKey } from "./engine";

/**
 * DOM-specific yield locator resolution.
 * This function is separated from blooky-fxdom.ts to avoid circular dependencies.
 */
export const resolveYieldLocator = (
  until: YieldConditionRef,
  ctx: ExecutionContext
): YieldLocator => {
  if (until.kind !== "yield") throw new Error("unsupported yield condition");
  const t = until.target;
  const raw = (t as any).ref;
  const resolved =
    isFxRefKey(raw) || typeof raw === "function"
      ? ctx.config.resolver(raw as FxRefType<unknown>, ctx)() || document.getElementById(raw.key?.slice(1))
      : raw;

  if (typeof raw === "string") return { kind: "template", templateId: raw };
  if (resolved instanceof HTMLTemplateElement) return { kind: "template-el", el: resolved };
  if (raw?.kind === "template" && raw.el instanceof HTMLTemplateElement) return raw;
  if (raw?.kind === "template-id" && typeof raw.id === "string") return raw;

  throw new Error("Unsupported local yield target ref (expected {kind:'template'|'template-id', ...})");
};
