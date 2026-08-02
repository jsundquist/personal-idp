import { parseTaskComment } from './TaskCommentMetadata';

describe('parseTaskComment', () => {
  it('returns self-serve for an absent comment', () => {
    expect(parseTaskComment(undefined)).toEqual({ candidateGroups: [] });
  });

  it('returns self-serve for an empty comment', () => {
    expect(parseTaskComment('')).toEqual({ candidateGroups: [] });
  });

  it('returns self-serve for plain human text (not JSON)', () => {
    expect(parseTaskComment('Maps to BPMN subProcess phase-1')).toEqual({ candidateGroups: [] });
  });

  it('returns self-serve for malformed JSON', () => {
    expect(parseTaskComment('{"candidateGroups": [')).toEqual({ candidateGroups: [] });
  });

  it('returns self-serve for valid JSON without a candidateGroups key', () => {
    expect(parseTaskComment('{}')).toEqual({ candidateGroups: [] });
  });

  it('returns self-serve for an explicit empty candidateGroups array', () => {
    expect(parseTaskComment(JSON.stringify({ candidateGroups: [] }))).toEqual({ candidateGroups: [] });
  });

  it('parses candidateGroups from valid JSON', () => {
    expect(parseTaskComment(JSON.stringify({ candidateGroups: ['legal-team'] }))).toEqual({
      candidateGroups: ['legal-team'],
    });
  });

  it('parses formKey alongside candidateGroups', () => {
    expect(
      parseTaskComment(JSON.stringify({ candidateGroups: ['legal-team'], formKey: 'legal-review-form' })),
    ).toEqual({ candidateGroups: ['legal-team'], formKey: 'legal-review-form' });
  });

  it('ignores non-string entries in candidateGroups', () => {
    expect(parseTaskComment(JSON.stringify({ candidateGroups: ['legal', 42, null] }))).toEqual({
      candidateGroups: ['legal'],
    });
  });
});
