import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_FIELD_MAX_CHARS,
  ANALYSIS_FIELDS,
  isWellFormedParticipantKey,
  parseAnalysisResponse,
  PARTICIPANT_KEY_MAX_LENGTH,
  validateAnalysis,
} from '../contract';
import { SAMPLE_ANALYSIS } from '@/test/fakes';

describe('validateAnalysis', () => {
  it('accepts exactly the seven fields and trims them', () => {
    const result = validateAnalysis({ ...SAMPLE_ANALYSIS, textAndSigns: '  Cyrillic shop sign.\n' });
    expect(result).toEqual({ ok: true, analysis: SAMPLE_ANALYSIS });
    expect(ANALYSIS_FIELDS).toHaveLength(7);
  });

  it.each([
    ['null', null, 'not_object'],
    ['an array', [], 'not_object'],
    ['a string', 'text', 'not_object'],
    ['a missing field', { ...SAMPLE_ANALYSIS, overallAssessment: undefined }, 'missing_field'],
    ['a blank field', { ...SAMPLE_ANALYSIS, culturalIndicators: '   ' }, 'invalid_field'],
    ['a non-string field', { ...SAMPLE_ANALYSIS, vehiclesAndPlates: 3 }, 'invalid_field'],
    ['a null field', { ...SAMPLE_ANALYSIS, vehiclesAndPlates: null }, 'invalid_field'],
    ['an oversized field', { ...SAMPLE_ANALYSIS, textAndSigns: 'x'.repeat(ANALYSIS_FIELD_MAX_CHARS + 1) }, 'field_too_long'],
    ['an extra field', { ...SAMPLE_ANALYSIS, rawResponse: 'model text' }, 'unexpected_field'],
  ])('rejects %s', (_label, value, problem) => {
    expect(validateAnalysis(value)).toEqual({ ok: false, problem });
  });
});

describe('parseAnalysisResponse', () => {
  const valid = {
    analysis: SAMPLE_ANALYSIS,
    selection: { provider: 'gemini', model: 'gemini-flash' },
    credentialSource: 'operator',
    requestId: 'req-1',
  };

  it('accepts a well-formed response', () => {
    expect(parseAnalysisResponse(valid)).toEqual(valid);
  });

  it.each([
    ['an invalid analysis', { ...valid, analysis: { textAndSigns: 'x' } }],
    ['an unknown provider', { ...valid, selection: { provider: 'other', model: 'm' } }],
    ['no selection', { ...valid, selection: undefined }],
    ['an unknown credential source', { ...valid, credentialSource: 'shared' }],
    ['no request ID', { ...valid, requestId: undefined }],
  ])('rejects %s', (_label, body) => {
    expect(parseAnalysisResponse(body)).toBeNull();
  });
});

describe('isWellFormedParticipantKey', () => {
  it('accepts printable keys up to the length bound without prefix rules', () => {
    expect(isWellFormedParticipantKey('any-shape_of.key~123')).toBe(true);
    expect(isWellFormedParticipantKey('k'.repeat(PARTICIPANT_KEY_MAX_LENGTH))).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['too long', 'k'.repeat(PARTICIPANT_KEY_MAX_LENGTH + 1)],
    ['containing a space', 'abc def'],
    ['containing a line break', 'abc\r\nX-Injected: 1'],
    ['containing non-ASCII', 'clé'],
  ])('rejects a key %s', (_label, key) => {
    expect(isWellFormedParticipantKey(key)).toBe(false);
  });
});
