/**
 * Reply Classifier
 *
 * Multi-tenant classification using OpenRouter
 * Detects: friendly, neutral, hostile + injection attempts
 */

import type { ReplyHistory } from '@threadsponder/shared';

// OpenRouter config
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export type Classification = 'friendly' | 'neutral' | 'hostile' | 'skip';

export interface ClassificationResult {
  classification: Classification;
  confidence: number;
  reasoning: string;
  injectionDetected: boolean;
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
  model: string = 'meta-llama/llama-3.3-70b-instruct'
): Promise<ClassificationResult> {
  // Check for injection attempts first
  if (containsInjectionAttempt(replyText)) {
    return {
      classification: 'skip',
      confidence: 1.0,
      reasoning: 'Injection attempt detected',
      injectionDetected: true,
    };
  }

  // Sanitize inputs
  const safeOriginal = sanitizeInput(originalPost);
  const safeReply = sanitizeInput(replyText);
  const safeUsername = sanitizeInput(username).replace(/[^a-zA-Z0-9_]/g, '');

  const prompt = `Classify this social media reply. Output ONLY valid JSON, no markdown.

ORIGINAL POST: "${safeOriginal}"
REPLY FROM @${safeUsername}: "${safeReply}"

Classify as:
- friendly: supportive, appreciative, jokes along, positive engagement
- neutral: questions, curiosity, mild disagreement, informational
- hostile: attacks, insults, trolling, mockery, negativity

Output format: {"classification": "friendly"|"neutral"|"hostile", "confidence": 0.0-1.0, "reasoning": "brief explanation"}`;

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
          };
        }

        return {
          classification: result.classification as Classification,
          confidence: result.confidence ?? 0.7,
          reasoning: result.reasoning ?? 'No reasoning provided',
          injectionDetected: false,
        };
      }

      // Fallback: detect from text
      const lowerContent = cleanContent.toLowerCase();
      if (lowerContent.includes('hostile') || lowerContent.includes('attack')) {
        return {
          classification: 'hostile',
          confidence: 0.6,
          reasoning: 'Detected from response text',
          injectionDetected: false,
        };
      }
      if (lowerContent.includes('friendly') || lowerContent.includes('positive')) {
        return {
          classification: 'friendly',
          confidence: 0.6,
          reasoning: 'Detected from response text',
          injectionDetected: false,
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
  };
}
