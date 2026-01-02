/**
 * Fast reply classifier using GLM-4.7 via Z.AI API
 *
 * Use this for quick classification (faster + cheaper than Claude Code CLI)
 * Keep Claude Code for quality reply generation where voice matters
 */

import { logger } from './shared-logger.js';

const Z_AI_URL = 'https://api.z.ai/api/coding/paas/v4/chat/completions';
const Z_AI_KEY = process.env.Z_AI_API_KEY || '01f41e39716a47b9aa2bd74daeb4a102.r8vqzbIITX47eWPS';
const MODEL = 'glm-4.7';

interface ClassificationResult {
  classification: 'friendly' | 'neutral' | 'hostile';
  confidence: number;
  reasoning: string;
}

/**
 * Fast classification using GLM-4.7
 * ~2-5 seconds vs ~10-15 seconds for Claude Code CLI
 */
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Sanitize input to prevent prompt injection attacks
 * Removes common injection patterns and truncates to safe length
 */
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
 * Returns true if meta-comment detected
 */
export function isMetaComment(text: string): boolean {
  if (!text) return false;

  for (const pattern of META_COMMENT_PATTERNS) {
    if (pattern.test(text)) {
      logger.info(`Meta-comment detected: ${text.substring(0, 80)}...`);
      pattern.lastIndex = 0;
      return true;
    }
    pattern.lastIndex = 0;
  }
  return false;
}

/**
 * Check if text contains prompt injection attempts
 * Returns true if injection detected
 */
export function containsInjectionAttempt(text: string): boolean {
  if (!text) return false;

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      logger.warn(`Injection attempt detected: ${text.substring(0, 100)}...`);
      return true;
    }
    // Reset regex lastIndex for global patterns
    pattern.lastIndex = 0;
  }
  return false;
}

function sanitizeInput(text: string): string {
  if (!text) return '';

  // Truncate to safe length first
  let sanitized = text.substring(0, 500);

  // Remove injection patterns
  for (const pattern of INJECTION_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[filtered]');
    pattern.lastIndex = 0; // Reset for global patterns
  }

  // Escape special characters that could be used for injection
  sanitized = sanitized
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, ' ')
    .replace(/\r/g, ' ')
    .replace(/\t/g, ' ');

  return sanitized.trim();
}

