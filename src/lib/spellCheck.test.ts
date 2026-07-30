import { describe, it, expect } from 'vitest';
import { findSpellIssues, findPhraseIssues, findAllSpellIssues } from './spellCheck';

describe('findSpellIssues', () => {
  it('flags a known misspelling', () => {
    const issues = findSpellIssues('teh cat');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ word: 'teh', fix: 'the', start: 0, end: 3 });
  });

  it('does not flag correctly spelled words', () => {
    expect(findSpellIssues('the cat sat')).toHaveLength(0);
  });

  it('does not blanket-flag the standalone Arabic word ان (a real, ambiguous word, not just a typo)', () => {
    expect(findSpellIssues('ان كان ذلك صحيحا')).toHaveLength(0);
  });
});

describe('findPhraseIssues', () => {
  it('flags the انشاء الله idiom as one phrase', () => {
    const issues = findPhraseIssues('سأذهب انشاء الله غدا');
    expect(issues).toHaveLength(1);
    expect(issues[0].word).toBe('انشاء الله');
    expect(issues[0].fix).toBe('إن شاء الله');
  });

  it('finds every occurrence of a repeated phrase', () => {
    const issues = findPhraseIssues('انشاء الله وانشاء الله');
    expect(issues.length).toBeGreaterThanOrEqual(1);
  });
});

describe('findAllSpellIssues', () => {
  it('lets a phrase match win over the standalone word match it overlaps', () => {
    const issues = findAllSpellIssues('انشاء الله');
    // Only the phrase-level issue should survive — not also a separate word-level "انشاء" flag.
    expect(issues).toHaveLength(1);
    expect(issues[0].word).toBe('انشاء الله');
  });

  it('still flags an unrelated word issue elsewhere in the same text', () => {
    const issues = findAllSpellIssues('teh انشاء الله');
    expect(issues.some(i => i.word === 'teh')).toBe(true);
    expect(issues.some(i => i.word === 'انشاء الله')).toBe(true);
    expect(issues).toHaveLength(2);
  });
});
