import { useState } from 'react';
import { SpotlightCard } from '@/components/ui/spotlight-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  useSources,
  useIngestUrl,
  useIngestText,
  useDeleteSource,
  useSearchAmmo
} from '@/hooks/useDocs';
import { FileText, Link, FileUp, Search, Trash2, RefreshCw, BookOpen } from 'lucide-react';

export default function Docs() {
  const [urlInput, setUrlInput] = useState('');
  const [urlName, setUrlName] = useState('');
  const [textContent, setTextContent] = useState('');
  const [textName, setTextName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const { data: sources, isLoading: sourcesLoading, refetch: refetchSources } = useSources();

  const ingestUrl = useIngestUrl();
  const ingestText = useIngestText();
  const deleteSource = useDeleteSource();
  const searchAmmo = useSearchAmmo();

  const handleIngestUrl = async () => {
    if (!urlInput.trim() || !urlName.trim()) {
      alert('URL and source name required');
      return;
    }
    try {
      const result = await ingestUrl.mutateAsync({ url: urlInput, sourceName: urlName });
      alert(`Ingested ${result.chunksIngested} chunks`);
      setUrlInput('');
      setUrlName('');
    } catch (err: any) {
      alert('Error: ' + err.message);
    }
  };

  const handleIngestText = async () => {
    if (!textContent.trim() || !textName.trim()) {
      alert('Text and source name required');
      return;
    }
    try {
      const result = await ingestText.mutateAsync({ text: textContent, sourceName: textName });
      alert(`Ingested ${result.chunksIngested} chunks`);
      setTextContent('');
      setTextName('');
    } catch (err: any) {
      alert('Error: ' + err.message);
    }
  };

  const handleDeleteSource = async (name: string) => {
    if (confirm(`Delete source "${name}"?`)) {
      await deleteSource.mutateAsync(name);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    await searchAmmo.mutateAsync({ query: searchQuery, topK: 5 });
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white mb-2">Knowledge Base</h1>
        <p className="text-muted-foreground text-sm max-w-lg">
          Manage document sources and search your ammunition database.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Ingest URL */}
        <SpotlightCard className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <Link className="w-4 h-4 text-zinc-500" />
            <h3 className="text-sm font-medium text-zinc-200">Ingest URL</h3>
          </div>
          <div className="space-y-3">
            <Input
              placeholder="https://example.com/article"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              className="bg-zinc-900 border-zinc-800"
            />
            <Input
              placeholder="Source name"
              value={urlName}
              onChange={(e) => setUrlName(e.target.value)}
              className="bg-zinc-900 border-zinc-800"
            />
            <Button
              onClick={handleIngestUrl}
              disabled={ingestUrl.isPending}
              className="w-full bg-orange-600 hover:bg-orange-700"
            >
              {ingestUrl.isPending ? 'Ingesting...' : 'Ingest URL'}
            </Button>
          </div>
        </SpotlightCard>

        {/* Ingest Text */}
        <SpotlightCard className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <FileUp className="w-4 h-4 text-zinc-500" />
            <h3 className="text-sm font-medium text-zinc-200">Ingest Text</h3>
          </div>
          <div className="space-y-3">
            <Textarea
              placeholder="Paste text content here..."
              value={textContent}
              onChange={(e) => setTextContent(e.target.value)}
              className="bg-zinc-900 border-zinc-800 min-h-[80px] resize-none"
            />
            <Input
              placeholder="Source name"
              value={textName}
              onChange={(e) => setTextName(e.target.value)}
              className="bg-zinc-900 border-zinc-800"
            />
            <Button
              onClick={handleIngestText}
              disabled={ingestText.isPending}
              className="w-full bg-orange-600 hover:bg-orange-700"
            >
              {ingestText.isPending ? 'Ingesting...' : 'Ingest Text'}
            </Button>
          </div>
        </SpotlightCard>
      </div>

      {/* Sources List */}
      <SpotlightCard className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-zinc-500" />
            <h3 className="text-sm font-medium text-zinc-200">Document Sources</h3>
          </div>
          <Button variant="ghost" size="sm" onClick={() => refetchSources()} className="h-7 w-7 p-0">
            <RefreshCw className="w-3 h-3" />
          </Button>
        </div>
        {sourcesLoading ? (
          <div className="text-zinc-500 text-sm">Loading...</div>
        ) : !sources || sources.length === 0 ? (
          <div className="text-zinc-500 text-sm">No sources ingested</div>
        ) : (
          <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
            {sources.map((s) => (
              <div key={s} className="flex justify-between items-center p-3 bg-zinc-900/50 rounded-lg border border-zinc-800">
                <span className="text-sm font-medium text-zinc-200">{s}</span>
                <button
                  onClick={() => handleDeleteSource(s)}
                  className="text-red-400 hover:text-red-300 p-1"
                  disabled={deleteSource.isPending}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </SpotlightCard>

      {/* Ammo Search */}
      <SpotlightCard className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <BookOpen className="w-4 h-4 text-zinc-500" />
          <h3 className="text-sm font-medium text-zinc-200">Search Ammunition</h3>
        </div>
        <div className="flex gap-2 mb-4">
          <Input
            placeholder="Search query..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="bg-zinc-900 border-zinc-800 flex-1"
          />
          <Button
            onClick={handleSearch}
            disabled={searchAmmo.isPending}
            variant="outline"
            className="bg-zinc-900 border-zinc-800"
          >
            <Search className="w-4 h-4 mr-2" />
            {searchAmmo.isPending ? 'Searching...' : 'Search'}
          </Button>
        </div>

        {searchAmmo.data && (
          <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
            {searchAmmo.data.length === 0 ? (
              <div className="text-zinc-500 text-sm">No results found</div>
            ) : (
              searchAmmo.data.map((r, i) => (
                <div key={i} className="bg-zinc-900/50 p-3 rounded-lg border-l-2 border-purple-500">
                  <div className="flex justify-between mb-1">
                    <span className="text-xs text-purple-400">#{i + 1} {r.source || 'unknown'}</span>
                    <span className="text-xs text-zinc-500">{(r.score * 100).toFixed(0)}%</span>
                  </div>
                  <p className="text-sm text-zinc-300">{r.text?.substring(0, 300)}...</p>
                </div>
              ))
            )}
          </div>
        )}
      </SpotlightCard>
    </div>
  );
}
