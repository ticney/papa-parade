import { createSim } from '@sim';
import { a } from '@shared/a';
import { schema } from '@content/schema';
import { haptics } from '@platform/a';
import { Vector3 } from 'three';
import './ui/styles/ui.css';

export const boot = async () => {
  const overlay = await import('@debug/overlay');
  const bot = await import('@bots/a');
  return [createSim, a, schema, haptics, Vector3, overlay, bot];
};
