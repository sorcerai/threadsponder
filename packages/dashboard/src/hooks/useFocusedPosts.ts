import { useMutation, useQueryClient } from '@tanstack/react-query';

export type ClassificationType = 'hostile' | 'friendly' | 'neutral';

interface UpdateClassificationsParams {
  postId: string;
  targetClassifications: ClassificationType[];
}

/**
 * Mutation to update target classifications for a focused post
 * Used with the local /api/focus/classifications endpoint
 */
export function useUpdateClassifications() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ postId, targetClassifications }: UpdateClassificationsParams) => {
      const res = await fetch(`/api/focus/${postId}/classifications`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetClassifications }),
      });
      if (!res.ok) throw new Error('Failed to update classifications');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['focus'] });
    },
  });
}
