const paths = {
  shield: 'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z',
  verified: 'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z M8.5 12l2.5 2.5 4.5-5',
  alert: 'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z M12 8v5m0 3v.01',
  pending: 'M12 4a8 8 0 1 1-8 8',
  copy: 'M8 5V3h8v2H8ZM8 4H5v17h14V4h-3',
  refresh:
    'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1',
  close: 'm18 6-12 12M6 6l12 12',
};

export function createIcon(name: keyof typeof paths): SVGSVGElement {
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '2');
  icon.setAttribute('stroke-linecap', 'round');
  icon.setAttribute('stroke-linejoin', 'round');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('focusable', 'false');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', paths[name]);
  icon.append(path);
  if (name === 'pending') icon.classList.add('nearai-verification-spinner');
  return icon;
}
