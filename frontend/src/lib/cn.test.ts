import { describe, it, expect } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('joins truthy class names', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  it('drops falsy values', () => {
    expect(cn('a', false, null, undefined, '', 'b')).toBe('a b');
  });

  it('honors conditional object syntax', () => {
    expect(cn('base', { active: true, hidden: false })).toBe('base active');
  });

  it('lets later Tailwind utilities win conflicts (twMerge)', () => {
    // p-2 then p-4 -- the last padding should survive, not both.
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });

  it('merges conflicting color utilities', () => {
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
  });

  it('returns empty string for no input', () => {
    expect(cn()).toBe('');
  });
});
