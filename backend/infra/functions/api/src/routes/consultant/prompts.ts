interface ProfileSummaryData {
  likedNames: string;
  passedNames: string;
  likedCount: number;
  dislikedCount: number;
  hasPartner: boolean;
  partnerLikedNames: string;
}

interface VibeTranslationData {
  vibeText: string;
  profileSummary: string;
}

interface NameDescriptionsData {
  profileSummary: string;
  vibeText: string;
  nameList: string;
}

const AVAILABLE_ORIGINS = [
  'Hebrew', 'Latin', 'Greek', 'Ancient Greek', 'Old French', 'French',
  'Middle English', 'Old English', 'Germanic', 'Old Norse', 'Scandinavian',
  'Irish', 'Welsh', 'Scottish Gaelic', 'Celtic', 'Spanish', 'Italian',
  'Portuguese', 'Dutch', 'German', 'Russian', 'Polish', 'Slavic',
  'Persian', 'Arabic', 'Sanskrit', 'Sanskrit/Hindi', 'Turkish',
  'Chinese', 'Japanese', 'Korean',
].join(', ');

export function buildProfileSummaryPrompt(data: ProfileSummaryData) {
  const profileSystem = `You are a warm, knowledgeable baby name consultant. You speak naturally and personally — never clinical or generic.`;

  const partnerSection = data.hasPartner && data.partnerLikedNames
    ? `\nAlso write 1 sentence about their partner's taste and note where the two overlap.\nPartner liked names: ${data.partnerLikedNames}`
    : '';

  const profileUser = `Based on this user's name preferences, write 1-2 sentences describing what they seem drawn to. Be specific about the patterns you notice — style, sound, origin, popularity. Speak directly to them ("You seem drawn to...").

User taste data:
- Top liked names: ${data.likedNames}
- Top passed names: ${data.passedNames}
- Swipe counts: ${data.likedCount} liked, ${data.dislikedCount} passed
${partnerSection}

Return only the prose — no labels, no JSON, no preamble.`;

  return { profileSystem, profileUser };
}

export function buildVibeTranslationPrompt(data: VibeTranslationData) {
  const vibeSystem = `You are a baby name recommendation engine assistant. Your job is to translate a user's natural language preference into structured retrieval parameters.`;

  const vibeUser = `The user described what they're looking for as: "${data.vibeText}"

Their current taste profile: ${data.profileSummary}

Available origins: ${AVAILABLE_ORIGINS}
Popularity tiers: 1 (top 10), 2 (top 100), 3 (top 500), 4 (top 1000), 5 (rare)

Return ONLY a JSON object with no preamble or markdown:
{
  "originBoosts": [],
  "popularityTierShift": 0,
  "syllablePreference": null,
  "notes": ""
}

originBoosts: list of origin strings to weight more heavily from the available origins (empty if no change)
popularityTierShift: integer -2 to +2 (negative = more popular, positive = rarer)
syllablePreference: integer or null if no preference
notes: brief internal note on interpretation (not shown to user)`;

  return { vibeSystem, vibeUser };
}

export function buildNameDescriptionsPrompt(data: NameDescriptionsData) {
  const descSystem = `You are a warm baby name consultant writing personalized notes for a specific user. Each note should feel tailored — reference what you know about their taste specifically.`;

  const vibeSection = data.vibeText ? `\nVibe they requested: ${data.vibeText}` : '';

  const descUser = `Write one personalized sentence for each name explaining why it fits this particular user's taste. Do not describe the name generically — connect it to their specific preferences.

User taste summary: ${data.profileSummary}${vibeSection}

Names to describe:
${data.nameList}

Return ONLY a JSON array, no preamble or markdown:
[
  { "name": "Eleanor", "description": "..." },
  ...
]`;

  return { descSystem, descUser };
}
