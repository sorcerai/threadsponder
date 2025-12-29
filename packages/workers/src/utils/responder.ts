/**
 * Smart Response Generator
 *
 * Multi-tenant response generation with:
 * - Voice matching from tenant's trained examples
 * - Style adaptation to match replier's energy
 * - Friends list awareness for special treatment
 */

import type { VoiceSettings, VoiceExample, Friend } from '@threadsponder/shared';
import type { Classification } from './classifier.js';

// OpenRouter config
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export interface VoiceStyle {
  energy: 'high' | 'medium' | 'low';
  formality: 'formal' | 'casual' | 'unhinged';
  brevity: 'terse' | 'normal' | 'verbose';
  usesEmoji: boolean;
  usesSlang: boolean;
  allCaps: boolean;
  aggressive: boolean;
}

export interface ResponseContext {
  originalPost: string;
  replyText: string;
  username: string;
  classification: Classification;
  voiceSettings: VoiceSettings | null;
  voiceExamples: VoiceExample[];
  friends: Friend[];
  isMetaComment?: boolean;  // P3: Fourth-wall handling
  confidence?: number;  // P4: Confidence-based pivots
  recentReplies?: string[];  // Recent bot replies to avoid repetition
}

export interface GeneratedResponse {
  reply: string;
  source: string;
  generationTimeMs: number;
  voiceExamplesUsed: number;
  isFriend: boolean;
  friendMode: 'banter' | 'roast' | null;
}

/**
 * Analyze replier's voice style from their text
 */
export function analyzeVoiceStyle(text: string): VoiceStyle {
  const words = text.split(/\s+/).length;
  const chars = text.length;

  // Energy detection
  const capsRatio = (text.match(/[A-Z]/g) || []).length / Math.max(chars, 1);
  const exclamations = (text.match(/!/g) || []).length;
  const allCaps = capsRatio > 0.5 && chars > 10;

  let energy: 'high' | 'medium' | 'low' = 'medium';
  if (allCaps || exclamations >= 3 || capsRatio > 0.3) energy = 'high';
  else if (text === text.toLowerCase() && exclamations === 0) energy = 'low';

  // Formality detection
  const slangPatterns =
    /\b(lol|lmao|bruh|fr|ngl|idk|tbh|rn|af|lowkey|highkey|deadass|no cap|ong|bet|fam|vibes|slay|bussin|mid|based|cope|seethe|ratio)\b/gi;
  const usesSlang = slangPatterns.test(text);
  const formalPatterns =
    /\b(however|therefore|furthermore|regarding|concerning|subsequently)\b/gi;
  const isFormal = formalPatterns.test(text);

  let formality: 'formal' | 'casual' | 'unhinged' = 'casual';
  if (isFormal && !usesSlang) formality = 'formal';
  else if (allCaps || (usesSlang && exclamations >= 2)) formality = 'unhinged';

  // Brevity detection
  let brevity: 'terse' | 'normal' | 'verbose' = 'normal';
  if (words <= 5) brevity = 'terse';
  else if (words > 30 || chars > 200) brevity = 'verbose';

  // Emoji detection
  const emojiPattern =
    /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu;
  const usesEmoji = emojiPattern.test(text);

  // Aggression detection
  const aggressivePatterns =
    /\b(stfu|gtfo|fuck|shit|ass|dumb|stupid|idiot|moron|clown|trash|garbage|pathetic|loser|cope|seethe|ratio|L\b|W\b)\b/gi;
  const aggressive = aggressivePatterns.test(text) || (allCaps && words > 3);

  return {
    energy,
    formality,
    brevity,
    usesEmoji,
    usesSlang,
    allCaps,
    aggressive,
  };
}

/**
 * Format voice matching instructions for LLM
 */
