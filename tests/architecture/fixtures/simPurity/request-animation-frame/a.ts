export const next = (fn: () => void): void => { requestAnimationFrame(fn); };
