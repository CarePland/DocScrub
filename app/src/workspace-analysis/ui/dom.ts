/**
 * dom.ts — tiny local DOM helpers, deliberately NOT imported from
 * `src/ui/app.ts` (which has its own `el()`/`button()`). Two independent
 * three-line helpers are cheaper, and safer, than a dependency: the
 * integration direction for this subsystem is app.ts -> workspace-analysis
 * (see `../../ui/app.ts`'s planned single entry point), never the
 * reverse, so importing from app.ts here would create exactly the kind
 * of file-level coupling the concurrency requirement asks this
 * subsystem to avoid.
 */

type Attrs = Record<string, string>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) {
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

export function button(label: string, attrs: Attrs, onClick: () => void): HTMLButtonElement {
  const node = el("button", { type: "button", ...attrs }, label);
  node.addEventListener("click", onClick);
  return node;
}
