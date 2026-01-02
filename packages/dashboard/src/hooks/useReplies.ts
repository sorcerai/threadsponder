import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface ReplyData {
    id: string;
    hostile: {
        id: string;
        text: string;
        user: string;
    };
    our: {
        id: string;
        text: string;
    };
    classification: string;
    confidence: number;
    timestamp: number;
    isFriend: boolean;
    isPending?: boolean; // Flag to identify pending vs historical
}

interface PendingReply {
    id: string;
    username: string;
    commentText: string;
    commentId: string;
    suggestedResponse: string;
    classification: string;
    confidence: number;
    timestamp: number;
    isFriend?: boolean;
}

interface PendingResponse {
    success: boolean;
    replies: PendingReply[];
}

interface SamplesResponse {
    success: boolean;
    samples: ReplyData[];
    total: number;
    hasMore: boolean;
}

interface RepliesResponse {
    success: boolean;
    pending: ReplyData[];
    historical: ReplyData[];
    total: number;
    hasMore: boolean;
}

// Transform pending reply to ReplyData format
function transformPending(p: PendingReply): ReplyData {
    return {
        id: p.id,
        hostile: {
            id: p.commentId,
            text: p.commentText,
            user: p.username
        },
        our: {
            id: '',
            text: p.suggestedResponse
        },
        classification: p.classification,
        confidence: p.confidence,
        timestamp: p.timestamp,
        isFriend: p.isFriend || false,
        isPending: true
    };
}

export function useReplies(limit = 20) {
    const queryClient = useQueryClient();

    const query = useQuery({
        queryKey: ['replies', 'combined', limit],
        queryFn: async () => {
            // Fetch both pending and historical in parallel
            const [pendingRes, samplesRes] = await Promise.all([
                fetch(`/api/replies/pending`),
                fetch(`/api/replies/samples?limit=${limit}`)
            ]);

            if (!pendingRes.ok) throw new Error('Failed to fetch pending replies');
            if (!samplesRes.ok) throw new Error('Failed to fetch samples');

            const pendingData = await pendingRes.json() as PendingResponse;
            const samplesData = await samplesRes.json() as SamplesResponse;

            // Transform pending to common format
            const pending = (pendingData.replies || []).map(transformPending);

            // Mark historical replies
            const historical = (samplesData.samples || []).map(s => ({
                ...s,
                isPending: false
            }));

            return {
                success: true,
                pending,
                historical,
                // Combined for backward compatibility
                samples: [...pending, ...historical],
                total: pending.length + samplesData.total,
                hasMore: samplesData.hasMore
            } as RepliesResponse & { samples: ReplyData[] };
        },
        refetchInterval: 5000 // Refresh every 5s
    });

    const approveMutation = useMutation({
        mutationFn: async (id: string) => {
            const res = await fetch(`/api/replies/${id}/approve`, { method: 'POST' });
            if (!res.ok) throw new Error('Failed to approve reply');
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['replies'] });
            queryClient.invalidateQueries({ queryKey: ['stats'] });
        }
    });

    const rejectMutation = useMutation({
        mutationFn: async (id: string) => {
            const res = await fetch(`/api/replies/${id}/skip`, { method: 'POST' });
            if (!res.ok) throw new Error('Failed to reject reply');
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['replies'] });
            queryClient.invalidateQueries({ queryKey: ['stats'] });
        }
    });

    return {
        ...query,
        approve: approveMutation.mutate,
        reject: rejectMutation.mutate
    };
}
