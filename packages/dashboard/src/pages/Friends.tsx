import { useState } from 'react';
import { SpotlightCard } from '@/components/ui/spotlight-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  useFriends,
  useSuggestions,
  useAddFriend,
  useRemoveFriend,
  useUpdateFriendMode,
  useAcceptSuggestion,
  useRejectSuggestion
} from '@/hooks/useFriends';
import { Users, UserPlus, Sparkles, RefreshCw, X, Check, Flame, MessageCircle, Heart } from 'lucide-react';

type FriendMode = 'friendly' | 'banter' | 'roast';

export default function Friends() {
  const [newUsername, setNewUsername] = useState('');
  const [newMode, setNewMode] = useState<FriendMode>('banter');

  const { data: friendsData, isLoading: friendsLoading } = useFriends();
  const { data: suggestions, isLoading: suggestionsLoading, refetch: refetchSuggestions } = useSuggestions();

  const addFriend = useAddFriend();
  const removeFriend = useRemoveFriend();
  const updateMode = useUpdateFriendMode();
  const acceptSuggestion = useAcceptSuggestion();
  const rejectSuggestion = useRejectSuggestion();

  const handleAddFriend = async () => {
    const username = newUsername.trim().replace(/^@/, '');
    if (!username) return;
    await addFriend.mutateAsync({ username, mode: newMode });
    setNewUsername('');
  };

  const handleRemoveFriend = async (username: string) => {
    if (confirm(`Remove @${username} from friends?`)) {
      await removeFriend.mutateAsync(username);
    }
  };

  const handleUpdateMode = async (username: string, mode: FriendMode) => {
    await updateMode.mutateAsync({ username, mode });
  };

  const handleAcceptSuggestion = async (username: string) => {
    await acceptSuggestion.mutateAsync(username);
  };

  const handleRejectSuggestion = async (username: string) => {
    await rejectSuggestion.mutateAsync(username);
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white mb-2">Friends Network</h1>
        <p className="text-muted-foreground text-sm max-w-lg">
          Manage your friends list and interaction modes.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Add Friend */}
        <SpotlightCard className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <UserPlus className="w-4 h-4 text-zinc-500" />
            <h3 className="text-sm font-medium text-zinc-200">Add Friend</h3>
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="@username"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddFriend()}
              className="bg-zinc-900 border-zinc-800 flex-1"
            />
            <select
              value={newMode}
              onChange={(e) => setNewMode(e.target.value as FriendMode)}
              className="bg-zinc-900 border border-zinc-800 rounded-md px-3 text-sm text-zinc-200"
            >
              <option value="friendly">Friendly</option>
              <option value="banter">Banter</option>
              <option value="roast">Roast</option>
            </select>
            <Button
              onClick={handleAddFriend}
              disabled={addFriend.isPending || !newUsername.trim()}
              className="bg-orange-600 hover:bg-orange-700"
            >
              Add
            </Button>
          </div>
        </SpotlightCard>

        {/* Friend Count */}
        <SpotlightCard className="p-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-zinc-500" />
            <h3 className="text-sm font-medium text-zinc-200">Total Friends</h3>
          </div>
          <span className="text-3xl font-bold text-white">{friendsData?.count || 0}</span>
        </SpotlightCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Friends List */}
        <SpotlightCard className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-4 h-4 text-zinc-500" />
            <h3 className="text-sm font-medium text-zinc-200">Friends List</h3>
          </div>
          {friendsLoading ? (
            <div className="text-zinc-500 text-sm">Loading...</div>
          ) : !friendsData?.friends || friendsData.friends.length === 0 ? (
            <div className="text-zinc-500 text-sm">No friends yet</div>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
              {friendsData.friends.map((f) => (
                <div key={f.username} className="flex justify-between items-center p-3 bg-zinc-900/50 rounded-lg border border-zinc-800">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-zinc-200">@{f.username}</span>
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      f.mode === 'roast' ? 'bg-red-500/20 text-red-400' :
                      f.mode === 'friendly' ? 'bg-pink-500/20 text-pink-400' :
                      'bg-blue-500/20 text-blue-400'
                    }`}>
                      {f.mode === 'roast' ? <Flame className="w-3 h-3 inline mr-1" /> :
                       f.mode === 'friendly' ? <Heart className="w-3 h-3 inline mr-1" /> :
                       <MessageCircle className="w-3 h-3 inline mr-1" />}
                      {f.mode}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={f.mode}
                      onChange={(e) => handleUpdateMode(f.username, e.target.value as FriendMode)}
                      className="bg-zinc-800 border-none rounded text-xs px-2 py-1 text-zinc-300"
                    >
                      <option value="friendly">Friendly</option>
                      <option value="banter">Banter</option>
                      <option value="roast">Roast</option>
                    </select>
                    <button
                      onClick={() => handleRemoveFriend(f.username)}
                      className="text-red-400 hover:text-red-300 p-1"
                      disabled={removeFriend.isPending}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SpotlightCard>

        {/* Suggestions */}
        <SpotlightCard className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-zinc-500" />
              <h3 className="text-sm font-medium text-zinc-200">Suggestions</h3>
            </div>
            <Button variant="ghost" size="sm" onClick={() => refetchSuggestions()} className="h-7 w-7 p-0">
              <RefreshCw className="w-3 h-3" />
            </Button>
          </div>
          {suggestionsLoading ? (
            <div className="text-zinc-500 text-sm">Loading...</div>
          ) : !suggestions || suggestions.length === 0 ? (
            <div className="text-zinc-500 text-sm">No suggestions yet</div>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
              {suggestions.map((s) => (
                <div key={s.username} className="flex justify-between items-center p-3 bg-zinc-900/50 rounded-lg border border-zinc-800">
                  <div>
                    <span className="text-sm font-medium text-zinc-200">@{s.username}</span>
                    <div className="text-xs text-zinc-500 mt-0.5">
                      {s.count} interactions | {(s.friendlyRatio * 100).toFixed(0)}% friendly
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleAcceptSuggestion(s.username)}
                      className="bg-green-600 hover:bg-green-700 p-1.5 rounded"
                      disabled={acceptSuggestion.isPending}
                    >
                      <Check className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => handleRejectSuggestion(s.username)}
                      className="bg-zinc-700 hover:bg-zinc-600 p-1.5 rounded"
                      disabled={rejectSuggestion.isPending}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SpotlightCard>
      </div>
    </div>
  );
}
