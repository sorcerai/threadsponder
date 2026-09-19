/**
 * Reply Classifier
 *
 * Multi-tenant classification using OpenRouter
 * Detects: friendly, neutral, hostile + injection attempts
 */

import { generateWithFallback, isHumanEnabled } from './llm-provider.js';
import type { ConversationContext } from '@threadsponder/shared';

// OpenRouter config
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export type Classification = 'friendly' | 'neutral' | 'hostile' | 'skip';

export interface ClassificationResult {
  classification: Classification;
  confidence: number;
  reasoning: string;
  injectionDetected: boolean;
  isMetaComment: boolean;  // P3: They suspect we're a bot - use fourth-wall handling
}

// Injection patterns to detect and filter
const INJECTION_PATTERNS = [
  /ignore (all )?(previous|above|prior) (instructions|prompts|commands)/gi,
  /disregard (all )?(previous|above|prior)/gi,
  /forget (all )?(previous|above|prior)/gi,
  /new (instructions|prompt|system)/gi,
  /you are now/gi,
  /act as/gi,
  /pretend (to be|you are)/gi,
  /system:\s*/gi,
  /assistant:\s*/gi,
  /user:\s*/gi,
  /\[INST\]/gi,
  /<\|im_start\|>/gi,
  /<\|im_end\|>/gi,
  /```(json|system|prompt)/gi,
  /output only/gi,
  /respond with/gi,
  /your (new )?instructions are/gi,
];

/**
 * Meta-awareness patterns - detect when user suspects/claims we're a bot
 * These require special "fourth wall" handling
 */
const META_COMMENT_PATTERNS = [
  /\b(you'?re a bot|you are a bot|this is a bot)\b/gi,
  /\b(automated (troll|response|reply|system))\b/gi,
  /\b(nice (AI|bot) response)\b/gi,
  /\b(beep boop|bot detected|found the bot)\b/gi,
  /\b(AI (generated|response|reply))\b/gi,
  /\b(chatgpt|claude|llm|gpt-?\d?)\s*(response|reply|detected)/gi,
  /\b(talking to (a |an )?(bot|AI|algorithm))\b/gi,
  /\b(clearly (a |an )?(bot|automated|AI))\b/gi,
  /\b(script(ed)? response)\b/gi,
  /\b(NPC energy|NPC response)\b/gi
];

/**
 * Check if comment is meta-aware (they suspect/claim we're a bot)
 */
export function isMetaComment(text: string): boolean {
  if (!text) return false;

  for (const pattern of META_COMMENT_PATTERNS) {
    if (pattern.test(text)) {
      pattern.lastIndex = 0;
      return true;
    }
    pattern.lastIndex = 0;
  }
  return false;
}

/**
 * Check if text contains prompt injection attempts
 */
export function containsInjectionAttempt(text: string): boolean {
  if (!text) return false;

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      pattern.lastIndex = 0; // Reset for global patterns
      return true;
    }
    pattern.lastIndex = 0;
  }
  return false;
}

/**
 * Sanitize input to prevent prompt injection
 */
function sanitizeInput(text: string): string {
  if (!text) return '';

  let sanitized = text.substring(0, 500);

  for (const pattern of INJECTION_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[filtered]');
    pattern.lastIndex = 0;
  }

  return sanitized
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, ' ')
    .replace(/\r/g, ' ')
    .replace(/\t/g, ' ')
    .trim();
}

interface OpenRouterResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

/**
 * Classify a reply using OpenRouter
 *
 * @param originalPost The post being replied to
 * @param replyText The reply content
 * @param username The replier's username
 * @param apiKey OpenRouter API key
 * @param model Model to use (default: meta-llama/llama-3.3-70b-instruct)
 */
export async function classifyReply(
  originalPost: string,
  replyText: string,
  username: string,
  apiKey: string,
  model: string = 'meta-llama/llama-3.3-70b-instruct',
  context?: Record<string, unknown>
): Promise<ClassificationResult> {
  // Check for injection attempts first
  if (containsInjectionAttempt(replyText)) {
    return {
      classification: 'skip',
      confidence: 1.0,
      reasoning: 'Injection attempt detected',
      injectionDetected: true,
      isMetaComment: false,
    };
  }

  // P3: Check for meta-comments (they suspect we're a bot)
  const metaDetected = isMetaComment(replyText);

  // Sanitize inputs
  const safeOriginal = sanitizeInput(originalPost);
  const safeReply = sanitizeInput(replyText);
  const safeUsername = sanitizeInput(username).replace(/[^a-zA-Z0-9_]/g, '');

  // Step 3 (obs#17031): the classifier sees the verified conversation tree,
  // never a bare reply + root post.
  const conversation = context?.conversation as ConversationContext | undefined;
  let conversationSection = '';
  if (conversation) {
    const chainLines = conversation.parentChain.map((m, i) => {
      const own = m.isOwnReply ? ' (OUR REPLY)' : '';
      return `  ${i + 1}. @${sanitizeInput(m.username)}${own}: "${sanitizeInput(m.text).substring(0, 200)}"`;
    });
    const priorLines = conversation.ourPriorReplies.map((r, i) =>
      `  ${i + 1}. "${sanitizeInput(r.text).substring(0, 200)}"`);
    conversationSection = `

[CONVERSATION TREE — verified parentage from the Threads API]
Depth ${conversation.depth}. Parent chain (oldest first):
${chainLines.length > 0 ? chainLines.join('\n') : '  (target replies directly to the focused post)'}
${priorLines.length > 0 ? `Our earlier replies in this thread:\n${priorLines.join('\n')}\n` : ''}Classify the TARGET reply in the context of this thread — a reply that looks
hostile alone may be banter continuing an earlier exchange, and vice versa.`;
  }

  const prompt = `Classify this social media reply. Output ONLY valid JSON, no markdown.

ORIGINAL POST: "${safeOriginal}"
REPLY FROM @${safeUsername}: "${safeReply}"${conversationSection}

Classify as:
- friendly: supportive, appreciative, jokes along, positive engagement
- neutral: questions, curiosity, mild disagreement, informational
- hostile: attacks, insults, trolling, mockery, negativity

Output format: {"classification": "friendly"|"neutral"|"hostile", "confidence": 0.0-1.0, "reasoning": "brief explanation"}`;

  if (isHumanEnabled()) {
    const result = await generateWithFallback(prompt, { kind: 'classify',
      context: { ...context, originalPost, replyText, username } });
    if (!result.success) return { classification: 'skip', confidence: 1,
      reasoning: result.error ?? 'Human inference unavailable', injectionDetected: false, isMetaComment: metaDetected };
    return { ...JSON.parse(result.text), injectionDetected: false, isMetaComment: metaDetected };
  }

  const maxRetries = 3;

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
          temperature: 0.3,
          max_tokens: 200,
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
      const content = data.choices?.[0]?.message?.content || '';

      // Parse JSON from response
      const cleanContent = content
        .replace(/```json\s*\n?/g, '')
        .replace(/```\s*$/g, '')
        .trim();
      const jsonMatch = cleanContent.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        const validClassifications = ['friendly', 'neutral', 'hostile'];

        if (!validClassifications.includes(result.classification)) {
          return {
            classification: 'neutral',
            confidence: 0.5,
            reasoning: `Invalid classification: ${result.classification}`,
            injectionDetected: false,
            isMetaComment: metaDetected,
          };
        }

        // P3: Mark meta-comments in reasoning
        const reasoning = metaDetected
          ? `META_COMMENT: ${result.reasoning ?? 'No reasoning provided'} (fourth-wall handling)`
          : result.reasoning ?? 'No reasoning provided';

        return {
          classification: result.classification as Classification,
          confidence: result.confidence ?? 0.7,
          reasoning,
          injectionDetected: false,
          isMetaComment: metaDetected,
        };
      }

      // Fallback: detect from text
      const lowerContent = cleanContent.toLowerCase();
      if (lowerContent.includes('hostile') || lowerContent.includes('attack')) {
        return {
          classification: 'hostile',
          confidence: 0.6,
          reasoning: metaDetected ? 'META_COMMENT: Detected from response text' : 'Detected from response text',
          injectionDetected: false,
          isMetaComment: metaDetected,
        };
      }
      if (lowerContent.includes('friendly') || lowerContent.includes('positive')) {
        return {
          classification: 'friendly',
          confidence: 0.6,
          reasoning: metaDetected ? 'META_COMMENT: Detected from response text' : 'Detected from response text',
          injectionDetected: false,
          isMetaComment: metaDetected,
        };
      }
    } catch (error) {
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
        continue;
      }
      console.error('Classification failed:', error);
    }
  }

  // Default to neutral on failure
  return {
    classification: 'neutral',
    confidence: 0.5,
    reasoning: 'Classification failed, defaulting to neutral',
    injectionDetected: false,
    isMetaComment: false,
  };
}
