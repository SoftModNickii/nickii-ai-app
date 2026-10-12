// Tiny DOM helper: h('button', { class: 'btn', onclick }, 'Send').

type Child = Node | string | null | undefined | false;
type Props<K extends keyof HTMLElementTagNameMap> =
  Partial<Omit<HTMLElementTagNameMap[K], 'style' | 'children'>> & {
    class?: string;
    style?: string;
    attrs?: Record<string, string>;
  };

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K, props: Props<K> = {}, ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const { class: cls, style, attrs, ...rest } = props;
  if (cls) el.className = cls;
  if (style) el.setAttribute('style', style);
  for (const [k, v] of Object.entries(attrs ?? {})) el.setAttribute(k, v);
  Object.assign(el, rest);
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export function clear(el: Element): void {
  while (el.firstChild) el.firstChild.remove();
}
