/**
 * Unit tests for pure prompt-builder functions in consultant/prompts.ts.
 * No DB / network — runs as part of `npm test`.
 */

import {
  buildProfileSummaryPrompt,
  buildVibeTranslationPrompt,
  buildNameDescriptionsPrompt,
} from '../consultant/prompts';

// ── buildProfileSummaryPrompt ─────────────────────────────────────────────────

describe('buildProfileSummaryPrompt', () => {
  const base = {
    likedNames: 'Eleanor (French), peak 1920',
    passedNames: 'Brittney (English)',
    likedCount: 5,
    dislikedCount: 2,
    hasPartner: false,
    partnerLikedNames: '',
  };

  it('injects liked and passed names into the user prompt', () => {
    const { profileUser } = buildProfileSummaryPrompt(base);
    expect(profileUser).toContain(base.likedNames);
    expect(profileUser).toContain(base.passedNames);
  });

  it('injects swipe counts into the user prompt', () => {
    const { profileUser } = buildProfileSummaryPrompt(base);
    expect(profileUser).toContain('5 liked');
    expect(profileUser).toContain('2 passed');
  });

  it('omits partner section when hasPartner is false', () => {
    const { profileUser } = buildProfileSummaryPrompt(base);
    expect(profileUser.toLowerCase()).not.toContain('partner');
  });

  it('includes partner names and asks for overlap note when hasPartner is true', () => {
    const { profileUser } = buildProfileSummaryPrompt({
      ...base,
      hasPartner: true,
      partnerLikedNames: 'Oliver (Latin), Hugo (Germanic)',
    });
    expect(profileUser.toLowerCase()).toContain('partner');
    expect(profileUser).toContain('Oliver (Latin), Hugo (Germanic)');
  });

  it('system prompt is non-empty', () => {
    const { profileSystem } = buildProfileSummaryPrompt(base);
    expect(profileSystem.length).toBeGreaterThan(0);
  });
});

// ── buildVibeTranslationPrompt ────────────────────────────────────────────────

describe('buildVibeTranslationPrompt', () => {
  const data = {
    vibeText: 'something unusual with a nature feel',
    profileSummary: 'You seem drawn to vintage French names.',
  };

  it('injects vibe text and profile summary', () => {
    const { vibeUser } = buildVibeTranslationPrompt(data);
    expect(vibeUser).toContain(data.vibeText);
    expect(vibeUser).toContain(data.profileSummary);
  });

  it('instructs model to return the four required JSON keys', () => {
    const { vibeUser } = buildVibeTranslationPrompt(data);
    expect(vibeUser).toContain('originBoosts');
    expect(vibeUser).toContain('popularityTierShift');
    expect(vibeUser).toContain('syllablePreference');
    expect(vibeUser).toContain('notes');
  });

  it('lists available origins so the model can pick from them', () => {
    const { vibeUser } = buildVibeTranslationPrompt(data);
    expect(vibeUser).toContain('French');
    expect(vibeUser).toContain('Hebrew');
    expect(vibeUser).toContain('Scandinavian');
  });

  it('system prompt is non-empty', () => {
    const { vibeSystem } = buildVibeTranslationPrompt(data);
    expect(vibeSystem.length).toBeGreaterThan(0);
  });
});

// ── buildNameDescriptionsPrompt ───────────────────────────────────────────────

describe('buildNameDescriptionsPrompt', () => {
  const data = {
    profileSummary: 'You seem drawn to vintage French names with soft consonants.',
    vibeText: 'something unusual',
    nameList: '- Eleanor: girl, French, peak 1920\n- Colette: girl, French, peak 1940',
  };

  it('injects profile summary and name list', () => {
    const { descUser } = buildNameDescriptionsPrompt(data);
    expect(descUser).toContain(data.profileSummary);
    expect(descUser).toContain(data.nameList);
  });

  it('injects vibe text when provided', () => {
    const { descUser } = buildNameDescriptionsPrompt(data);
    expect(descUser).toContain(data.vibeText);
  });

  it('omits vibe section when vibeText is empty string', () => {
    const { descUser } = buildNameDescriptionsPrompt({ ...data, vibeText: '' });
    expect(descUser).not.toContain('Vibe they requested');
  });

  it('instructs model to return a JSON array with name and description keys', () => {
    const { descUser } = buildNameDescriptionsPrompt(data);
    expect(descUser).toContain('"name"');
    expect(descUser).toContain('"description"');
  });

  it('system prompt is non-empty', () => {
    const { descSystem } = buildNameDescriptionsPrompt(data);
    expect(descSystem.length).toBeGreaterThan(0);
  });
});
