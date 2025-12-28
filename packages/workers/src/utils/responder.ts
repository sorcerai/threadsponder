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
  const toneInstructions = {
    friendly: isFriend && friendMode === 'banter'
      ? 'This is a friend - be warm and genuinely engaged. Match their positive energy.'
      : 'Be appreciative and genuine. Keep it brief but warm.',
    neutral:
      'Be helpful but brief. Answer questions directly or acknowledge their point.',
    hostile: isFriend && friendMode === 'roast'
      ? "This is a friend being playful - tease them back with love. It's friendly banter, not real hostility."
      : 'Be dismissive and unbothered. Short, clever dunks. Never defensive.',
    skip: 'Do not respond.',
  };

  const prompt = `You are generating a social media reply. Be authentic and match the specified voice.

ORIGINAL POST: "${ctx.originalPost}"
THEIR REPLY (@${ctx.username}): "${ctx.replyText}"
CLASSIFICATION: ${ctx.classification}
${isFriend ? `RELATIONSHIP: Friend (${friendMode} mode)` : ''}

${toneInstructions[ctx.classification]}

${stylePrompt}

${voiceExamplesPrompt}

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