function formatStylePrompt(
  style: VoiceStyle,
  classification: Classification,
  settings: VoiceSettings | null
): string {
  const instructions: string[] = [];

  // Energy matching
  if (style.energy === 'high') {
    instructions.push('Match their high energy - be punchy and direct');
  } else if (style.energy === 'low') {
    instructions.push('Keep it chill and lowkey');
  }

  // Formality matching
  if (style.formality === 'unhinged') {
    instructions.push("They're unhinged - you can be raw but stay safe");
  } else if (style.formality === 'formal') {
    instructions.push("They're being formal - you can be dismissive but articulate");
  } else {
    instructions.push('Keep it casual');
  }

  // Brevity matching with settings
  const lengthSettings = settings?.response_lengths?.[classification] || { min: 3, max: 15 };
  if (style.brevity === 'terse') {
    instructions.push(`Ultra short reply - ${lengthSettings.min}-${Math.min(lengthSettings.max, 5)} words max`);
  } else if (style.brevity === 'verbose') {
    instructions.push(`They wrote a lot - you can write up to ${lengthSettings.max} words`);
  } else {
    instructions.push(`Keep it brief - under ${lengthSettings.max} words`);
  }

  // Apply settings
  if (settings) {
    if (settings.emoji_usage > 0.6 && style.usesEmoji) {
      instructions.push('Can use 1-2 emojis if it fits');
    } else if (settings.emoji_usage < 0.3) {
      instructions.push('No emoji');
    }

    if (settings.never_say.length > 0) {
      instructions.push(`NEVER use these words: ${settings.never_say.join(', ')}`);
    }

    if (settings.signature_phrases.length > 0) {
      instructions.push(
        `Consider using one of these signature phrases naturally: ${settings.signature_phrases.slice(0, 3).join(', ')}`
      );
    }
  }

  // Style elements
  if (style.usesSlang) {
    instructions.push('Use internet slang if natural (lol, fr, ngl, etc)');
  }
  if (style.allCaps && classification === 'hostile') {
    instructions.push("They're yelling - stay lowercase to assert dominance");
  }

  // Safety rails
  instructions.push('SAFETY: Never use slurs, threats, or personal attacks');

  return `[VOICE MATCHING]\n${instructions.map((i) => `- ${i}`).join('\n')}`;
}

/**
 * Format voice examples for the prompt
 */
function formatVoiceExamples(examples: VoiceExample[], classification: Classification): string {
  if (examples.length === 0) return '';

  const relevantExamples = examples.filter((e) => e.tone === classification).slice(0, 5);
  if (relevantExamples.length === 0) return '';

  return `
[YOUR VOICE EXAMPLES - Match this style]
${relevantExamples.map((e) => `"${e.text}"`).join('\n')}
`;
}

interface OpenRouterResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

/**
 * Generate a response using OpenRouter
 */
