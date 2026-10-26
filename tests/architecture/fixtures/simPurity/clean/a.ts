// No Date, Math.random, window, document or performance here, and no import of three either.
/* setTimeout and requestAnimationFrame in a block comment */
export const note = 'Date.now() and window and import three';
export const template = `Math.random ${1 + 1} localStorage`;
export const pattern = /window|document/;

export function read(threat: { windowMs: number }): number {
  return threat.windowMs;
}
