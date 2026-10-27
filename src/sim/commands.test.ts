import { describe, expect, it } from 'vitest';
import { COMMAND_TYPES, commandProblem } from './commands.ts';

describe('commandProblem', () => {
  it('accepts well formed commands of every type', () => {
    expect(commandProblem({ type: 'SetTimeScale', t: 0, scale: 0.5 })).toBeNull();
    expect(commandProblem({ type: 'TapFloor', t: 10, xM: 1.5, zM: -2 })).toBeNull();
    expect(commandProblem({ type: 'Move', t: 10, dirX: 0, dirZ: -3 })).toBeNull();
    expect(commandProblem({ type: 'MoveStop', t: 10 })).toBeNull();
  });

  it('knows every command type it accepts', () => {
    expect([...COMMAND_TYPES].sort()).toEqual(['Move', 'MoveStop', 'SetTimeScale', 'TapFloor']);
  });

  it.each([
    ['NaN xM', { type: 'TapFloor', t: 0, xM: Number.NaN, zM: 0 }, /xM/],
    ['Infinity zM', { type: 'TapFloor', t: 0, xM: 0, zM: Number.POSITIVE_INFINITY }, /zM/],
    ['a string xM', { type: 'TapFloor', t: 0, xM: '1', zM: 0 }, /xM/],
    ['a missing zM', { type: 'TapFloor', t: 0, xM: 1 }, /zM/],
    ['a NaN dirX', { type: 'Move', t: 0, dirX: Number.NaN, dirZ: 1 }, /dirX/],
    ['an Infinity dirZ', { type: 'Move', t: 0, dirX: 1, dirZ: Number.NEGATIVE_INFINITY }, /dirZ/],
    ['a zero vector', { type: 'Move', t: 0, dirX: 0, dirZ: 0 }, /\(0, 0\)/],
    ['a negative zero vector', { type: 'Move', t: 0, dirX: -0, dirZ: 0 }, /\(0, 0\)/],
    ['a non-finite t', { type: 'MoveStop', t: Number.NaN }, /finite/],
    ['an unknown type', { type: 'Teleport', t: 0 }, /unknown command type/],
    ['a non-object', 42, /object/],
  ])('refuses %s', (_name, command, message) => {
    expect(commandProblem(command)).toMatch(message);
  });
});
