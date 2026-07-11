// src/blooky-fp-graphviz.ts
//
// FRP graph introspection/visualization.
// Depends only on blooky-fp's public introspection surface
// (vertex, isVertex, isChainedProp, isDripperStream, isStream).
// Knows nothing about fxdom, Clock, or execution — this is not
// "devtools observing fxdom", it's a standalone tool over blooky-fp.

import { isChainedProp, isDripperStream, isStream, isVertex, vertex } from "./blooky-fp";
import { DripperStream, Prop, Stream, Vertex, MergedStream } from "./blooky-fp-types";

export function dumpGraphDOT(
  entries: Record<string, Stream<any> | Prop<any> | unknown>,
  graphAttrs: Record<string, string> = { rankdir: "LR" }
): string {
  const vertex_map: [string, any][] = Object.entries(entries).map(([k, v]) => [k, isStream(v) ? vertex(v) : v]);

  const names = new WeakMap(vertex_map.map(([k, v]) => [Object(v), k]));
  const visited = new WeakMap<any, string>();
  const edges: string[] = [];
  const nodes: string[] = [];
  let counter = 0;

  function addNode(label: string, attrs: Record<string, any>) {
    const id = `n${counter++}`;
    const attrsList = [`label="${label}"`];
    if (attrs) attrsList.push(...Object.entries(attrs).map(([k, v]) => `${k}="${v}"`));
    nodes.push(`${id} [${attrsList.join(" ")}]`);
    return id;
  }

  function getShape(node: Stream<any>) {
    if (isDripperStream(node)) return "ellipse";
    if ("mapFn" in node) return "diamond";
    if ("filterFn" in node) return "triangle";
    if ("reduceFn" in node) return "hexagon";
    return "plain";
  }

  function visit(obj: Vertex | Prop<any>, label: string) {
    if (visited.has(obj)) return visited.get(obj)!;

    if (isChainedProp<any>(obj)) {
      const value = obj();
      const valueLabel =
        typeof value === "symbol" ? `symbol(${value.description || ""})` :
        typeof value === "string" ? `\\"${value.replace(/"/g, '\\"')}\\"` :
        String(value);

      const id = addNode(label + "|" + valueLabel, {
        id: label,
        shape: "record",
        class: "prop " + (value === null ? "null" : typeof value),
      });
      visited.set(obj, id);
      return id;
    }

    if (!isVertex(obj)) {
      const id = addNode(label, { id: names.get(obj) || "unknown", shape: "circle" });
      visited.set(obj, id);
      return id;
    }

    const nodeAttr = names.has(obj)
      ? { id: "node-" + label, shape: getShape(obj.sourceStream) }
      : { shape: "point" };

    const id = addNode(label, nodeAttr);
    visited.set(obj, id);

    const next = [...(obj.next ?? []), ...(obj.lazyNext ?? [])];
    if (next.length) {
      edges.push(
        ...next.map((target) => {
          const targetLabel = names.get(target) || "Stream";
          const targetId = visit(target, targetLabel);
          return `${id} -> ${targetId}`;
        })
      );
    }

    const props = obj.props;
    if (props) edges.push(...props.map((p) => `${id} -> ${visit(p, names.get(p) || "none")}`));
    return id;
  }

  vertex_map.forEach(([name, streamOrProp]) => visit(streamOrProp, name));

  const digraph_attrs = Object.entries(graphAttrs).map((v) => v.join("=")).join(";\n");
  return `digraph BlookyGraph {\ngraph [\n${digraph_attrs}\n];\n${nodes.join("\n")}\n${edges.join("\n")}\n}`;
}

export function dripGraph<A>(
  value: A
): (dripper: DripperStream<A>) => {
  dripper: DripperStream<A>;
  value: A;
  streams: Map<Stream<any>, any>;
  effects: Map<Prop<any>, any>;
} {
  return (dripper) => {
    const lazy = new Map<Vertex, any[]>();
    const streams = new Map<Stream<any>, any>();
    const effects = new Map<Prop<any>, any>();

    const walk = (v: any) => (vert: Vertex) => {
      streams.set(vert.sourceStream, v);
      vert.props?.forEach((p) => effects.set(p, v));

      if (vert.lazyNext) {
        vert.lazyNext.forEach((lazySource) => {
          if (lazy.has(lazySource)) lazy.get(lazySource)!.push(v);
          else lazy.set(lazySource, [v]);
        });
      }

      if (vert.next?.length) {
        vert.next
          .filter(({ sourceStream }) => !("filterFn" in sourceStream) || sourceStream.filterFn(v))
          .forEach((s) => walk("mapFn" in s.sourceStream ? s.sourceStream.mapFn(v) : v)(s));
      }
    };

    walk(value)(vertex(dripper));

    while (lazy.size) {
      const entries = [...lazy];
      lazy.clear();
      entries.forEach(([s, values]) => walk(values.reduce((s.sourceStream as MergedStream<any>).reduceFn))(s));
    }

    return { dripper, value, streams, effects };
  };
}
