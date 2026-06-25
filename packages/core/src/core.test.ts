import { describe, it, expect } from 'vitest';
import { randomId, ref, parseRef } from './ids';
import { mulberry32, pick, randInt } from './rng';
import { ageFromBirthDate } from './datetime';
import { ApiError, NotFound } from './errors';

describe('ids', () => {
  it('builds and parses references', () => {
    expect(ref('Patient', '123')).toBe('Patient/123');
    expect(parseRef('Patient/123')).toEqual({ resourceType: 'Patient', id: '123' });
  });
  it('generates prefixed unique ids', () => {
    const a = randomId('pat');
    const b = randomId('pat');
    expect(a).not.toBe(b);
    expect(a.startsWith('pat-')).toBe(true);
  });
});

describe('seeded rng', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect(a()).toBe(b());
    expect(randInt(1, 10, mulberry32(1))).toBe(randInt(1, 10, mulberry32(1)));
  });
  it('picks within bounds', () => {
    const rng = mulberry32(7);
    const arr = ['a', 'b', 'c'];
    expect(arr).toContain(pick(arr, rng));
    expect(randInt(5, 5, rng)).toBe(5);
  });
});

describe('datetime', () => {
  it('computes age from a birth date', () => {
    const year = new Date().getUTCFullYear() - 30;
    expect(ageFromBirthDate(`${year}-01-01`)).toBeGreaterThanOrEqual(29);
  });
});

describe('errors', () => {
  it('carries an http status and problem body', () => {
    const err = NotFound('Patient/x');
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(404);
    expect(err.toProblem().status).toBe(404);
  });
});
