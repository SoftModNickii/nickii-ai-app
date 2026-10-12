// The floating point-cloud head (placeholder until Nickii's real scan exists: assets/mask/ghost_head.svg).
// Inserted as inline SVG: the file has no SVG namespace declaration, so browsers refuse it as an <img>,
// and editing the file would break its C2PA content credentials.

import svgSource from '../../../assets/mask/ghost_head.svg?raw';

let template: SVGSVGElement | null = null;

export function ghostHead(extraClass = ''): SVGSVGElement {
  if (!template) {
    const holder = document.createElement('div');
    holder.innerHTML = svgSource; // HTML parser puts <svg> in the SVG namespace
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
