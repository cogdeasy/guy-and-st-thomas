import { describe, it, expect } from 'vitest';
import { calculateNews2, generateNhsNumber, isValidNhsNumber } from './terminology';
import { mulberry32 } from '@trustos/core';

describe('NHS number validation', () => {
  it('accepts a known valid NHS number', () => {
    expect(isValidNhsNumber('943 476 5919')).toBe(true);
  });
  it('rejects an invalid check digit', () => {
    expect(isValidNhsNumber('1234567890')).toBe(false);
  });
  it('generates valid NHS numbers deterministically', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 50; i++) {
      expect(isValidNhsNumber(generateNhsNumber(rng))).toBe(true);
    }
  });
});

describe('NEWS2 scoring', () => {
  it('scores a stable patient as low risk', () => {
    const r = calculateNews2({
      respiratoryRate: 16,
      spo2: 98,
      onOxygen: false,
      systolicBp: 120,
      pulse: 70,
      consciousness: 'A',
      temperature: 36.8,
    });
    expect(r.score).toBe(0);
    expect(r.risk).toBe('low');
  });
  it('escalates a deteriorating patient to high risk', () => {
    const r = calculateNews2({
      respiratoryRate: 28,
      spo2: 91,
      onOxygen: true,
      systolicBp: 88,
      pulse: 135,
      consciousness: 'V',
      temperature: 39.5,
    });
    expect(r.score).toBeGreaterThanOrEqual(7);
    expect(r.risk).toBe('high');
  });
});