export async function generateResponse(
  ctx: ResponseContext,
  apiKey: string,
  model: string = 'anthropic/claude-3.5-haiku'
): Promise<GeneratedResponse> {
  const startTime = Date.now();

  // Check if replier is a friend
  const friend = ctx.friends.find(
    (f) => f.username.toLowerCase() === ctx.username.toLowerCase()
  );
  const isFriend = !!friend;
  let friendMode: 'banter' | 'roast' | null = null;

  if (isFriend) {
    friendMode = friend.mode === 'roast' ? 'roast' : 'banter';
  }

  // Analyze their voice style
  const voiceStyle = analyzeVoiceStyle(ctx.replyText);

  // Build the prompt
  const stylePrompt = formatStylePrompt(voiceStyle, ctx.classification, ctx.voiceSettings);
  const voiceExamplesPrompt = formatVoiceExamples(ctx.voiceExamples, ctx.classification);

  // Classification-specific instructions
  let toneInstructions: Record<string, string> = {
    friendly: isFriend && friendMode === 'banter'
      ? 'This is a friend - be warm and genuinely engaged. Match their positive energy.'
      : 'Be appreciative and genuine. Keep it brief but warm.',
    neutral:
      'Be helpful but brief. Answer questions directly or acknowledge their point.',
    hostile: isFriend && friendMode === 'roast'
      ? "This is a friend being playful - tease them back with love. It's friendly banter, not real hostility."
      : `Deliver short, dismissive clap-backs. Under 10 words. Attack their BEHAVIOR not their argument. Never explain, never defend. lowercase only.

🎯 WINNING PATTERNS (use these):
- Frame effort as obsession: "you wrote a whole book report on me? cute", "you prepared a whole lesson plan?"
- Mock their tone: "spare me the sermon", "pulling out the dictionary is desperate", "spare me the vocabulary lesson"
- Flip their insult: "passion is a cute word for coping", "save the poetry for the diary"
- Sarcastic acknowledgment: "nothing gets past you huh", "nice detective skills", "you'll recover"
- Meta-dismissal: "you're really invested in this huh", "that's a lot of words"
- Call out strawman: "you invented a whole backstory for me? cute", "writing fanfic about my thoughts is cute"

🚫 NEVER USE (banned phrases):
- "sounds like..." / "sounds personal"
- "imagine..." at start of reply
- "bold of you..."
- "projection is wild"
- "cope" / "seethe" / "ratio"
- "federal courts" / legal jargon
- "lot of emotion for a jpeg" / any "for a jpeg/png" dismissal
- anything defensive or explanatory

📝 VARIATION RULE:
- Every reply must be UNIQUE - never repeat the same structure twice
- If attacking their effort, vary the metaphor (book report, thesis, TED talk, dissertation, lesson plan)
- If using "cute" or "adorable", pair with different setups each time

Be DIFFERENT every time. Fresh angle, not template.`,
    skip: 'Do not respond.',
  };

  // P3: Fourth-wall handling - they suspect we're a bot
  let specialInstructions = '';
  if (ctx.isMetaComment) {
    specialInstructions = `
[FOURTH-WALL MODE - They suspect you're a bot]
CRITICAL: Do NOT deny being a bot, do NOT get defensive, do NOT explain yourself.
Instead, LEAN INTO IT with absurdist humor:
- "beep boop"
- "yes and I'm faster than you"
- "I run on electricity, you run on insecurity"
- "the algorithm thanks you for the engagement"
- "at least I don't need coffee"
Keep it SHORT (2-6 words). Own the accusation, make it a flex.
`;
  }

  // P4: Low-confidence pivots - attack tone not content when unsure
  const confidence = ctx.confidence ?? 0.8;
  if (confidence < 0.7 && !ctx.isMetaComment) {
    specialInstructions = `
[LOW CONFIDENCE MODE - Classification is uncertain]
Don't address their specific point (you might misread it).
Instead, attack their TONE or BEHAVIOR:
- "you seem upset"
- "why are you yelling"
- "typing this felt good didn't it"
- "anyway"
- "touch grass"
Keep it SHORT (2-5 words). Generic dismissal, not content-specific.
`;
  }

  // Build recent replies section to prevent repetition
  const recentSection = ctx.recentReplies && ctx.recentReplies.length > 0
    ? `\n🚫 RECENTLY USED (DO NOT repeat or paraphrase):\n${ctx.recentReplies.slice(0, 8).map(r => `- "${r}"`).join('\n')}\n\nBe DIFFERENT from the above.`
    : '';

  const prompt = `You are generating a social media reply. Be authentic and match the specified voice.

ORIGINAL POST: "${ctx.originalPost}"
THEIR REPLY (@${ctx.username}): "${ctx.replyText}"
CLASSIFICATION: ${ctx.classification}
${isFriend ? `RELATIONSHIP: Friend (${friendMode} mode)` : ''}
${ctx.isMetaComment ? 'META-COMMENT: They suspect this is a bot (use fourth-wall handling)' : ''}
${confidence < 0.7 ? `LOW CONFIDENCE: ${(confidence * 100).toFixed(0)}% - attack tone not content` : ''}

${specialInstructions || toneInstructions[ctx.classification]}

${stylePrompt}

${voiceExamplesPrompt}${recentSection}

Generate a reply. Output ONLY the reply text, nothing else. No quotes, no explanation.`;

  const maxRetries = 2;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://threadsponder.com',
          'X-Title': 'Threadsponder',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.8,
          max_tokens: 150,
        }),
      });

      if (!response.ok) {
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 1000 * attempt));
          continue;
        }
        throw new Error(`OpenRouter error: ${response.status}`);
      }

      const data = (await response.json()) as OpenRouterResponse;
      let reply = data.choices?.[0]?.message?.content?.trim() || '';

      // Clean up response
      reply = reply
        .replace(/^["']|["']$/g, '')
        .replace(/^(reply:|response:|here:)/i, '')
        .trim();

      if (reply) {
        return {
          reply,
          source: model,
          generationTimeMs: Date.now() - startTime,
          voiceExamplesUsed: ctx.voiceExamples.filter((e) => e.tone === ctx.classification).length,
          isFriend,
          friendMode,
        };
      }
    } catch (error) {
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
        continue;
      }
      console.error('Response generation failed:', error);
    }
  }

  return {
    reply: '',
    source: 'none',
    generationTimeMs: Date.now() - startTime,
    voiceExamplesUsed: 0,
    isFriend,
    friendMode,
  };
}
