// The floating point-cloud head (placeholder until Nickii's real scan exists).
// 3D (Three.js) where WebGL works and motion is allowed; otherwise the flat assets/mask/ghost_head.svg.

import svgSource from '../../../assets/mask/ghost_head.svg?raw';

export interface GhostHead {
  el: HTMLElement;
  setAway(away: boolean): void;
  dispose(): void;
}

let template: SVGSVGElement | null = null;

/** The SVG file has no namespace declaration, so it is inserted inline (browsers refuse it as <img>). */
export function ghostHeadSvg(extraClass = ''): SVGSVGElement {
  if (!template) {
    const holder = document.createElement('div');
    holder.innerHTML = svgSource; // the HTML parser puts <svg> in the SVG namespace
    template = holder.querySelector('svg')!;
    template.querySelector('metadata')?.remove();
    template.setAttribute('viewBox', template.getAttribute('viewBox') ?? '0 0 300 360');
    template.removeAttribute('width');
    template.removeAttribute('height');
    template.setAttribute('aria-hidden', 'true');
  }
  const svg = template.cloneNode(true) as SVGSVGElement;
  svg.setAttribute('class', `ghost ${extraClass}`.trim());
  return svg;
}

/** Decides 3D or flat. `force` is for tests and previews. */
export async function ghostHead(extraClass = '', force?: 'svg' | '3d'): Promise<GhostHead> {
  const want3d = force === '3d' || (force !== 'svg' && await can3d());
  if (want3d) {
    try {
      const { ghostHead3D } = await import('./ghost_head_3d');
      const head = ghostHead3D();
      head.el.className = `ghost ghost-3d ${extraClass}`.trim();
      return head;
    } catch (err) {
      console.warn('3D head failed, using the flat one', err);
    }
  }
  const svg = ghostHeadSvg(extraClass);
  return {
    el: svg as unknown as HTMLElement,
    setAway(away) { svg.classList.toggle('away', away); },
    dispose() {},
  };
}

/** Checked here, without loading Three.js, so phones without WebGL never download it. */
async function can3d(): Promise<boolean> {
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}