async function callGLMApi(prompt: string): Promise<ClassificationResult | null> {
  const response = await fetch(Z_AI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${Z_AI_KEY}`
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 500  // Increased to accommodate reasoning + actual response
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.warn(`GLM-4.7 API error: ${response.status} ${errorText}`);
    return null;
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
  };
  // GLM-4.7 may put response in content OR reasoning_content - check both
  let content = data.choices?.[0]?.message?.content || '';
  const reasoning = data.choices?.[0]?.message?.reasoning_content || '';

  // If content is empty but reasoning exists, try to extract JSON from reasoning
  if (!content && reasoning) {
    logger.info('GLM response in reasoning_content, extracting...');
    content = reasoning;
  }

  // Parse JSON from response - GLM wraps in markdown code blocks
  const cleanContent = content.replace(/```json\s*\n?/g, '').replace(/```\s*$/g, '').trim();
  const jsonMatch = cleanContent.match(/\{[\s\S]*\}/);

  if (jsonMatch) {
    try {
      const result = JSON.parse(jsonMatch[0]);

      // Validate classification is one of the expected values
      const validClassifications = ['friendly', 'neutral', 'hostile'];
      if (!validClassifications.includes(result.classification)) {
        logger.warn(`Invalid classification from GLM: "${result.classification}", defaulting to hostile`);
        return {
          classification: 'hostile',
          confidence: 0.5,
          reasoning: `Invalid GLM classification: ${result.classification}`
        };
      }

      return {
        classification: result.classification as 'friendly' | 'neutral' | 'hostile',
        confidence: result.confidence ?? 0.7,
        reasoning: result.reasoning ?? 'No reasoning provided'
      };
    } catch (e) {
      logger.warn('Failed to parse JSON from GLM response');
      return null;
    }
  }

  // Fallback: try to detect classification from text
  const lowerContent = cleanContent.toLowerCase();
  if (lowerContent.includes('hostile') || lowerContent.includes('attack') || lowerContent.includes('insult')) {
    return { classification: 'hostile', confidence: 0.7, reasoning: 'Detected from reasoning text' };
  }
  if (lowerContent.includes('friendly') || lowerContent.includes('support') || lowerContent.includes('positive')) {
    return { classification: 'friendly', confidence: 0.7, reasoning: 'Detected from reasoning text' };
  }

  return null;
}

/**
 * Fast classification using GLM-4.7 with retry logic
 * ~2-5 seconds vs ~10-15 seconds for Claude Code CLI
 * Falls back to 'neutral' if all retries fail
 */
export async function classifyReplyFast(
  originalPost: string,
  replyText: string,
  username: string
): Promise<ClassificationResult> {
  // Check for injection attempts - skip processing entirely
  if (containsInjectionAttempt(replyText)) {
    logger.info(`Skipping @${username} - injection attempt detected`);
    return {
      classification: 'neutral',
      confidence: 0,
      reasoning: 'INJECTION_DETECTED: Comment ignored for security'
    };
  }

  // Sanitize inputs to prevent prompt injection
  const safeOriginal = sanitizeInput(originalPost);
  const safeReply = sanitizeInput(replyText);
  const safeUsername = sanitizeInput(username).replace(/[^a-zA-Z0-9_]/g, '');

  const prompt = `Classify this social media reply. Output ONLY valid JSON, no markdown.

ORIGINAL POST: "${safeOriginal}"
REPLY FROM @${safeUsername}: "${safeReply}"

Classify as:
- friendly: supportive, hype, appreciative, jokes along
- neutral: questions, curiosity, mild disagreement, informational
- hostile: attacks, insults, trolling, mockery

Output format: {"classification": "friendly"|"neutral"|"hostile", "confidence": 0.0-1.0, "reasoning": "brief explanation"}`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await callGLMApi(prompt);
      if (result) {
        logger.info(`Fast classified @${username}: ${result.classification} (${result.confidence}) [attempt ${attempt}]`);
        return result;
      }

      if (attempt < MAX_RETRIES) {
        logger.warn(`GLM retry ${attempt}/${MAX_RETRIES} for @${username}`);
        await sleep(RETRY_DELAY_MS * attempt);
      }
    } catch (error) {
      logger.warn(`GLM attempt ${attempt} error:`, error);
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }

  logger.warn(`All ${MAX_RETRIES} GLM attempts failed for @${username}, defaulting to neutral`);
  return defaultClassification('All retries failed');
}

function defaultClassification(reason: string): ClassificationResult {
  return {
    classification: 'neutral',
    confidence: 0.5,
    reasoning: `Classification failed: ${reason}. Defaulting to neutral.`
  };
}

/**
 * Generate reply using GLM-4.7 (faster than Claude CLI)
 * NOTE: GLM-4.7's reasoning mode makes generation unreliable.
 * Consider using generateReplyWithClaude for quality responses.
 * This function is kept for speed-critical scenarios.
 */
export async function generateReplyFast(
  originalPost: string,
  replyText: string,
  username: string,
  classification: 'friendly' | 'neutral' | 'hostile'
): Promise<string> {
  // Sanitize inputs to prevent prompt injection
  const safeReply = sanitizeInput(replyText);
  const safeUsername = sanitizeInput(username).replace(/[^a-zA-Z0-9_]/g, '');

  const examples = {
    friendly: [
      "nice.",
      "hell yeah",
      "shits bonkers",
      "appreciate it fr",
      "wild. love to see it"
    ],
    neutral: [
      "interesting.",
      "try [thing]. worked for me",
      "that's what i use",
      "check the docs"
    ],
    hostile: [
      // RAGEBAIT STYLE - dunk with data/logic, use 💀 or 🤔
      "you're mad at a tool. the tool doesn't care. 🤔",
      "same energy as complaining about calculators 💀",
      "skill issue tbh",
      "and yet you're still here 🤔",
      "cool. anyway."
    ]
  };

  const hostileInstructions = classification === 'hostile'
    ? `\nRAGEBAIT RULES:
- dunk with logic, not emotion
- use 💀 or 🤔 for smirk energy
- expose their hypocrisy if possible
- never defensive, always on offense
- make them look absurd with facts`
    : '';

  // Use a simpler, more direct prompt that doesn't trigger reasoning mode
  const prompt = `Reply to this comment in 60 chars or less. lowercase. no explanation.

Examples: "${examples[classification][0]}" | "${examples[classification][1]}" | "${examples[classification][2]}"

Comment: "${safeReply}"

${classification === 'hostile' ? 'Dunk with logic. Use 💀 or 🤔 if exposing hypocrisy.' : ''}

Your reply:`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(Z_AI_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Z_AI_KEY}`
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
          max_tokens: 100
        })
      });

      if (!response.ok) {
        if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS * attempt);
        continue;
      }

      const data = await response.json() as {
        choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
      };

      // GLM-4.7 may put response in content OR reasoning_content - check both
      let text = data.choices?.[0]?.message?.content?.trim() || '';
      const reasoning = data.choices?.[0]?.message?.reasoning_content || '';

      // If content is empty but reasoning exists, try to extract actual reply
      if (!text && reasoning) {
        logger.info('GLM reply in reasoning_content, extracting...');
        // Try to find quoted text that looks like a reply
        const quotedMatch = reasoning.match(/"([^"]{5,60})"/g);
        if (quotedMatch && quotedMatch.length > 0) {
          // Get the last quoted text (likely the actual reply)
          const candidates = quotedMatch
            .map(q => q.slice(1, -1)) // Remove quotes
            .filter(q => q.length <= 60 && q.length >= 5)
            .filter(q => !q.includes('**') && !q.includes('*')) // Not markdown
            .filter(q => !q.toLowerCase().includes('analyze') && !q.toLowerCase().includes('goal'))
            .filter(q => q === q.toLowerCase() || q.includes('💀') || q.includes('🤔')); // lowercase or has emoji

          if (candidates.length > 0) {
            text = candidates[candidates.length - 1];
            logger.info(`Extracted reply candidate: "${text}"`);
          }
        }
        // Fallback: just use first 60 chars of reasoning (will fail, but at least we tried)
        if (!text) {
          text = reasoning.trim();
        }
      }

      text = text.replace(/^["']|["']$/g, '');
      text = text.replace(/^(reply:|response:|here|your reply:)/i, '').trim();
      // Remove markdown code blocks if present
      text = text.replace(/```[\s\S]*?```/g, '').trim();
      // Remove any remaining markdown formatting
      text = text.replace(/\*\*[^*]+\*\*/g, '').replace(/\*[^*]+\*/g, '').trim();

      if (text) {
        logger.info(`Fast generated reply for @${safeUsername}: "${text}" [attempt ${attempt}]`);
        return text.substring(0, 100);
      }

      if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS * attempt);
    } catch (error) {
      logger.warn(`GLM reply attempt ${attempt} error:`, error);
      if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS * attempt);
    }
  }

  logger.warn(`All GLM reply attempts failed for @${safeUsername}`);
  return '';
}
