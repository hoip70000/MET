import { useState } from 'react';
import { motion } from 'motion/react';
import {
  Upload as UploadIcon, File, RefreshCw, ChevronDown,
  Tag, X, HardDrive, Boxes, FolderInput, CalendarClock, Play, Trash2, FolderOutput
} from 'lucide-react';
import { Input, Button, GlassCard, Switch, SkeletonCard, Skeleton } from '../ui';
import { CloudFolders } from './CloudFolders';
import { ScheduleTransferModal } from './ScheduleTransferModal';
import { swal, swalToast } from '../../lib/swalTheme';
import type { CloudClient, CloudFile } from '../../lib/cloudClient';
import type { AutomationEngine } from '../../lib/automationEngine';
import type { Workspace } from '../../types';

interface CloudFilesProps {
  cc: CloudClient;
  workspaces: Workspace[];
  onImportWorkspace: (workspace: Workspace) => void;
  automationEngine: AutomationEngine;
}

function TagChip({ tag, onRemove, onClick, active }: { tag: string; onRemove?: () => void; onClick?: () => void; active?: boolean }) {
  return (
    <span
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-colors ${
        active ? 'bg-accent text-white border-accent' : 'bg-accent-soft border-accent/30 text-accent'
      } ${onClick ? 'cursor-pointer hover:opacity-80' : ''}`}
    >
      {tag}
      {onRemove && (
        <button onClick={(e) => { e.stopPropagation(); onRemove(); }} className="hover:opacity-70">
          <X size={10} />
        </button>
      )}
    </span>
  );
}

const SCOPE_LABELS: Record<string, string> = {
  workspace: 'Workspace',
  series: 'Series',
  volume: 'Volume',
  chapter: 'Chapter',
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function CloudFiles({ cc, workspaces, onImportWorkspace, automationEngine }: CloudFilesProps) {
  const [showUploadPanel, setShowUploadPanel] = useState(true);

  const [uploadDesc, setUploadDesc] = useState('');
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('');

  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest' | 'alphabetical'>('newest');
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);

  const [currentFolderId, setCurrentFolderId] = useState<number | null>(null);
  const [showScheduleModal, setShowScheduleModal] = useState(false);

  const knownTags: string[] = Array.from(new Set<string>(cc.files.flatMap(f => f.tags))).sort();

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) setTags(prev => [...prev, t]);
    setTagInput('');
  };

  const resetUploadForm = () => {
    setUploadDesc('');
    setTags([]);
    setSelectedWorkspaceId('');
  };

  const handleUpload = async () => {
    const workspace = workspaces.find(w => w.id === selectedWorkspaceId);
    if (!workspace) {
      swal({ icon: 'error', title: 'No Workspace', text: 'Pick a workspace to back up.' });
      return;
    }
    await cc.uploadWorkspaceBackup(workspace, { notes: uploadDesc, tags, folderId: currentFolderId });
    resetUploadForm();
  };

  const handleRestore = async (file: CloudFile) => {
    const result = await swal({
      icon: 'question',
      title: `Import "${file.name}" into your library?`,
      text: 'This adds it as a new workspace on this device — your cloud copy stays untouched.',
      showCancelButton: true,
      confirmButtonText: 'Import',
    });
    if (!result.isConfirmed) return;
    const workspace = await cc.restoreWorkspaceFromCloud(file);
    if (workspace) {
      onImportWorkspace(workspace);
      swalToast({ icon: 'success', title: `"${workspace.name}" added to your library` });
    }
  };

  const handleMoveFile = async (file: CloudFile) => {
    const options = [{ id: '', name: 'Root' }, ...cc.folders.map(f => ({ id: String(f.id), name: f.name }))];
    const result = await swal({
      title: `Move "${file.name}"`,
      input: 'select',
      inputOptions: Object.fromEntries(options.map(o => [o.id, o.name])),
      inputValue: file.folderId !== null ? String(file.folderId) : '',
      showCancelButton: true,
      confirmButtonText: 'Move',
    });
    if (!result.isConfirmed) return;
    const folderId = result.value === '' ? null : Number(result.value);
    await cc.moveFile(file, folderId);
  };

  const filteredFiles = cc.files
    .filter(f => f.folderId === currentFolderId)
    .filter(f => {
      const q = searchQuery.toLowerCase();
      const matchesQuery = !q || f.name.toLowerCase().includes(q) || f.sender.toLowerCase().includes(q) || f.tags.some(t => t.toLowerCase().includes(q));
      const matchesTag = !activeTagFilter || f.tags.includes(activeTagFilter);
      return matchesQuery && matchesTag;
    })
    .sort((a, b) => {
      if (sortOrder === 'oldest') return new Date(a.date).getTime() - new Date(b.date).getTime();
      if (sortOrder === 'alphabetical') return a.name.localeCompare(b.name);
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
      {/* Folder navigation */}
      <CloudFolders
        folders={cc.folders}
        currentFolderId={currentFolderId}
        onNavigate={setCurrentFolderId}
        onCreateFolder={cc.createFolder}
        onDeleteFolder={cc.deleteFolder}
        fileCountFor={(folderId) => cc.files.filter(f => f.folderId === folderId).length}
        onDownloadFolderZip={(folder) => cc.downloadFolderAsZip(folder.id, folder.name)}
      />

      {/* Upload panel */}
      <GlassCard className="rounded-2xl overflow-hidden">
        <button type="button" onClick={() => setShowUploadPanel(v => !v)} className="w-full flex items-center justify-between gap-3 p-5 text-left">
          <h3 className="text-base font-bold text-ink flex items-center gap-2">
            <UploadIcon className="text-accent" size={18} /> Add to Cloud Storage
          </h3>
          <ChevronDown className={`text-ink-faint transition-transform duration-200 ${showUploadPanel ? 'rotate-180' : ''}`} size={18} />
        </button>
        {showUploadPanel && (
          <div className="px-6 pb-6 border-t border-hairline pt-5 space-y-4">
            <div className="space-y-3">
              {workspaces.length === 0 ? (
                <p className="text-xs text-ink-faint">Create a workspace in Library first, then back it up here.</p>
              ) : (
                <select
                  value={selectedWorkspaceId}
                  onChange={(e) => setSelectedWorkspaceId(e.target.value)}
                  className="w-full bg-ink/5 border border-hairline rounded-xl px-4 py-2.5 text-ink text-sm outline-none focus:border-accent"
                >
                  <option value="">Choose a workspace...</option>
                  {workspaces.map(w => <option key={w.id} value={w.id}>{w.name} ({w.mangas.length} series)</option>)}
                </select>
              )}
              <Input type="text" placeholder="Notes for the team..." value={uploadDesc} onChange={e => setUploadDesc(e.target.value)} />
              <p className="text-[11px] text-ink-faint">Uploads the whole workspace (series, volumes, chapters, covers) as a restorable backup.</p>
            </div>

            <p className="text-[11px] text-ink-faint">Uploads land in the current folder{currentFolderId !== null ? ` ("${cc.folders.find(f => f.id === currentFolderId)?.name || ''}")` : ' (Root)'}.</p>

            {/* Tags */}
            <div className="space-y-2">
              <label className="text-xs text-accent font-semibold flex items-center gap-1"><Tag size={12} /> Tags</label>
              <div className="flex items-center gap-2">
                <Input
                  type="text" placeholder="Type a tag and press Enter"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                />
              </div>
              {(tags.length > 0 || knownTags.length > 0) && (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map(t => <TagChip key={t} tag={t} onRemove={() => setTags(prev => prev.filter(x => x !== t))} />)}
                  {knownTags.filter(t => !tags.includes(t)).map(t => (
                    <button key={t} onClick={() => setTags(prev => [...prev, t])} className="px-2 py-0.5 rounded-full text-[10px] font-semibold border border-hairline text-ink-faint hover:border-accent/40 hover:text-accent transition-colors">
                      + {t}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-2 mt-2">
              <Button onClick={handleUpload} disabled={cc.isUploading} className="flex-1" size="lg">
                {cc.isUploading ? 'Uploading...' : 'Back Up Workspace to Cloud'}
              </Button>
              <Button variant="secondary" onClick={() => setShowScheduleModal(true)} size="lg">
                <CalendarClock size={14} /> Schedule Transfer
              </Button>
            </div>
          </div>
        )}
      </GlassCard>

      <ScheduleTransferModal
        open={showScheduleModal}
        onClose={() => setShowScheduleModal(false)}
        cc={cc}
        createAutomation={automationEngine.createAutomation}
      />

      {/* Scheduled transfers */}
      {automationEngine.automations.length > 0 && (
        <GlassCard className="overflow-hidden">
          <div className="p-4 border-b border-hairline">
            <h3 className="text-sm font-bold text-ink flex items-center gap-2"><CalendarClock className="text-accent" size={16} /> Scheduled Transfers</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-[11px] uppercase tracking-wide text-ink-faint">
                  <th className="px-4 py-2.5 font-semibold">Name</th>
                  <th className="px-4 py-2.5 font-semibold">Size</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                  <th className="px-4 py-2.5 font-semibold">Next Run</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {automationEngine.automations.map(a => (
                  <tr key={a.id} className="border-b border-hairline last:border-0 hover:bg-ink/[0.03] transition-colors">
                    <td className="px-4 py-2.5 font-semibold text-ink">{a.name}</td>
                    <td className="px-4 py-2.5 text-ink-muted font-mono text-xs">{cc.formatSize(a.action.sizeBytes)}</td>
                    <td className="px-4 py-2.5"><Switch checked={a.enabled} onChange={() => automationEngine.toggleAutomation(a.id)} aria-label={`Toggle ${a.name}`} /></td>
                    <td className="px-4 py-2.5 text-ink-faint font-mono text-[11px] whitespace-nowrap">{a.enabled ? formatDate(a.nextRunAt) : '—'}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => automationEngine.runNow(a.id)} className="p-1.5 rounded-lg text-ink-muted hover:text-accent hover:bg-accent-soft transition-colors" aria-label={`Run ${a.name} now`}>
                          <Play size={14} />
                        </button>
                        <button onClick={() => automationEngine.deleteAutomation(a.id)} className="p-1.5 rounded-lg text-ink-muted hover:text-danger hover:bg-danger/10 transition-colors" aria-label={`Delete ${a.name}`}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassCard>
      )}

      {/* Files grid */}
      <div className="space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-2">
          <h3 className="text-lg font-bold text-ink flex items-center gap-2">
            <HardDrive className="text-accent" size={18} /> Cloud Storage
          </h3>
          <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto flex-nowrap">
            <Input type="text" placeholder="Search files, senders, tags..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="flex-1 min-w-[200px] shrink-0" />
            <select
              value={sortOrder}
              onChange={e => setSortOrder(e.target.value as any)}
              className="bg-ink/5 border border-hairline rounded-xl px-3 py-2 text-ink text-sm outline-none focus:border-accent shrink-0"
            >
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
              <option value="alphabetical">A-Z</option>
            </select>
            <button onClick={cc.fetchFiles} className="text-sm text-accent hover:text-ink flex items-center gap-1 bg-accent-soft px-3 py-2 rounded-xl border border-accent/20 transition-colors shrink-0">
              <RefreshCw size={14} className={cc.isLoading ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
        </div>

        {knownTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {knownTags.map(t => (
              <TagChip key={t} tag={t} active={activeTagFilter === t} onClick={() => setActiveTagFilter(prev => prev === t ? null : t)} />
            ))}
          </div>
        )}

        {cc.isLoading && cc.files.length === 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {[1, 2, 3].map(i => <SkeletonCard key={i} className="h-64" />)}
          </div>
        ) : filteredFiles.length === 0 ? (
          <GlassCard className="text-center py-16">
            <File className="mx-auto text-ink-faint mb-3 opacity-50" size={48} />
            <p className="text-ink-muted font-semibold">{cc.files.length === 0 ? 'Repository is empty.' : 'No files in this folder.'}</p>
            <p className="text-xs text-ink-faint mt-1">{cc.files.length === 0 ? 'Upload the first file to see the magic!' : 'Try a different folder, search, or tag.'}</p>
          </GlassCard>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredFiles.map((file) => (
              <GlassCard key={file.id} radius="xl" className="overflow-hidden flex flex-col hover:border-accent/50 transition-colors group">
                <div className="h-40 w-full bg-accent-soft flex flex-col items-center justify-center border-b border-hairline relative overflow-hidden">
                  {cc.coverUrls[file.id] ? (
                    <>
                      <img src={cc.coverUrls[file.id]} alt="Cover" className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
                    </>
                  ) : file.coverMsgId ? (
                    <Skeleton className="absolute inset-0 rounded-none border-0" />
                  ) : (
                    <Boxes size={32} className="text-accent/50" />
                  )}
                  <span className="absolute top-2 left-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide bg-black/50 text-white backdrop-blur-sm">
                    <Boxes size={10} /> {SCOPE_LABELS[file.scope] ?? 'Workspace'}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleMoveFile(file); }}
                    className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/40 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    aria-label={`Move ${file.name}`}
                  >
                    <FolderOutput size={12} />
                  </button>
                </div>
                <div className="p-4 flex flex-col gap-2 flex-1">
                  <h4 className="font-bold text-ink text-base truncate">{file.name}</h4>
                  {file.description && <p className="text-xs text-ink-muted line-clamp-2 leading-relaxed">{file.description}</p>}
                  {file.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {file.tags.map(t => <TagChip key={t} tag={t} onClick={() => setActiveTagFilter(t)} />)}
                    </div>
                  )}

                  <p className="text-xs text-ink-muted mt-1 bg-ink/5 px-2 py-1.5 rounded-lg border border-hairline truncate">{file.sender || 'Team Member'}</p>

                  <div className="flex justify-between items-center text-xs text-ink-muted font-mono border-t border-hairline pt-2 mt-auto">
                    <span>{new Date(file.date).toLocaleDateString()}</span>
                    <button onClick={() => handleRestore(file)} className="text-accent hover:text-ink flex items-center gap-1 font-sans font-bold bg-accent-soft hover:opacity-80 px-2 py-1 rounded transition-colors">
                      <FolderInput size={14} /> Restore
                    </button>
                  </div>
                </div>
              </GlassCard>
            ))}
          </div>
        )}
        {cc.hasMoreFiles && searchQuery === '' && !activeTagFilter && (
          <div className="flex justify-center pt-2">
            <Button variant="secondary" size="sm" onClick={cc.fetchMoreFiles} disabled={cc.isLoadingMoreFiles}>
              {cc.isLoadingMoreFiles ? 'Loading...' : 'Load More'}
            </Button>
          </div>
        )}
      </div>
    </motion.div>
  );
}
