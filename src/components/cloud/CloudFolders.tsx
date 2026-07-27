import { Folder, FolderPlus, ChevronRight, Trash2, Home, Users, Download } from 'lucide-react';
import { GlassCard, Button } from '../ui';
import { swal } from '../../lib/swalTheme';
import type { CloudFolder } from '../../lib/cloudClient';

interface CloudFoldersProps {
  folders: CloudFolder[];
  currentFolderId: number | null;
  onNavigate: (folderId: number | null) => void;
  onCreateFolder: (name: string, parentId: number | null) => void;
  onDeleteFolder: (folder: CloudFolder) => void;
  fileCountFor: (folderId: number) => number;
  onEditMembers?: (folder: CloudFolder, members: string[]) => void;
  onDownloadFolderZip?: (folder: CloudFolder) => void;
}

export function CloudFolders({ folders, currentFolderId, onNavigate, onCreateFolder, onDeleteFolder, fileCountFor, onEditMembers, onDownloadFolderZip }: CloudFoldersProps) {
  const childFolders = folders.filter(f => f.parentId === currentFolderId);

  const breadcrumb: CloudFolder[] = [];
  let cursor = currentFolderId;
  while (cursor !== null) {
    const folder = folders.find(f => f.id === cursor);
    if (!folder) break;
    breadcrumb.unshift(folder);
    cursor = folder.parentId;
  }

  const handleCreate = async () => {
    const result = await swal({
      title: 'New Folder',
      input: 'text',
      inputLabel: 'Folder name',
      showCancelButton: true,
      confirmButtonText: 'Create',
    });
    const name = (result.value || '').trim();
    if (result.isConfirmed && name) onCreateFolder(name, currentFolderId);
  };

  const handleEditMembers = async (folder: CloudFolder) => {
    if (!onEditMembers) return;
    const result = await swal({
      title: `Members of "${folder.name}"`,
      input: 'text',
      inputLabel: 'Comma-separated user IDs allowed to upload here (empty = everyone)',
      inputValue: folder.members.join(', '),
      showCancelButton: true,
      confirmButtonText: 'Save',
    });
    if (!result.isConfirmed) return;
    const members = (result.value || '').split(',').map((s: string) => s.trim()).filter(Boolean);
    onEditMembers(folder, members);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 text-sm flex-wrap">
          <button onClick={() => onNavigate(null)} className={`flex items-center gap-1 px-2 py-1 rounded-lg transition-colors ${currentFolderId === null ? 'text-ink font-semibold' : 'text-ink-muted hover:text-accent'}`}>
            <Home size={13} /> Root
          </button>
          {breadcrumb.map(f => (
            <span key={f.id} className="flex items-center gap-1.5">
              <ChevronRight size={12} className="text-ink-faint" />
              <button
                onClick={() => onNavigate(f.id)}
                className={`transition-colors ${f.id === currentFolderId ? 'text-ink font-semibold' : 'text-ink-muted hover:text-accent'}`}
              >
                {f.name}
              </button>
            </span>
          ))}
        </div>
        <Button variant="secondary" size="sm" onClick={handleCreate}>
          <FolderPlus size={14} /> New Folder
        </Button>
      </div>

      {childFolders.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {childFolders.map(folder => (
            <GlassCard key={folder.id} className="group relative p-4 flex flex-col items-center gap-2 cursor-pointer hover:border-accent/50 transition-colors" onClick={() => onNavigate(folder.id)}>
              <Folder className="text-accent/70" size={26} />
              <span className="text-xs font-semibold text-ink text-center truncate w-full">{folder.name}</span>
              <span className="text-[10px] text-ink-faint">{fileCountFor(folder.id)} file(s){folder.members.length > 0 ? ` · ${folder.members.length} member(s)` : ''}</span>
              <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {onDownloadFolderZip && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onDownloadFolderZip(folder); }}
                    className="p-1 rounded-lg bg-black/40 text-white"
                    aria-label={`Download ${folder.name} as ZIP`}
                    title="Download folder as ZIP"
                  >
                    <Download size={11} />
                  </button>
                )}
                {onEditMembers && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleEditMembers(folder); }}
                    className="p-1 rounded-lg bg-black/40 text-white"
                    aria-label={`Edit members of ${folder.name}`}
                  >
                    <Users size={11} />
                  </button>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); onDeleteFolder(folder); }}
                  className="p-1 rounded-lg bg-black/40 text-white"
                  aria-label={`Delete folder ${folder.name}`}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </GlassCard>
          ))}
        </div>
      )}
    </div>
  );
}
