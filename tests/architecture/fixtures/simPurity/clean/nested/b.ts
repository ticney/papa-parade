import { clamp } from '@shared/math';

export const half = (x: number): number => clamp(x, 0, 1) / 2;
