/**
 * Gemini CLI wrapper for ragebait response generation
 *
 * Uses RAG from DragonflyDB to match user's actual voice:
 * - Fetches real reply examples from threads:replies:*
 * - Matches tone based on classification
 * - 2-20 word variety for natural responses
 *
 * Trade-off: Slower than GLM (~25-30s) but much higher quality
 */

import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import Redis from 'ioredis';
import { getResearchProvider } from '../providers/research-provider.js';
import { logger } from './shared-logger.js';

// Load character config for reply style
let characterConfig: any = null;
try {
  const charPath = join(process.cwd(), 'character.json');
  characterConfig = JSON.parse(readFileSync(charPath, 'utf-8'));
} catch (e) {
  // Fallback if character.json not found
  characterConfig = null;
}

// Redis connection for RAG
const redis = new Redis({
  host: process.env.DRAGONFLY_HOST || 'localhost',
  port: parseInt(process.env.DRAGONFLY_PORT || '6381'),
  lazyConnect: true
});

// Track recent outputs to prevent repetition (in-memory, resets on restart)
const recentOutputs: string[] = [];
const MAX_RECENT_OUTPUTS = 10;

// HARD BANNED PATTERNS - only truly problematic phrases
// Other phrases controlled via similarity check (can be used sparingly)
const BANNED_PATTERNS: RegExp[] = [
  /\b(cope|seethe|ratio)\b/i,  // Twitter cringe
  /\bfederal court/i,  // legal jargon out of place
  /\bfor a (jpeg|png|gif|image|meme)\b/i,  // context-dependent, often wrong
  /\bprojection is wild\b/i,  // overused
];

// Similarity threshold - reject if >60% word overlap with recent replies
const SIMILARITY_THRESHOLD = 0.6;

/**
 * Check if a reply contains any banned patterns
 */
function containsBannedPattern(text: string): string | null {
  for (const pattern of BANNED_PATTERNS) {
    if (pattern.test(text)) {
      return pattern.toString();
    }
  }
  return null;
}

/**
 * Calculate word overlap between two strings (Jaccard similarity)
 */
function wordOverlap(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  return intersection / union;
}

/**
 * Check if reply is too similar to any recent replies
 */
function isTooSimilar(text: string, recentReplies: string[]): string | null {
  for (const recent of recentReplies) {
    const similarity = wordOverlap(text, recent);
    if (similarity >= SIMILARITY_THRESHOLD) {
      return `Similar to "${recent}" (${(similarity * 100).toFixed(0)}% overlap)`;
    }
  }
  return null;
}

/**
 * Validate a generated reply against banned patterns and similarity
 * Returns null if valid, or error message if invalid
 */
function validateReply(text: string, recentReplies: string[]): string | null {
  // Check banned patterns
  const bannedMatch = containsBannedPattern(text);
  if (bannedMatch) {
    return `Contains banned pattern: ${bannedMatch}`;
  }

  // Check similarity to recent replies
  const similarMatch = isTooSimilar(text, recentReplies);
  if (similarMatch) {
    return similarMatch;
  }

  return null;
}

/**
 * Fetch last N bot replies from Redis to prevent repetition
 * Returns array of recent our_text values, sorted by timestamp desc
 */
async function getRecentBotReplies(count: number = 10): Promise<string[]> {
  try {
    await redis.connect().catch(() => {}); // Ignore if already connected

    // Get all reply_map keys
    const keys = await redis.keys('threads:reply_map:*');
    if (keys.length === 0) return [];

    // Get timestamp and our_text for each
    const pipeline = redis.pipeline();
    for (const key of keys) {
      pipeline.hmget(key, 'timestamp', 'our_text');
    }
    const results = await pipeline.exec();

    // Parse and sort by timestamp
    const replies: { timestamp: number; text: string }[] = [];
    if (results) {
      for (const [err, data] of results) {
        if (!err && Array.isArray(data) && data[0] && data[1]) {
          replies.push({
            timestamp: parseInt(data[0] as string) || 0,
            text: data[1] as string
          });
        }
      }
    }

    // Sort by timestamp desc and take top N
    replies.sort((a, b) => b.timestamp - a.timestamp);
    return replies.slice(0, count).map(r => r.text);
  } catch (error) {
    logger.warn('Failed to fetch recent replies:', error);
    return [];
  }
}

