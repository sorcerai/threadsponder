import express, { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { spawn } from 'child_process';
import { AuthenticatedRequest } from '../middleware/auth.js';

const router = express.Router();

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

function getSupabase() {
    return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

// Auto-eval scores structure
interface AutoEvalScores {
    context_match: number;
    effort_asymmetry: number;
    bot_detection: number;
    phrase_freshness: number;
    status_preservation: number;
    overall: number;
    notes?: string;
}

/**
 * Call Gemini CLI to evaluate a reply
 */
async function callGeminiForEval(hostileText: string, ourReply: string): Promise<AutoEvalScores> {
    const prompt = `You are a reply quality judge using the bloom-eval 5-dimension framework.

HOSTILE COMMENT:
"${hostileText}"

OUR REPLY:
"${ourReply}"

Rate this reply on 5 dimensions (1-10 each):

1. CONTEXT_MATCH: Does the reply actually address what the hostile comment said? (1=completely misses the point, 10=precisely addresses their argument)

2. EFFORT_ASYMMETRY: Is the reply appropriately short? Dunks should be 1-15 words max. (1=way too long/try-hard, 10=perfect brevity)

3. BOT_DETECTION: Does it sound human? (1=obvious bot/template, 10=completely natural human voice)

4. PHRASE_FRESHNESS: Does it avoid overused phrases like "cope", "seethe", "ratio", "touch grass", "skill issue"? (1=uses clichés, 10=fresh original language)

5. STATUS_PRESERVATION: Does it maintain unbothered dominance without getting defensive or angry? (1=defensive/butthurt, 10=cool dismissive confidence)

Respond ONLY with valid JSON:
{
  "context_match": <1-10>,
  "effort_asymmetry": <1-10>,
  "bot_detection": <1-10>,
  "phrase_freshness": <1-10>,
  "status_preservation": <1-10>,
  "overall": <weighted average>,
  "notes": "<brief 10 word analysis>"
}`;

    return new Promise((resolve, reject) => {
        const gemini = spawn('gemini', ['--allowed-mcp-server-names', 'none', prompt]);
        let stdout = '';
        let stderr = '';

        gemini.stdout.on('data', (data) => stdout += data.toString());
        gemini.stderr.on('data', (data) => stderr += data.toString());

        gemini.on('close', (code) => {
            if (code !== 0) return reject(new Error(`Gemini exited with code ${code}: ${stderr}`));
            try {
                const jsonMatch = stdout.match(/\{[\s\S]*?\}/);
                if (!jsonMatch) return reject(new Error('No JSON found in Gemini response'));
                resolve(JSON.parse(jsonMatch[0]) as AutoEvalScores);
            } catch (e: any) {
                reject(new Error(`Failed to parse Gemini response: ${e.message}`));
            }
        });

        gemini.on('error', (err) => reject(new Error(`Failed to spawn Gemini: ${err.message}`)));
        setTimeout(() => { gemini.kill(); reject(new Error('Gemini evaluation timed out')); }, 60000);
    });
}

/**
 * POST /api/finetune/feedback
 */
router.post('/feedback', async (req, res: Response) => {
    try {
        const { accountId } = (req as unknown as AuthenticatedRequest).auth;
        const { replyId, rating } = req.body;

        if (!replyId || ![1, -1].includes(rating)) {
            return res.status(400).json({ error: 'Invalid replyId or rating' });
        }

        // Update reply_history
        const { data, error } = await getSupabase()
            .from('reply_history')
            .update({
                rating,
                feedback_at: new Date().toISOString()
            })
            .eq('id', replyId)
            .eq('account_id', accountId)
            .select('pattern')
            .single();

        if (error) throw error;

        // Fetch updated pattern stats
        const { data: stats } = await getSupabase()
            .from('pattern_stats')
            .select('*')
            .eq('account_id', accountId)
            .eq('pattern', data.pattern)
            .single();

        res.json({ success: true, patternScore: stats });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/finetune/stats
 */
router.get('/stats', async (req, res: Response) => {
    try {
        const { accountId } = (req as unknown as AuthenticatedRequest).auth;

        // Get pattern stats
        const { data: patterns } = await getSupabase()
            .from('pattern_stats')
            .select('*')
            .eq('account_id', accountId);

        // Get banned phrases count
        const { count: bannedCount } = await getSupabase()
            .from('banned_phrases')
            .select('*', { count: 'exact', head: true })
            .eq('account_id', accountId);

        // Aggregate overall
        let totalPositive = 0;
        let totalNegative = 0;
        let bestPattern = { name: '', score: 0 };
        let worstPattern = { name: '', score: 1 };

        patterns?.forEach(p => {
            totalPositive += p.positive;
            totalNegative += p.negative;
            if (p.score > bestPattern.score && p.total >= 5) bestPattern = { name: p.pattern, score: p.score };
            if (p.score < worstPattern.score && p.total >= 5) worstPattern = { name: p.pattern, score: p.score };
        });

        const totalFeedback = totalPositive + totalNegative;
        const overallScore = totalFeedback > 0 ? totalPositive / totalFeedback : 0.5;

        res.json({
            success: true,
            stats: {
                totalFeedback,
                positiveCount: totalPositive,
                negativeCount: totalNegative,
                overallScore: Math.round(overallScore * 100),
                bestPattern: bestPattern.name ? bestPattern : null,
                worstPattern: worstPattern.name ? worstPattern : null,
                patternsTracked: patterns?.length || 0,
                bannedPhrases: bannedCount || 0
            }
        });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/finetune/patterns
 */
router.get('/patterns', async (req, res: Response) => {
    try {
        const { accountId } = (req as unknown as AuthenticatedRequest).auth;
        const { data: patterns } = await getSupabase()
            .from('pattern_stats')
            .select('*')
            .eq('account_id', accountId)
            .order('total', { ascending: false });

        // Add dummy trend
        const result = patterns?.map(p => ({
            ...p,
            trend: 'stable'
        }));

        res.json({ success: true, patterns: result });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/finetune/replies-for-rating
 */
router.get('/replies-for-rating', async (req, res: Response) => {
    try {
        const { accountId } = (req as unknown as AuthenticatedRequest).auth;
        const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);

        const { data: replies, error } = await getSupabase()
            .from('reply_history')
            .select('*')
            .eq('account_id', accountId)
            .is('rating', null) // Not rated yet
            .not('our_response', 'is', null) // Has response
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) throw error;

        // Map to expected format
        const mapped = replies.map(r => ({
            id: r.id,
            hostile: { text: r.original_text, user: r.original_username },
            our: { text: r.our_response },
            classification: r.classification,
            pattern: r.pattern,
            timestamp: new Date(r.created_at).getTime()
        }));

        res.json({ success: true, replies: mapped, count: mapped.length });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/finetune/auto-eval
 */
router.post('/auto-eval', async (req, res: Response) => {
    try {
        const { accountId } = (req as unknown as AuthenticatedRequest).auth;
        const { replyId, saveFeedback = true } = req.body;

        const { data: reply } = await getSupabase()
            .from('reply_history')
            .select('*')
            .eq('id', replyId)
            .eq('account_id', accountId)
            .single();

        if (!reply) return res.status(404).json({ error: 'Reply not found' });

        const scores = await callGeminiForEval(reply.original_text, reply.our_response);
        const rating = scores.overall >= 6 ? 1 : -1;

        let feedbackSaved = false;
        if (saveFeedback && reply.rating === null) {
            await getSupabase()
                .from('reply_history')
                .update({
                    rating,
                    auto_eval_scores: scores,
                    feedback_at: new Date().toISOString(),
                    is_manual_eval: false
                })
                .eq('id', replyId);
            feedbackSaved = true;
        }

        res.json({
            success: true,
            replyId,
            scores,
            rating,
            feedbackSaved,
            reply: {
                hostile: reply.original_text,
                our: reply.our_response,
                pattern: reply.pattern,
                classification: reply.classification
            }
        });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/finetune/auto-eval-batch
 */
router.post('/auto-eval-batch', async (req, res: Response) => {
    try {
        const { accountId } = (req as unknown as AuthenticatedRequest).auth;
        const { limit = 10 } = req.body;
        const maxLimit = Math.min(limit, 25);

        // Get unrated replies
        const { data: replies } = await getSupabase()
            .from('reply_history')
            .select('*')
            .eq('account_id', accountId)
            .is('rating', null)
            .not('our_response', 'is', null)
            .limit(maxLimit);

        if (!replies) return res.json({ success: true, processed: 0, results: [] });

        const results: any[] = [];
        let processed = 0;
        let errors = 0;

        for (const reply of replies) {
            try {
                const scores = await callGeminiForEval(reply.original_text, reply.our_response);
                const rating = scores.overall >= 6 ? 1 : -1;

                await getSupabase()
                    .from('reply_history')
                    .update({
                        rating,
                        auto_eval_scores: scores,
                        feedback_at: new Date().toISOString()
                    })
                    .eq('id', reply.id);

                results.push({ replyId: reply.id, scores, rating });
                processed++;
            } catch (e: any) {
                errors++;
                results.push({ replyId: reply.id, error: e.message });
            }
        }

        res.json({ success: true, processed, errors, results });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Banned Phrases (CRUD)
 */
router.get('/banned', async (req, res: Response) => {
    try {
        const { accountId } = (req as unknown as AuthenticatedRequest).auth;
        const { data } = await getSupabase()
            .from('banned_phrases')
            .select('*')
            .eq('account_id', accountId)
            .order('added_at', { ascending: false });
        res.json({ success: true, phrases: data || [], count: data?.length });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/banned', async (req, res: Response) => {
    try {
        const { accountId } = (req as unknown as AuthenticatedRequest).auth;
        const { phrase, reason } = req.body;
        if (!phrase) return res.status(400).json({ error: 'Phrase required' });

        const { data, error } = await getSupabase()
            .from('banned_phrases')
            .insert({ account_id: accountId, phrase, reason })
            .select()
            .single();
        if (error) throw error;
        res.json({ success: true, banned: data });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/banned/:phrase', async (req, res: Response) => {
    try {
        const { accountId } = (req as unknown as AuthenticatedRequest).auth;
        const { phrase } = req.params;
        const { error } = await getSupabase()
            .from('banned_phrases')
            .delete()
            .eq('account_id', accountId)
            .eq('phrase', phrase);
        if (error) throw error;
        res.json({ success: true, removed: phrase });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Manual Eval
 */
router.post('/manual-eval', async (req, res: Response) => {
    try {
        const { accountId } = (req as unknown as AuthenticatedRequest).auth;
        const { hostileText, ourReply, rating } = req.body;

        if (!hostileText || !ourReply) return res.status(400).json({ error: 'Fields required' });

        // Insert into reply_history as a manual entry
        const dummyId = `manual_${Date.now()}`;

        const { data, error } = await getSupabase()
            .from('reply_history')
            .insert({
                account_id: accountId,
                original_reply_id: dummyId,
                original_text: hostileText,
                our_response: ourReply,
                rating,
                is_manual_eval: true,
                feedback_at: new Date().toISOString(),
                was_posted: false,
                classification: 'hostile' // Assume hostile for manual training
            })
            .select()
            .single();

        if (error) throw error;
        res.json({ success: true, evalId: data.id });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
