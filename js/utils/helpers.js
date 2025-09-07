export const rndId = (p = 'it') => `${p}_${Math.random().toString(36).slice(2, 9)}`;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a, b, t) => a + (b - a) * t;
export const lpt = (A, B, t) => ({ x: lerp(A.x, B.x, t), y: lerp(A.y, B.y, t) });
export const nearly = (a, b, eps = 6) => Math.abs(a - b) <= eps;
export const getCssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
export const snapIfNeeded = (pt, grid = 16) => {
  if (!window.keys?.ctrl) return pt;
  return { x: Math.round(pt.x / grid) * grid, y: Math.round(pt.y / grid) * grid };
};