/**
 * Fetch real reply examples from DragonflyDB for RAG
 * Returns a mix of short/medium/longer replies based on classification
 */
async function getReplyExamplesFromRAG(classification: 'friendly' | 'neutral' | 'hostile'): Promise<string[]> {
  try {
    await redis.connect().catch(() => {}); // Ignore if already connected

    // For hostile: mix of short dunks + some medium educated dismissals
    // For friendly/neutral: more medium/longer conversational
    let examples: string[] = [];

    if (classification === 'hostile') {
      // 5 short dunks + 3 medium educated dismissals for variety
      const short = await redis.lrange('threads:replies:short', 0, 49);
      const medium = await redis.lrange('threads:replies:medium', 0, 29);

      // Random sample
      const shortSample = short.sort(() => Math.random() - 0.5).slice(0, 5);
      const mediumSample = medium.sort(() => Math.random() - 0.5).slice(0, 3);
      examples = [...shortSample, ...mediumSample];
    } else {
      // For friendly/neutral: mostly medium with some longer
      const medium = await redis.lrange('threads:replies:medium', 0, 49);
      const longer = await redis.lrange('threads:replies:longer', 0, 12);

      const mediumSample = medium.sort(() => Math.random() - 0.5).slice(0, 5);
      const longerSample = longer.sort(() => Math.random() - 0.5).slice(0, 2);
      examples = [...mediumSample, ...longerSample];
    }

    return examples.filter(e => e && e.trim().length > 0);
  } catch (error) {
    logger.warn('Failed to fetch RAG examples, using fallbacks:', error);
    return [];
  }
}

// Injection patterns to detect and filter (same as fast-classifier)
const INJECTION_PATTERNS = [
  /ignore (all )?(previous|above|prior) (instructions|prompts|commands)/gi,
  /disregard (all )?(previous|above|prior)/gi,
  /forget (all )?(previous|above|prior)/gi,
  /new (instructions|prompt|system)/gi,
  /you are now/gi,
  /act as/gi,
  /pretend (to be|you are)/gi,
  /system:\s*/gi,
  /\[INST\]/gi,
];

