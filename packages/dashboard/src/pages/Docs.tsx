import { useState, useRef } from 'react';
import { SpotlightCard } from '@/components/ui/spotlight-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  useSources,
  useIngestUrl,
  useIngestText,
  useDeleteSource,
  useSearchAmmo,
  useVoiceDocuments,
  useUploadVoiceDocument,
  useDeleteVoiceDocument
} from '@/hooks/useDocs';
import { FileText, Link, FileUp, Search, Trash2, RefreshCw, BookOpen, Upload, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

export default function Docs() {
  const [urlInput, setUrlInput] = useState('');
  const [urlName, setUrlName] = useState('');
  const [textContent, setTextContent] = useState('');
  const [textName, setTextName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: sources, isLoading: sourcesLoading, refetch: refetchSources } = useSources();
  const { data: voiceDocuments, refetch: refetchDocs } = useVoiceDocuments();

  const ingestUrl = useIngestUrl();
  const ingestText = useIngestText();
  const deleteSource = useDeleteSource();
  const searchAmmo = useSearchAmmo();
  const uploadDocument = useUploadVoiceDocument();
  const deleteDocument = useDeleteVoiceDocument();

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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file size (10MB)
    if (file.size > 10 * 1024 * 1024) {
      alert('File too large. Maximum size is 10MB.');
      return;
    }

    // Validate file type
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['txt', 'md', 'pdf', 'docx'].includes(ext || '')) {
      alert('Unsupported file type. Supported: txt, md, pdf, docx');
      return;
    }

    try {
      await uploadDocument.mutateAsync({ file });
      alert('Document uploaded! Processing will begin shortly.');
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err: any) {
      alert('Error: ' + err.message);
    }
  };

  const handleDeleteDocument = async (id: string, filename: string) => {
    if (confirm(`Delete "${filename}"? This will also remove all extracted examples.`)) {
      await deleteDocument.mutateAsync(id);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-400">Pending</span>;
      case 'processing':
        return <span className="text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />Processing</span>;
      case 'completed':
        return <span className="text-xs px-2 py-0.5 rounded bg-green-500/20 text-green-400 flex items-center gap-1"><CheckCircle className="w-3 h-3" />Completed</span>;
      case 'failed':
        return <span className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-400 flex items-center gap-1"><AlertCircle className="w-3 h-3" />Failed</span>;
      default:
        return null;
    }
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

      {/* File Upload - Full Width */}
      <SpotlightCard className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <Upload className="w-4 h-4 text-zinc-500" />
          <h3 className="text-sm font-medium text-zinc-200">Upload Document</h3>
        </div>
        <div className="border-2 border-dashed border-zinc-700 rounded-lg p-8 text-center hover:border-orange-500/50 transition-colors">
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,.pdf,.docx"
            onChange={handleFileUpload}
            className="hidden"
            id="file-upload"
          />
          <label
            htmlFor="file-upload"
            className="cursor-pointer flex flex-col items-center gap-3"
          >
            <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center">
              <Upload className="w-6 h-6 text-zinc-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-zinc-200">
                {uploadDocument.isPending ? 'Uploading...' : 'Click to upload or drag & drop'}
              </p>
              <p className="text-xs text-zinc-500 mt-1">
                PDF, DOCX, TXT, MD (max 10MB)
              </p>
            </div>
          </label>
        </div>
        {uploadDocument.isPending && (
          <div className="mt-3 flex items-center gap-2 text-sm text-zinc-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            Uploading and processing...
          </div>
        )}
      </SpotlightCard>

      {/* Voice Documents List */}
      {voiceDocuments && voiceDocuments.length > 0 && (
        <SpotlightCard className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-zinc-500" />
              <h3 className="text-sm font-medium text-zinc-200">Voice Training Documents</h3>
            </div>
            <Button variant="ghost" size="sm" onClick={() => refetchDocs()} className="h-7 w-7 p-0">
              <RefreshCw className="w-3 h-3" />
            </Button>
          </div>
          <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
            {voiceDocuments.map((doc) => (
              <div key={doc.id} className="flex justify-between items-center p-3 bg-zinc-900/50 rounded-lg border border-zinc-800">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-zinc-200 truncate">{doc.filename}</span>
                    {getStatusBadge(doc.status)}
                  </div>
                  {doc.status === 'completed' && doc.examples_created && (
                    <p className="text-xs text-zinc-500 mt-1">{doc.examples_created} examples extracted</p>
                  )}
                  {doc.status === 'failed' && doc.error_message && (
                    <p className="text-xs text-red-400 mt-1">{doc.error_message}</p>
                  )}
                </div>
                <button
                  onClick={() => handleDeleteDocument(doc.id, doc.filename)}
                  className="text-red-400 hover:text-red-300 p-1 ml-2"
                  disabled={deleteDocument.isPending}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </SpotlightCard>
      )}

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