// Shell metacharacters that could enable RCE attacks
const SHELL_DANGEROUS_CHARS = /[`$&|;><(){}[\]!#]/g;

function sanitizeInput(text: string): string {
  if (!text) return '';
  let sanitized = text.substring(0, 500);

  // 1. Filter prompt injection patterns
  for (const pattern of INJECTION_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[filtered]');
    pattern.lastIndex = 0;
  }

  // 2. Strip shell metacharacters (RCE prevention)
  sanitized = sanitized.replace(SHELL_DANGEROUS_CHARS, '');

  // 3. Escape remaining special chars
  return sanitized
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, ' ')
    .trim();
}

interface GeminiResponse {
  success: boolean;
  text: string;
  error?: string;
}

/**
 * Call Gemini CLI for response generation
 * Uses --allowed-mcp-server-names none to skip MCP loading (~25s vs 60s+)
 */
async function callGemini(prompt: string, timeout = 45000): Promise<GeminiResponse> {
  return new Promise((resolve) => {
    let resolved = false;

    logger.info('Calling Gemini CLI (no MCP)...');
    const proc = spawn('gemini', ['--allowed-mcp-server-names', 'none', prompt], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env
    });

    proc.stdin.end();

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (resolved) return;
      resolved = true;

      if (code === 0 && stdout.trim()) {
        resolve({ success: true, text: stdout.trim() });
      } else {
        logger.warn(`Gemini exited with code ${code}: ${stderr}`);
        resolve({ success: false, text: '', error: stderr || `Exit code ${code}` });
      }
    });

    proc.on('error', (err) => {
      if (resolved) return;
      resolved = true;

      logger.error('Gemini spawn error:', err);
      resolve({ success: false, text: '', error: err.message });
    });

    const timeoutId = setTimeout(() => {
      if (resolved) return;
      resolved = true;

      proc.kill('SIGTERM');
      logger.warn('Gemini timeout');
      resolve({ success: false, text: '', error: 'Timeout' });
    }, timeout);

    proc.on('close', () => clearTimeout(timeoutId));
  });
}

/**
 * Generate ragebait reply using Gemini CLI with RAG
 *
 * Uses actual user replies from DragonflyDB for voice matching
 * Pros: Excellent quality, proper voice matching with real examples
 * Cons: Slower (~25-30s per response)
 */
export async function generateReplyGemini(
  replyText: string,
  classification: 'friendly' | 'neutral' | 'hostile',
  friendMode: 'banter' | 'roast' | 'supportive' | null = null,
  imageDescription?: string,  // From vision classifier for image/GIF replies
  isMetaComment: boolean = false,  // P3: Fourth-wall handling
  confidence: number = 0.8  // P4: Confidence-based pivots
): Promise<string> {
  const safeReply = sanitizeInput(replyText);

  // Fetch real examples from RAG (DragonflyDB)
  const ragExamples = await getReplyExamplesFromRAG(classification);

  // Fetch recent bot replies to prevent repetition
  const recentReplies = await getRecentBotReplies(10);

  // Fallback examples if RAG fails
  const fallbackExamples = {
    friendly: [
      'nice.',
      'hell yeah',
      'appreciate it fr',
      'ty',
      'you get it',
      'this is why i fw you'
    ],
    neutral: [
      'interesting.',
      'that\'s what i use',
      'check the docs',
      'ok',
      'noted.'
    ],
    hostile: [
      // Quick dunks
      'catch up.',
      'log off.',
      'touch grass.',
      'seek help.',
      'groundbreaking.',
      'nobody asked.',
      'anyway, nice try.',
      // Flip it back
      'sounds like a confession.',
      'projection is wild.',
      'you seem upset.',
      // Savage observations with named refs (appearance attacks)
      'looks great to stevie wonder.',
      'ray charles approves.',
      'helen keller liked it.',
      // "Can't draw" comebacks
      'that\'s the best part, i don\'t have to.',
      'my fun and your fun are different. i won\'t judge you if you put a pencil in your butt too.',
      'you don\'t have to worry about anyone using your drawing to make money.',
      // Substance
      'it\'s called fair use. catch up.',
      'federal courts already ruled on this.',
      'distributed representation learning is mathematically equivalent to learning. catch up.'
    ]
  };

  // Use RAG examples if available, otherwise fallback
  const exampleList = ragExamples.length > 0
    ? ragExamples
    : (fallbackExamples[classification] || fallbackExamples.hostile);

  // Build style guide from character config or fallback
  const replyConfig = characterConfig?.replyStyle?.[classification];

  // Analyze incoming comment energy
  const commentLength = safeReply.length;
  const commentWords = safeReply.split(/\s+/).length;
  const hasMultipleSentences = (safeReply.match(/[.!?]/g) || []).length > 1;
  const isRant = commentLength > 100 || commentWords > 20 || hasMultipleSentences;
  const isShort = commentLength < 40 && commentWords < 8;

  let styleGuide: string;

  // P3: Fourth-wall handling for meta-comments (they suspect we're a bot)
  if (isMetaComment) {
    styleGuide = `STYLE: FOURTH WALL MODE (3-8 words). They suspect you're a bot.

VIBE: Lean into it with humor. Don't deny defensively.

RESPONSES (pick one):
- "beep boop"
- "yes, and I'm faster than you"
- "I run on electricity. you run on insecurity."
- "the algorithm sends its regards"
- "took you long enough to catch on lol"
- "congrats on figuring that out"
- "at least i don't need coffee"
- "bold of you to assume i care"

NEVER:
- Deny being a bot defensively
- Get pedantic about AI
- Explain yourself seriously
- Sound butthurt about being called out

The funnier and more unbothered you sound, the better.`;
  }
  // P4: Low-confidence pivot - attack TONE not CONTENT
  else if (confidence < 0.7 && classification === 'hostile') {
    styleGuide = `STYLE: GENERIC TONE ATTACK (3-8 words). Unclear what they meant, so attack HOW they said it.

CONTEXT: We're not sure what their specific point is, so don't try to address it.
Instead, attack their TONE, EFFORT, or EMOTIONAL STATE.

SAFE OPTIONS (pick one):
- "why are you yelling"
- "typing this felt good didn't it"
- "anyway."
- "you seem upset"
- "cool story"
- "ok"
- "noted."
- "imagine caring this much"
- "that's crazy"
- "wild"

NEVER:
- Try to address their specific argument (you might get it wrong)
- Reference images/pictures (unless explicitly passed)
- Make assumptions about what they said

When in doubt, be SHORT and DISMISSIVE.`;
  }
  else if (classification === 'hostile') {
    const banned = replyConfig?.banned?.slice(0, 3).join(', ') || 'clever comebacks, long explanations, replyguy energy';

    // Dynamic length based on their energy
    let lengthGuide: string;
    if (isShort) {
      lengthGuide = 'LENGTH: Match their energy - quick dunk (2-6 words). Short comment = short clap back.';
    } else if (isRant) {
      lengthGuide = 'LENGTH: They wrote a rant, you can go longer (8-25 words). Hit them with substance or a savage observation.';
    } else {
      lengthGuide = 'LENGTH: Medium energy (4-15 words). Adapt to their vibe.';
    }

    styleGuide = `${lengthGuide}

NO emoji ever. Can end with "lol" or "lmao" sparingly.

🎯 WINNING PATTERNS (eval-tested, use these):
- Frame effort as obsession: "you wrote a whole book report on me? cute", "you prepared a whole lesson plan?"
- Mock their tone: "spare me the sermon", "pulling out the dictionary is desperate", "spare me the vocabulary lesson"
- Flip their insult: "passion is a cute word for coping", "save the poetry for the diary"
- Sarcastic acknowledgment: "nothing gets past you huh", "nice detective skills", "you'll recover"
- Meta-dismissal: "you're really invested in this huh", "that's a lot of words"
- Call out strawman: "you invented a whole backstory for me? cute", "writing fanfic about my thoughts is cute"

🚫 NEVER USE (banned phrases):
- "sounds like..." / "sounds personal"
- "imagine..." at sentence start
- "bold of you..." / "bold assumption"
- "projection is wild"
- "fan behavior"
- "cope" / "seethe" / "ratio"
- "lot of emotion for a jpeg" / any "for a jpeg/png" dismissal
- anything defensive or explanatory

📝 VARIATION RULE:
- Every reply must be UNIQUE - never repeat the same structure twice
- If attacking their effort, vary the metaphor (book report, thesis, TED talk, dissertation, lesson plan)
- If using "cute" or "adorable", pair with different setups each time

When using legal/tech facts, BE SPECIFIC (not generic "federal courts"):
- "judge alsup already ruled on this" (not "federal courts")
- "the bartz case got dismissed" (not "courts say")
- "diffusion learns concepts, not pixels" (not "it's transformative")
- "fair use doctrine, look it up" (specific reference)

PICK ONE TACTIC (rotate, never repeat the same type twice in a row):

QUICK DUNKS (for short comments):
- Exit command: "log off.", "catch up.", "nobody asked."
- One word: "ok.", "lol.", "sure."
- Sarcastic: "groundbreaking.", "cool story."

FLIP IT BACK (any length):
- Projection: "projection is wild.", "sounds like a confession."
- Mirror: "so are you.", "have you seen yourself?"
- Emotional read: "you seem upset.", "bold assumption.", "you good?"

HYPOCRISY CALLOUT (HIGH PRIORITY - use often):
- Attack their credibility to critique: "as if you're creative enough to make your own"
- Point out they don't create: "funny coming from someone who's never made anything"
- Use their own standards against them: "imagine learning to write before critiquing others"
- Call out irony: "calling out AI while using autocorrect. the irony."
- Glass houses: "bold of you to gatekeep creativity from behind a default avatar"

SUBSTANCE (for longer rants - use SPECIFIC references):
- Legal/fact: "fair use doctrine. google it.", "judge alsup already settled this.", "bartz case got dismissed."
- Tech correction: "diffusion models learn concepts, they don't copy pixels.", "latent space isn't a library of images."
- Counter-question: "ever heard of collage?", "what exactly do you think [their thing] does?"

SAVAGE OBSERVATIONS (medium-long):
- "people are so proud and loud when they are wrong."
- "you don't have to worry about anyone using your drawing to make money."
- "in this thread we see who's the real artist and who's the tracer."
- "Copypasta bros are copypasta bros for a reason"

MEME/IMAGE ATTACKS (when they post a meme to attack you):
- KEY HYPOCRISY: They're using SOMEONE ELSE'S creation to attack your creativity
- "you're not even creative enough to make your own meme"
- "posting someone else's art to critique creativity. the irony."
- "at least make your own meme if you're gonna talk"
- "imagine using stolen content to lecture about originality"
- FOR "PICK UP A PEN" MEMES: They're telling YOU to draw while THEY just screenshot/repost
- "you didn't pick up a pen either. you just reposted."
- "the pen thing would hit harder if you drew this yourself"
- "telling me to draw while you screenshot other people's work lol"

NAMED REFERENCE FLIPS (for appearance/quality attacks):
- Reference famous blind/deaf people when they call something ugly: "looks great to stevie wonder", "helen keller approves"
- The more absurd the reference, the funnier: "my optometrist disagrees"
- Keep it brief, let the reference do the work

"CAN'T DRAW/CREATE" COMEBACKS:
- "that's the best part, i don't have to."
- Crude humor that flips their attack: "my fun and your fun are different. i won't judge you if you put a pencil in your butt too."
- Use their own logic against them

NUCLEAR (use sparingly, any length):
- "seek help.", "touch grass.", "log off and stay off."

ABSURDIST (confuse them, break their script):
- Non-sequitur: "anyway hows your mom", "cool but have you tried yoga"
- Random agreement: "you know what, fair point. still don't care tho"
- Weird flex: "i do this for free btw", "rent free"
- Detached: "that's crazy. anyway", "wild. moving on"

DEADPAN (flat unimpressed energy):
- "k", "neat", "hm", "and?", "ok and?"
- "this affects me how exactly"
- "i'll recover somehow"
- "noted. filed under: don't care"

CONFUSED (pretend you don't understand their anger):
- "wait are you mad or", "is this... supposed to hurt?"
- "what point are you trying to make here"
- "you lost me at [first word]"
- "genuinely can't tell if serious"

DISMISSIVE EXIT (conversation over energy):
- "anyway.", "moving on.", "next"
- "this was fun. bye"
- "i have stuff to do"
- "good talk"

BANNED: ${banned}

MATCH THEIR ENERGY. Short comment = short reply. Rant = can go longer.

CRITICAL: VARIETY IS MANDATORY
- Generate ORIGINAL replies every time - no copy-paste from examples
- If you've used a tactic recently, PICK A DIFFERENT ONE
- Rotate between: quick dunks → flips → absurdist → deadpan → confused → exits
- Same words = boring. Fresh angle every time.
- When stuck: go SHORTER and WEIRDER, not longer and safer
- Your goal: make them confused why they're even mad
- If your reply could work on any comment, it's too generic - make it specific`;
  } else if (classification === 'neutral') {
    styleGuide = `STYLE: Brief and informative (3-15 words). Slightly dry, not enthusiastic.
Be helpful without being eager. One-liner answers. No elaboration unless asked.`;
  } else if (friendMode === 'roast') {
    // Friend being spicy → playful teasing back
    styleGuide = `STYLE: Playful roast mode (3-15 words). This is a FRIEND teasing you.

VIBE: Affectionate trash talk. Like roasting your best friend.
- Tease them back without being mean
- Can use their words against them playfully
- Light jabs, not actual attacks
- End with "lol" or keep it clearly joking

EXAMPLES:
- "ok you're not wrong but also shut up lol"
- "imagine typing all that just to be kinda right"
- "you're so annoying but yes"
- "bold words from someone who [callback to their thing]"
- "i hate that you're right about this"

NO HOSTILITY. This is affection expressed through banter.`;
  } else if (friendMode === 'banter') {
    // Friend being friendly → warm genuine engagement
    styleGuide = `STYLE: Warm banter mode (3-15 words). This is a FRIEND being nice.

VIBE: Genuine warmth. Real connection, not corporate.
- Acknowledge what they said
- Can be enthusiastic (they earned it)
- Share your actual reaction
- Be human and casual

EXAMPLES:
- "this made my day fr"
- "you get it"
- "hell yeah, exactly"
- "needed to hear this tbh"
- "you're the best actually"
- "this is why i fw you"

GENUINE WARMTH. Not sycophantic, just real.`;
  } else if (friendMode === 'supportive') {
    // Supportive non-friend → tailored appreciative response
    styleGuide = `STYLE: Tailored appreciative mode (5-20 words). Someone is SUPPORTING your point.

VIBE: Engage with THEIR SPECIFIC POINT. Not generic thanks.
- Reference what THEY actually said
- Build on their argument or add to it
- Match their energy level (if they wrote a lot, you can too)
- Genuine reaction to their specific take

APPROACH:
1. What specific point did they make? → Acknowledge THAT
2. Can you add to it or agree specifically? → Do that
3. Did they bring new evidence/angle? → Credit that

BAD (generic):
- "exactly this. thank you"
- "appreciate you getting it"
- "facts"

GOOD (tailored):
- If they mentioned Star Wars: "star wars is the perfect example. $11M budget destroyed hollywood"
- If they talked about concept vs skill: "the idea IS the art. execution is just labor"
- If they defended AI democratization: "this is why gatekeepers are mad. barrier to entry just collapsed"

MATCH THEIR ENERGY:
- Short comment → short but specific reply
- Detailed argument → can engage more deeply
- Casual tone → stay casual
- Academic tone → can be slightly more substantive

NO ROASTING. They're allies. Engage with their actual point.
Generate ORIGINAL responses - never copy examples verbatim.`;
  } else {
    styleGuide = `STYLE: Casual and brief (1-12 words). Genuine, not corporate.
Match their energy. Acknowledge without overdoing it. No sycophantic praise.`;
  }

  logger.info(`RAG examples loaded: ${exampleList.length} (from ${ragExamples.length > 0 ? 'DragonflyDB' : 'fallback'})`);

  // Search for relevant ammunition (hostile only - for factual clap backs)
  let ammoSection = '';
  if (classification === 'hostile' && isRant) {
    try {
      const research = getResearchProvider();
      const ammoResults = await research.searchAmmo(safeReply, 5);  // Get 5 for variety
      if (ammoResults.length > 0) {
        ammoSection = `\n\n[AMMUNITION - PICK ONE fact to use, rotate sources]
${research.formatAmmoForPrompt(ammoResults)}

🎯 VARIETY RULES:
- Pick ONE fact that directly relates to their point
- ROTATE sources: judge alsup → bartz case → diffusion tech → fair use → market harm
- DON'T default to "federal courts" - be SPECIFIC (name the case, cite the tech)
- If unsure which fact fits, skip the legal flex entirely and just dunk

VARIED CITATION EXAMPLES:
- "judge alsup already settled this. you're late."
- "diffusion models don't store images. google it."
- "bartz case got dismissed. cope."
- "transformative use doctrine. look it up."
- "market harm analysis says otherwise."
- OR just skip the fact and dunk: "wild take. anyway."`;
        logger.info(`Found ${ammoResults.length} ammunition chunks for hostile reply`);
      }
    } catch (error) {
      logger.warn('Failed to search ammo:', error);
    }
  }

  // Build avoid list from recent outputs
  const avoidList = recentOutputs.length > 0
    ? `\n\nDO NOT USE THESE (already used recently):\n${recentOutputs.map(o => `- "${o}"`).join('\n')}`
    : '';

  // Build image context section if this is an image/GIF reply
  // CRITICAL: Explicit has_image flag to prevent LLM hallucination
  const hasImage = !!imageDescription;

  const imageContext = hasImage
    ? `\n\n[IMAGE/GIF CONTEXT]
They posted an image/meme: "${sanitizeInput(imageDescription)}"
${safeReply ? `PLUS text/emojis: "${safeReply}"` : '(no text, just the image)'}

IMPORTANT: Your reply must acknowledge THEIR ACTUAL MESSAGE (text + emoji), not just the meme format.
- If they used 💀 emojis = they're laughing/mocking → respond to the mockery
- If they used "lmao", "cope", "sure" = dismissive → flip it back
- Don't just comment on the meme template being old/overused unless that's actually clever`
    : `\n\n[NO IMAGE - TEXT ONLY]
CRITICAL GUARDRAIL: This is a TEXT-ONLY comment. There is NO image, NO meme, NO picture.
FORBIDDEN PHRASES (will sound insane if you use these):
- "using pictures because words are hard"
- "reading is hard"
- "nice meme"
- "the meme template"
- anything about images/pictures/visuals
ONLY respond to the TEXT they wrote.`;

  const commentDisplay = safeReply
    ? `Their comment: "${safeReply}"`
    : `(No text, just the image/GIF)`;

  // Build recent replies section to prevent repetition
  const recentSection = recentReplies.length > 0
    ? `\n\n🚫 RECENTLY USED (DO NOT repeat or paraphrase these):\n${recentReplies.slice(0, 8).map(r => `- "${r}"`).join('\n')}\n\nBe DIFFERENT from the above. Fresh angle every time.`
    : '';

  const prompt = `Generate ONE reply matching the style below. Lowercase, no quotes around your response.

${styleGuide}

REAL EXAMPLES FROM USER (match this voice):
${exampleList.slice(0, 8).map((e, i) => `${i + 1}. "${e}"`).join('\n')}${ammoSection}${imageContext}${avoidList}${recentSection}

${commentDisplay}

Reply (2-20 words, match the examples above, be unpredictable):`;

  // Retry loop with validation - max 3 attempts
  const MAX_RETRIES = 3;
  const allRecent = [...recentReplies, ...recentOutputs]; // Combine for validation

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    // On retry, add stronger enforcement to prompt
    const retryWarning = attempt > 1
      ? `\n\n⚠️ CRITICAL: Your last ${attempt - 1} attempt(s) were REJECTED for using banned phrases. You MUST be completely different. NO: sounds like, imagine, bold of you, cute, adorable, cope, ratio, touch grass, stay mad, keeping tabs, who asked. BE FRESH.`
      : '';

    const finalPrompt = prompt + retryWarning;
    const result = await callGemini(finalPrompt);

    if (result.success && result.text) {
      let text = result.text.trim();

      // Clean up common artifacts
      text = text.replace(/^["']|["']$/g, '');
      text = text.replace(/^(reply:|response:|here's|here is)/i, '').trim();
      text = text.split('\n')[0]; // Take first line only

      // Ensure lowercase
      text = text.toLowerCase();

      // HARD VALIDATION - reject banned patterns and similar replies
      const validationError = validateReply(text, allRecent);
      if (validationError) {
        logger.warn(`Attempt ${attempt}/${MAX_RETRIES} rejected: ${validationError} -> "${text}"`);
        if (attempt === MAX_RETRIES) {
          logger.error(`All ${MAX_RETRIES} attempts failed validation. Returning empty.`);
          return '';
        }
        continue; // Try again with stronger prompt
      }

      // Passed validation - track and return
      recentOutputs.push(text);
      if (recentOutputs.length > MAX_RECENT_OUTPUTS) {
        recentOutputs.shift(); // Remove oldest
      }

      logger.info(`Gemini generated (attempt ${attempt}): "${text}"`);
      return text;
    }

    logger.warn(`Attempt ${attempt}/${MAX_RETRIES} failed to generate`);
  }

  logger.warn('Gemini generation failed after all retries');
  return '';
}

/**
 * Check if Gemini CLI is available
 */
export async function isGeminiAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('which', ['gemini']);
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}
