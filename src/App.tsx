import React, { useState, useRef, useEffect } from 'react';
import {
  Plus, Trash2, BookOpen, Layers, FileStack, ImagePlus, Sparkles, Boxes, Download, Upload,
  UploadCloud, FileArchive, Tag, X, PackagePlus, Pencil
} from 'lucide-react';
import { get, set } from 'idb-keyval';
import { MangaSeries, Volume, Chapter, Workspace, Page } from './types';
import { swal, swalToast } from './lib/swalTheme';
import { readImageFile } from './lib/image';
import { genId } from './lib/id';
import 'sweetalert2/dist/sweetalert2.min.css';
import { TopBar } from './components/TopBar';
import { SplashScreen } from './components/SplashScreen';
import { SettingsPanel } from './components/SettingsPanel';
import { BottomTabBar } from './components/BottomTabBar';
import { SidebarRail } from './components/SidebarRail';
import { CloudStorage } from './components/CloudStorage';
import { AdSlot } from './components/AdSlot';
import { LibraryAnnouncementBanner } from './components/LibraryAnnouncementBanner';
import { TeamsPanel } from './components/TeamsPanel';
import { AuthGate } from './components/AuthGate';
import { PrivacyPolicy } from './components/legal/PrivacyPolicy';
import { UserAgreement } from './components/legal/UserAgreement';
import { Modal, Button, Input, Textarea, GlassCard, SkeletonCard, AppContextMenu } from './components/ui';
import { Studio } from './components/studio/Studio';
import { StudioBuildTransition } from './components/studio/StudioBuildTransition';
import { TextEditorPage } from './components/textEditor/TextEditorPage';
import { useAutomationEngine } from './lib/automationEngine';
import { useCloudClient } from './lib/cloudClient';
import { migrateWorkspace } from './lib/migrate';
import { exportWorkspaceToMsp, downloadMsp, importMspFile, saveImportedStudioData, exportAllWorkspacesToZip, downloadFullBackup } from './lib/mspFile';
import {
  exportWorkspaceToZip, exportMangaToZip, exportVolumeToZip, exportChapterToZip,
  downloadZip, importWorkspaceFromZip,
} from './lib/workspaceZip';
import { CloudConfig } from './components/cloud/CloudConfig';
import { CloudTransferModals } from './components/cloud/CloudTransferModals';
import { interleaveWithAds } from './lib/interleaveAds';
import type { NavTabId } from './config/navTabs';

export default function App() {
  const [showSplash, setShowSplash] = useState(true);

  // Workspaces > Series > Volumes > Chapters
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(true);
  const cloudClient = useCloudClient();
  const automationEngine = useAutomationEngine(cloudClient);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [activeMangaId, setActiveMangaId] = useState<string | null>(null);
  const [activeVolumeId, setActiveVolumeId] = useState<string | null>(null);
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);

  const [activeNavigationTab, setActiveNavigationTab] = useState<NavTabId>('library');

  // Create workspace modal
  const [showCreateWorkspaceModal, setShowCreateWorkspaceModal] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [newWorkspaceDesc, setNewWorkspaceDesc] = useState('');
  const [newWorkspaceCoverUrl, setNewWorkspaceCoverUrl] = useState('');
  const workspaceCoverInputRef = useRef<HTMLInputElement>(null);
  const mspImportInputRef = useRef<HTMLInputElement>(null);
  const zipImportInputRef = useRef<HTMLInputElement>(null);

  // Tag editor modal
  const [tagEditorWorkspaceId, setTagEditorWorkspaceId] = useState<string | null>(null);
  const [newTagValue, setNewTagValue] = useState('');

  // Studio entrance transition — set on a chapter-card click, cleared once
  // StudioBuildTransition finishes and hands off to setActiveChapterId.
  const [studioBuilding, setStudioBuilding] = useState(false);
  const [pendingChapterId, setPendingChapterId] = useState<string | null>(null);

  // Cloud connect modal (shown from Library when uploading without an active Telegram session)
  const [showCloudConnectModal, setShowCloudConnectModal] = useState(false);
  const [pendingCloudUpload, setPendingCloudUpload] = useState<{ workspace: Workspace; scope: 'workspace' | 'series' | 'volume' | 'chapter' } | null>(null);
  const [pendingBackupAll, setPendingBackupAll] = useState(false);
  const [isBackingUpAll, setIsBackingUpAll] = useState(false);
  const [isDownloadingAllBackup, setIsDownloadingAllBackup] = useState(false);

  // Create series modal
  const [showCreateSeriesModal, setShowCreateSeriesModal] = useState(false);
  const [newSeriesTitle, setNewSeriesTitle] = useState('');
  const [newSeriesType, setNewSeriesType] = useState<'manga' | 'manhwa'>('manga');
  const [newSeriesDesc, setNewSeriesDesc] = useState('');
  const [newSeriesCoverUrl, setNewSeriesCoverUrl] = useState('');
  const coverFileInputRef = useRef<HTMLInputElement>(null);

  // Create volume modal
  const [showCreateVolumeModal, setShowCreateVolumeModal] = useState(false);
  const [newVolumeName, setNewVolumeName] = useState('');
  const [newVolumeCoverUrl, setNewVolumeCoverUrl] = useState('');
  const volumeCoverInputRef = useRef<HTMLInputElement>(null);

  // Create chapter modal
  const [showCreateChapterModal, setShowCreateChapterModal] = useState(false);
  const [newChapterName, setNewChapterName] = useState('');
  const [newChapterCoverUrl, setNewChapterCoverUrl] = useState('');
  const chapterCoverInputRef = useRef<HTMLInputElement>(null);

  // Edit library card info modal (rename/re-cover a workspace/series/volume/chapter)
  const [editTarget, setEditTarget] = useState<{ level: 'workspace' | 'manga' | 'volume' | 'chapter'; id: string } | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editCoverUrl, setEditCoverUrl] = useState('');
  const [editType, setEditType] = useState<'manga' | 'manhwa'>('manga');
  const editCoverInputRef = useRef<HTMLInputElement>(null);

  // ZIP build/import progress modal
  const [zipProgress, setZipProgress] = useState<{ label: string; current: number; total: number } | null>(null);

  // Legal modals
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);

  // Bridges "Send to TypeR" from the standalone Text Editor page into whichever chapter's
  // Studio the user next opens — Studio consumes and clears this on mount.
  const [pendingTyperScript, setPendingTyperScript] = useState<string | null>(null);
  // Carries a `?join=<token>` invite link into the Teams tab on load, redeemed
  // (as a join request, not an auto-join) then cleared from the URL.
  const [pendingJoinToken, setPendingJoinToken] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const join = params.get('join');
    if (join) {
      setPendingJoinToken(join);
      setActiveNavigationTab('teams');
      params.delete('join');
      const next = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (next ? `?${next}` : ''));
    }
  }, []);

  useEffect(() => {
    get('workspaces_library').then(async (saved) => {
      if (saved && Array.isArray(saved) && saved.length > 0) {
        setWorkspaces(saved.map(migrateWorkspace));
        return;
      }
      // One-time migration from the pre-workspace flat manga library.
      const legacyMangas = await get('mangas_library');
      if (legacyMangas && Array.isArray(legacyMangas) && legacyMangas.length > 0) {
        setWorkspaces([migrateWorkspace({ id: genId('workspace'), name: 'My Workspace', description: '', coverUrl: '', mangas: legacyMangas, tags: [] })]);
      }
    }).catch(console.error).finally(() => setIsLoadingLibrary(false));
  }, []);

  useEffect(() => {
    if (workspaces.length > 0) {
      const timeout = setTimeout(() => {
        set('workspaces_library', workspaces).catch(console.error);
      }, 800);
      return () => clearTimeout(timeout);
    }
  }, [workspaces]);

  // Once per session, if Telegram connects and the local library is empty,
  // offer to restore the most recent cloud backup instead of leaving the
  // user to discover it manually via the Cloud tab.
  const restorePromptShownRef = useRef(false);
  useEffect(() => {
    if (restorePromptShownRef.current) return;
    if (!cloudClient.isConnected || !cloudClient.chatId) return;
    if (!isLoadingLibrary && workspaces.length > 0) return;
    restorePromptShownRef.current = true;

    (async () => {
      await cloudClient.fetchFiles();
      const latest = [...cloudClient.files]
        .filter(f => f.type === 'workspace_backup')
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
      if (!latest) return;

      const result = await swal({
        icon: 'question',
        title: `Found a cloud backup: "${latest.name}"`,
        text: `Last backed up ${new Date(latest.date).toLocaleString()}. Restore it to this device?`,
        showCancelButton: true,
        confirmButtonText: 'Restore',
      });
      if (!result.isConfirmed) return;
      const restored = await cloudClient.restoreWorkspaceFromCloud(latest);
      if (restored) {
        handleImportWorkspace(restored);
        swalToast({ icon: 'success', title: `"${restored.name}" restored from Telecloud` });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudClient.isConnected, cloudClient.chatId, isLoadingLibrary]);

  // Once per session, nudge the user if it's been 7+ days since their last
  // successful Telecloud backup.
  const backupReminderShownRef = useRef(false);
  useEffect(() => {
    if (backupReminderShownRef.current) return;
    backupReminderShownRef.current = true;
    const lastBackupAt = Number(localStorage.getItem('tg_last_backup_at') || 0);
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    if (!lastBackupAt || Date.now() - lastBackupAt > sevenDaysMs) {
      swalToast({
        icon: 'warning',
        title: 'Back up your library',
        text: "It's been over 7 days since your last Telecloud backup.",
        timer: 6000,
      });
    }
  }, []);

  const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId) || null;
  const mangas = activeWorkspace?.mangas || [];
  const activeManga = mangas.find(m => m.id === activeMangaId) || null;
  const activeVolume = activeManga?.volumes.find(v => v.id === activeVolumeId) || null;
  const activeChapter = activeVolume?.chapters.find(c => c.id === activeChapterId) || null;

  const resetToWorkspaceRoot = () => {
    setActiveWorkspaceId(null);
    setActiveMangaId(null);
    setActiveVolumeId(null);
    setActiveChapterId(null);
  };

  const resetToLibraryRoot = () => {
    setActiveMangaId(null);
    setActiveVolumeId(null);
    setActiveChapterId(null);
  };

  const updateActiveWorkspaceMangas = (updater: (mangas: MangaSeries[]) => MangaSeries[]) => {
    if (!activeWorkspace) return;
    setWorkspaces(prev => prev.map(w => w.id === activeWorkspace.id ? { ...w, mangas: updater(w.mangas) } : w));
  };

  const handleWorkspaceCoverUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    readImageFile(file, setNewWorkspaceCoverUrl);
  };

  const handleCoverUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    readImageFile(file, setNewSeriesCoverUrl);
  };

  const handleVolumeCoverUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    readImageFile(file, setNewVolumeCoverUrl);
  };

  const handleChapterCoverUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    readImageFile(file, setNewChapterCoverUrl);
  };

  const handleEditCoverUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    readImageFile(file, setEditCoverUrl);
  };

  const openEditWorkspace = (workspace: Workspace) => {
    setEditTarget({ level: 'workspace', id: workspace.id });
    setEditName(workspace.name);
    setEditDesc(workspace.description);
    setEditCoverUrl(workspace.coverUrl);
  };
  const openEditManga = (manga: MangaSeries) => {
    setEditTarget({ level: 'manga', id: manga.id });
    setEditName(manga.title);
    setEditDesc(manga.description);
    setEditCoverUrl(manga.coverUrl);
    setEditType(manga.type);
  };
  const openEditVolume = (volume: Volume) => {
    setEditTarget({ level: 'volume', id: volume.id });
    setEditName(volume.name);
    setEditDesc('');
    setEditCoverUrl(volume.coverUrl);
  };
  const openEditChapter = (chapter: Chapter) => {
    setEditTarget({ level: 'chapter', id: chapter.id });
    setEditName(chapter.name);
    setEditDesc('');
    setEditCoverUrl(chapter.coverUrl);
  };
  const closeEditModal = () => setEditTarget(null);

  const handleSaveEdit = () => {
    if (!editTarget) return;
    if (!editName.trim()) {
      swal({ icon: 'error', title: 'Name Required', text: 'Please enter a name to continue.' });
      return;
    }
    const trimmedName = editName.trim();
    const trimmedDesc = editDesc.trim();
    switch (editTarget.level) {
      case 'workspace':
        setWorkspaces(prev => prev.map(w => w.id === editTarget.id ? { ...w, name: trimmedName, description: trimmedDesc, coverUrl: editCoverUrl } : w));
        break;
      case 'manga':
        updateActiveWorkspaceMangas(prev => prev.map(m => m.id === editTarget.id ? { ...m, title: trimmedName, description: trimmedDesc, coverUrl: editCoverUrl, type: editType } : m));
        break;
      case 'volume':
        if (!activeManga) break;
        updateActiveWorkspaceMangas(prev => prev.map(m => m.id !== activeManga.id ? m : {
          ...m, volumes: m.volumes.map(v => v.id === editTarget.id ? { ...v, name: trimmedName, coverUrl: editCoverUrl } : v),
        }));
        break;
      case 'chapter':
        if (!activeManga || !activeVolume) break;
        updateActiveWorkspaceMangas(prev => prev.map(m => m.id !== activeManga.id ? m : {
          ...m, volumes: m.volumes.map(v => v.id !== activeVolume.id ? v : {
            ...v, chapters: v.chapters.map(c => c.id === editTarget.id ? { ...c, name: trimmedName, coverUrl: editCoverUrl } : c),
          }),
        }));
        break;
    }
    closeEditModal();
    swalToast({ icon: 'success', title: 'Info updated' });
  };

  const handleImportWorkspace = (workspace: Workspace) => {
    setWorkspaces(prev => [...prev, workspace]);
  };

  const handleCreateWorkspace = () => {
    if (!newWorkspaceName.trim()) {
      swal({ icon: 'error', title: 'Name Required', text: 'Please enter a name for your workspace to continue.' });
      return;
    }
    const newWorkspace: Workspace = {
      id: genId('workspace'),
      name: newWorkspaceName.trim(),
      description: newWorkspaceDesc.trim(),
      coverUrl: newWorkspaceCoverUrl,
      mangas: [],
      tags: [],
    };
    setWorkspaces(prev => [...prev, newWorkspace]);
    setShowCreateWorkspaceModal(false);
    setNewWorkspaceName('');
    setNewWorkspaceDesc('');
    setNewWorkspaceCoverUrl('');
    setActiveWorkspaceId(newWorkspace.id);
    swalToast({ icon: 'success', title: 'Workspace created!' });
  };

  const handleCreateSeries = () => {
    if (!newSeriesTitle.trim()) {
      swal({ icon: 'error', title: 'Title Required', text: 'Please enter a title for your series to continue.' });
      return;
    }
    const newManga: MangaSeries = {
      id: genId('manga'),
      title: newSeriesTitle.trim(),
      type: newSeriesType,
      coverUrl: newSeriesCoverUrl,
      description: newSeriesDesc.trim(),
      volumes: [],
    };
    updateActiveWorkspaceMangas(prev => [...prev, newManga]);
    setShowCreateSeriesModal(false);
    setNewSeriesTitle('');
    setNewSeriesDesc('');
    setNewSeriesCoverUrl('');
    setNewSeriesType('manga');
    swalToast({ icon: 'success', title: 'Series added to your library!' });
  };

  const handleCreateVolume = () => {
    if (!activeManga) return;
    if (!newVolumeName.trim()) {
      swal({ icon: 'error', title: 'Name Required', text: 'Please enter a name for this volume.' });
      return;
    }
    const newVolume: Volume = { id: genId('volume'), name: newVolumeName.trim(), coverUrl: newVolumeCoverUrl, chapters: [] };
    updateActiveWorkspaceMangas(prev => prev.map(m => m.id === activeManga.id ? { ...m, volumes: [...m.volumes, newVolume] } : m));
    setActiveVolumeId(newVolume.id);
    setShowCreateVolumeModal(false);
    setNewVolumeName('');
    setNewVolumeCoverUrl('');
  };

  const handleCreateChapter = () => {
    if (!activeManga || !activeVolume) return;
    if (!newChapterName.trim()) {
      swal({ icon: 'error', title: 'Name Required', text: 'Please enter a name for this chapter.' });
      return;
    }
    const newChapter: Chapter = { id: genId('chapter'), name: newChapterName.trim(), coverUrl: newChapterCoverUrl, pages: [] };
    updateActiveWorkspaceMangas(prev => prev.map(m => {
      if (m.id !== activeManga.id) return m;
      return { ...m, volumes: m.volumes.map(v => v.id === activeVolume.id ? { ...v, chapters: [...v.chapters, newChapter] } : v) };
    }));
    setActiveChapterId(newChapter.id);
    setShowCreateChapterModal(false);
    setNewChapterName('');
    setNewChapterCoverUrl('');
  };

  const handleCreatePress = () => {
    if (!activeWorkspace) {
      setShowCreateWorkspaceModal(true);
    } else if (!activeManga) {
      setShowCreateSeriesModal(true);
    } else if (!activeVolume) {
      setShowCreateVolumeModal(true);
    } else {
      setShowCreateChapterModal(true);
    }
  };

  const handleDeleteWorkspace = async (workspace: Workspace) => {
    const result = await swal({
      icon: 'warning',
      title: 'Delete this workspace?',
      text: `This will permanently remove "${workspace.name}" and everything inside it.`,
      showCancelButton: true,
      confirmButtonText: 'Delete Workspace',
      confirmButtonColor: '#FF3B30',
    });
    if (!result.isConfirmed) return;
    setWorkspaces(prev => prev.filter(w => w.id !== workspace.id));
    if (activeWorkspaceId === workspace.id) resetToWorkspaceRoot();
  };

  const handleExportWorkspace = async (workspace: Workspace) => {
    try {
      const blob = await exportWorkspaceToMsp(workspace);
      downloadMsp(blob, workspace.name);
    } catch (err) {
      console.error(err);
      swal({ icon: 'error', title: 'Export Failed', text: err instanceof Error ? err.message : 'Could not export this project.' });
    }
  };

  const handleDownloadAllWorkspaces = async () => {
    if (workspaces.length === 0) {
      swal({ icon: 'info', title: 'Nothing to back up', text: 'Your library is empty.' });
      return;
    }
    setIsDownloadingAllBackup(true);
    try {
      const blob = await exportAllWorkspacesToZip(workspaces);
      downloadFullBackup(blob);
      swalToast({ icon: 'success', title: 'Backup downloaded' });
    } catch (err) {
      console.error(err);
      swal({ icon: 'error', title: 'Backup Failed', text: err instanceof Error ? err.message : 'Could not build the full backup.' });
    } finally {
      setIsDownloadingAllBackup(false);
    }
  };

  const handleBackupAllToCloud = async () => {
    if (workspaces.length === 0) {
      swal({ icon: 'info', title: 'Nothing to back up', text: 'Your library is empty.' });
      return;
    }
    if (!cloudClient.isConnected) {
      setPendingBackupAll(true);
      setShowCloudConnectModal(true);
      return;
    }
    setIsBackingUpAll(true);
    try {
      for (const workspace of workspaces) {
        await cloudClient.uploadWorkspaceBackup(workspace, { notes: 'Full library backup', tags: ['full-backup', ...(workspace.tags ?? [])], folderId: null, scope: 'workspace' });
      }
      swalToast({ icon: 'success', title: `Backed up ${workspaces.length} workspace${workspaces.length === 1 ? '' : 's'} to Telegram` });
    } catch {
      // uploadWorkspaceBackup already surfaces its own error toast
    } finally {
      setIsBackingUpAll(false);
    }
  };

  const handleImportMspFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { workspace, studioDataByChapterId } = await importMspFile(file);
      const imported = { ...workspace, id: genId('workspace') };
      setWorkspaces(prev => [...prev, imported]);
      await saveImportedStudioData(studioDataByChapterId);
      swalToast({ icon: 'success', title: `Imported "${imported.name}"` });
    } catch (err) {
      console.error(err);
      swal({ icon: 'error', title: 'Import Failed', text: err instanceof Error ? err.message : 'That file could not be imported.' });
    }
  };

  const handleImportZipFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setZipProgress({ label: `Rendering "${file.name}" locally...`, current: 0, total: 1 });
    try {
      const imported = await importWorkspaceFromZip(file, (current, total) => {
        setZipProgress({ label: `Rendering "${file.name}" locally...`, current, total });
      });
      setWorkspaces(prev => [...prev, imported]);
      swalToast({ icon: 'success', title: `Imported "${imported.name}"` });
    } catch (err) {
      console.error(err);
      swal({ icon: 'error', title: 'Import Failed', text: err instanceof Error ? err.message : 'That ZIP could not be imported.' });
    } finally {
      setZipProgress(null);
    }
  };

  const handleDownloadWorkspaceZip = async (workspace: Workspace) => {
    setZipProgress({ label: `Packing "${workspace.name}"...`, current: 0, total: 1 });
    try {
      const blob = await exportWorkspaceToZip(workspace, (current, total) => {
        setZipProgress({ label: `Packing "${workspace.name}"...`, current, total });
      });
      downloadZip(blob, workspace.name);
    } catch (err) {
      console.error(err);
      swal({ icon: 'error', title: 'Download Failed', text: err instanceof Error ? err.message : 'Could not build the ZIP for this workspace.' });
    } finally {
      setZipProgress(null);
    }
  };

  const handleDownloadMangaZip = async (manga: MangaSeries) => {
    setZipProgress({ label: `Packing "${manga.title}"...`, current: 0, total: 1 });
    try {
      const blob = await exportMangaToZip(manga, (current, total) => {
        setZipProgress({ label: `Packing "${manga.title}"...`, current, total });
      });
      downloadZip(blob, manga.title);
    } catch (err) {
      console.error(err);
      swal({ icon: 'error', title: 'Download Failed', text: err instanceof Error ? err.message : 'Could not build the ZIP for this series.' });
    } finally {
      setZipProgress(null);
    }
  };

  const handleDownloadVolumeZip = async (volume: Volume) => {
    setZipProgress({ label: `Packing "${volume.name}"...`, current: 0, total: 1 });
    try {
      const blob = await exportVolumeToZip(volume, (current, total) => {
        setZipProgress({ label: `Packing "${volume.name}"...`, current, total });
      });
      downloadZip(blob, volume.name);
    } catch (err) {
      console.error(err);
      swal({ icon: 'error', title: 'Download Failed', text: err instanceof Error ? err.message : 'Could not build the ZIP for this volume.' });
    } finally {
      setZipProgress(null);
    }
  };

  const handleDownloadChapterZip = async (chapter: Chapter) => {
    setZipProgress({ label: `Packing "${chapter.name}"...`, current: 0, total: 1 });
    try {
      const blob = await exportChapterToZip(chapter, (current, total) => {
        setZipProgress({ label: `Packing "${chapter.name}"...`, current, total });
      });
      downloadZip(blob, chapter.name);
    } catch (err) {
      console.error(err);
      swal({ icon: 'error', title: 'Download Failed', text: err instanceof Error ? err.message : 'Could not build the ZIP for this chapter.' });
    } finally {
      setZipProgress(null);
    }
  };

  // Sub-tree cloud backups are wrapped in a synthetic single-branch Workspace so
  // uploadWorkspaceBackup/restoreWorkspaceFromCloud need no scope-specific logic —
  // `scope` metadata just controls the badge/label shown in Cloud Storage.
  const wrapMangaBackup = (manga: MangaSeries): Workspace => ({
    id: genId('workspace'), name: manga.title, description: manga.description, coverUrl: manga.coverUrl, tags: [], mangas: [manga],
  });
  const wrapVolumeBackup = (manga: MangaSeries, volume: Volume): Workspace => ({
    id: genId('workspace'), name: volume.name, description: '', coverUrl: volume.coverUrl, tags: [],
    mangas: [{ ...manga, volumes: [volume] }],
  });
  const wrapChapterBackup = (manga: MangaSeries, volume: Volume, chapter: Chapter): Workspace => ({
    id: genId('workspace'), name: chapter.name, description: '', coverUrl: chapter.coverUrl, tags: [],
    mangas: [{ ...manga, volumes: [{ ...volume, chapters: [chapter] }] }],
  });

  const uploadNodeToCloud = async (workspace: Workspace, scope: 'workspace' | 'series' | 'volume' | 'chapter') => {
    if (!cloudClient.isConnected) {
      setPendingCloudUpload({ workspace, scope });
      setShowCloudConnectModal(true);
      return;
    }
    try {
      await cloudClient.uploadWorkspaceBackup(workspace, { notes: '', tags: workspace.tags ?? [], folderId: null, scope });
    } catch {
      // uploadWorkspaceBackup already surfaces its own error toast
    }
  };

  const handleUploadWorkspaceToCloud = (workspace: Workspace) => uploadNodeToCloud(workspace, 'workspace');
  const handleUploadMangaToCloud = (manga: MangaSeries) => uploadNodeToCloud(wrapMangaBackup(manga), 'series');
  const handleUploadVolumeToCloud = (manga: MangaSeries, volume: Volume) => uploadNodeToCloud(wrapVolumeBackup(manga, volume), 'volume');
  const handleUploadChapterToCloud = (manga: MangaSeries, volume: Volume, chapter: Chapter) => uploadNodeToCloud(wrapChapterBackup(manga, volume, chapter), 'chapter');

  // Once the user connects from the Library-triggered modal, retry whichever upload was pending.
  useEffect(() => {
    if (!cloudClient.isConnected || !showCloudConnectModal) return;
    if (pendingCloudUpload) {
      const { workspace, scope } = pendingCloudUpload;
      setShowCloudConnectModal(false);
      setPendingCloudUpload(null);
      uploadNodeToCloud(workspace, scope);
    } else if (pendingBackupAll) {
      setShowCloudConnectModal(false);
      setPendingBackupAll(false);
      handleBackupAllToCloud();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudClient.isConnected]);

  const handleAddTag = (workspaceId: string, tag: string) => {
    const clean = tag.trim();
    if (!clean) return;
    setWorkspaces(prev => prev.map(w => {
      if (w.id !== workspaceId) return w;
      if (w.tags.some(t => t.toLowerCase() === clean.toLowerCase())) return w;
      return { ...w, tags: [...w.tags, clean] };
    }));
    setNewTagValue('');
  };

  const handleRemoveTag = (workspaceId: string, tag: string) => {
    setWorkspaces(prev => prev.map(w => w.id === workspaceId ? { ...w, tags: w.tags.filter(t => t !== tag) } : w));
  };

  const handleDeleteManga = async (manga: MangaSeries) => {
    const result = await swal({
      icon: 'warning',
      title: 'Delete this series?',
      text: `This will permanently remove "${manga.title}" and all of its volumes and chapters.`,
      showCancelButton: true,
      confirmButtonText: 'Delete Series',
      confirmButtonColor: '#FF3B30',
    });
    if (!result.isConfirmed) return;
    updateActiveWorkspaceMangas(prev => prev.filter(m => m.id !== manga.id));
    if (activeMangaId === manga.id) resetToLibraryRoot();
  };

  const handleDeleteVolume = async (volume: Volume) => {
    if (!activeManga) return;
    const result = await swal({
      icon: 'warning',
      title: 'Delete this volume?',
      text: `This will permanently remove "${volume.name}" and all of its chapters.`,
      showCancelButton: true,
      confirmButtonText: 'Delete Volume',
      confirmButtonColor: '#FF3B30',
    });
    if (!result.isConfirmed) return;
    updateActiveWorkspaceMangas(prev => prev.map(m => m.id === activeManga.id ? { ...m, volumes: m.volumes.filter(v => v.id !== volume.id) } : m));
    if (activeVolumeId === volume.id) { setActiveVolumeId(null); setActiveChapterId(null); }
  };

  const handleDeleteChapter = async (chapter: Chapter) => {
    if (!activeManga || !activeVolume) return;
    const result = await swal({
      icon: 'warning',
      title: 'Delete this chapter?',
      text: `This will permanently remove "${chapter.name}" and all of its pages.`,
      showCancelButton: true,
      confirmButtonText: 'Delete Chapter',
      confirmButtonColor: '#FF3B30',
    });
    if (!result.isConfirmed) return;
    updateActiveWorkspaceMangas(prev => prev.map(m => {
      if (m.id !== activeManga.id) return m;
      return { ...m, volumes: m.volumes.map(v => v.id === activeVolume.id ? { ...v, chapters: v.chapters.filter(c => c.id !== chapter.id) } : v) };
    }));
    if (activeChapterId === chapter.id) setActiveChapterId(null);
  };

  const handleChapterPagesChange = (pages: Page[]) => {
    if (!activeManga || !activeVolume || !activeChapter) return;
    updateActiveWorkspaceMangas(prev => prev.map(m => {
      if (m.id !== activeManga.id) return m;
      return {
        ...m,
        volumes: m.volumes.map(v => {
          if (v.id !== activeVolume.id) return v;
          return {
            ...v,
            chapters: v.chapters.map(c => c.id === activeChapter.id ? { ...c, pages } : c),
          };
        }),
      };
    }));
  };

  return (
    <div className="min-h-screen app-shell-bg dynamic-bg text-ink">
      {showSplash && <SplashScreen onFinish={() => setShowSplash(false)} />}
      {!showSplash && <AuthGate>

      <div className="fog-orbs" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>

      <TopBar />

      {studioBuilding && (
        <StudioBuildTransition
          onDone={() => {
            if (pendingChapterId) setActiveChapterId(pendingChapterId);
            setPendingChapterId(null);
            setStudioBuilding(false);
          }}
        />
      )}

      <SidebarRail activeTab={activeNavigationTab} onTabChange={setActiveNavigationTab} onCreatePress={handleCreatePress} />

      <div className="flex flex-1 lg:pl-20">
        <main key={activeNavigationTab} className="animate-view-fade flex-1 min-w-0 px-4 sm:px-6 lg:px-10 py-6 sm:py-8 pb-28 lg:pb-10 max-w-6xl mx-auto w-full">
          {activeNavigationTab === 'settings' && (
            <SettingsPanel
              onShowPrivacy={() => setShowPrivacyModal(true)}
              onShowTerms={() => setShowTermsModal(true)}
              workspaceCount={workspaces.length}
              isCloudConnected={cloudClient.isConnected}
              onDownloadAllBackup={handleDownloadAllWorkspaces}
              isDownloadingAllBackup={isDownloadingAllBackup}
              onBackupAllToCloud={handleBackupAllToCloud}
              isBackingUpAll={isBackingUpAll}
            />
          )}

          {activeNavigationTab === 'cloud' && (
            <div className="space-y-4">
              <AdSlot placement="cloud-top" />
              <CloudStorage
                cc={cloudClient}
                workspaces={workspaces}
                onImportWorkspace={handleImportWorkspace}
                automationEngine={automationEngine}
              />
            </div>
          )}

          {activeNavigationTab === 'teams' && <TeamsPanel cc={cloudClient} pendingJoinToken={pendingJoinToken} onConsumedJoinToken={() => setPendingJoinToken(null)} />}

          {activeNavigationTab === 'text-editor' && (
            <div className="fixed inset-0 lg:relative lg:inset-auto flex flex-col bg-[#0b0b0d] lg:rounded-2xl lg:overflow-hidden lg:border lg:border-hairline lg:h-[calc(100vh-8.5rem)] z-30">
              <TextEditorPage onSendToTyper={(script) => setPendingTyperScript(script)} />
            </div>
          )}

          {activeNavigationTab === 'library' && (
            <div className="space-y-5">
              {!activeChapter && <LibraryAnnouncementBanner />}
              {!activeChapter && <AdSlot placement="library-top" />}

              {/* Breadcrumb */}
              {(activeWorkspace) && (
                <div className="flex items-center gap-2 text-sm flex-wrap">
                  <button onClick={resetToWorkspaceRoot} className="text-ink-muted hover:text-accent transition-colors">Workspaces</button>
                  <span className="text-ink-faint">/</span>
                  <button onClick={resetToLibraryRoot} className={`transition-colors ${!activeManga ? 'text-ink font-semibold' : 'text-ink-muted hover:text-accent'}`}>{activeWorkspace.name}</button>
                  {activeManga && (
                    <>
                      <span className="text-ink-faint">/</span>
                      <button onClick={() => { setActiveVolumeId(null); setActiveChapterId(null); }} className={`transition-colors ${!activeVolume ? 'text-ink font-semibold' : 'text-ink-muted hover:text-accent'}`}>{activeManga.title}</button>
                    </>
                  )}
                  {activeVolume && (
                    <>
                      <span className="text-ink-faint">/</span>
                      <button onClick={() => setActiveChapterId(null)} className={`transition-colors ${!activeChapter ? 'text-ink font-semibold' : 'text-ink-muted hover:text-accent'}`}>{activeVolume.name}</button>
                    </>
                  )}
                  {activeChapter && (
                    <>
                      <span className="text-ink-faint">/</span>
                      <span className="text-ink font-semibold">{activeChapter.name}</span>
                    </>
                  )}
                </div>
              )}

              {/* Chapter view: straight into the Studio, even with zero pages — page upload/pairing
                  now lives inside the Studio itself (StudioPagesPanel's "Add Pages" modal). */}
              {activeWorkspace && activeChapter && activeVolume && activeManga && (
                <Studio
                  chapterId={activeChapter.id}
                  chapterName={activeChapter.name}
                  pages={activeChapter.pages}
                  onBack={resetToLibraryRoot}
                  pendingTyperScript={pendingTyperScript}
                  onConsumePendingTyperScript={() => setPendingTyperScript(null)}
                  onPagesChange={handleChapterPagesChange}
                />
              )}

              {/* Chapter list within volume */}
              {activeWorkspace && activeVolume && !activeChapter && activeManga && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-display font-semibold text-ink">{activeVolume.name}</h2>
                    <Button size="sm" onClick={() => setShowCreateChapterModal(true)}><Plus size={14} /> Add Chapter</Button>
                  </div>
                  {activeVolume.chapters.length === 0 && (
                    <GlassCard className="p-8 flex flex-col items-center text-center gap-3">
                      <FileStack className="text-ink-faint" size={26} />
                      <p className="text-sm text-ink-muted">No chapters yet. Create one to start building this volume.</p>
                      <Button size="sm" onClick={() => setShowCreateChapterModal(true)}><Plus size={14} /> Add Chapter</Button>
                    </GlassCard>
                  )}
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {interleaveWithAds(activeVolume.chapters, chap => (
                      <button
                        key={chap.id}
                        onClick={() => { setPendingChapterId(chap.id); setStudioBuilding(true); }}
                        className="stagger-item group relative text-left overflow-hidden rounded-2xl"
                      >
                        <GlassCard className="overflow-hidden flex flex-col h-full transition-transform group-hover:-translate-y-0.5">
                          <div className="aspect-[3/4] bg-gradient-to-br from-accent/25 to-accent/5 flex items-center justify-center overflow-hidden">
                            {chap.coverUrl ? (
                              <img src={chap.coverUrl} alt={chap.name} className="w-full h-full object-cover" />
                            ) : (
                              <FileStack className="text-accent/60" size={28} />
                            )}
                          </div>
                          <div className="p-3">
                            <p className="text-sm font-semibold text-ink truncate">{chap.name}</p>
                            <p className="text-[11px] text-ink-faint">{chap.pages.length} page(s)</p>
                          </div>
                        </GlassCard>
                        <div className="absolute top-2 right-2 flex items-center gap-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); openEditChapter(chap); }}
                            className="p-1.5 rounded-lg bg-black/40 text-white hover:bg-black/60"
                            aria-label="Edit chapter info"
                            title="Edit name/cover"
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDownloadChapterZip(chap); }}
                            className="p-1.5 rounded-lg bg-black/40 text-white hover:bg-black/60"
                            aria-label="Download chapter as ZIP"
                            title="Download as ZIP"
                          >
                            <Download size={12} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleUploadChapterToCloud(activeManga, activeVolume, chap); }}
                            className="p-1.5 rounded-lg bg-black/40 text-white hover:bg-black/60"
                            aria-label="Upload chapter to Telecloud"
                            title="Upload to Telecloud"
                          >
                            <UploadCloud size={12} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteChapter(chap); }}
                            className="p-1.5 rounded-lg bg-black/40 text-white hover:bg-black/60"
                            aria-label="Delete chapter"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </button>
                    ), 'library-chapters')}
                  </div>
                </div>
              )}

              {/* Volume list within manga */}
              {activeWorkspace && activeManga && !activeVolume && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-display font-semibold text-ink">{activeManga.title}</h2>
                    <Button size="sm" onClick={() => setShowCreateVolumeModal(true)}><Plus size={14} /> Add Volume</Button>
                  </div>
                  {activeManga.volumes.length === 0 && (
                    <GlassCard className="p-8 flex flex-col items-center text-center gap-3">
                      <Layers className="text-ink-faint" size={26} />
                      <p className="text-sm text-ink-muted">No volumes yet. Create one to start organizing this series.</p>
                      <Button size="sm" onClick={() => setShowCreateVolumeModal(true)}><Plus size={14} /> Add Volume</Button>
                    </GlassCard>
                  )}
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {interleaveWithAds(activeManga.volumes, vol => (
                      <button key={vol.id} onClick={() => setActiveVolumeId(vol.id)} className="stagger-item group relative text-left overflow-hidden rounded-2xl">
                        <GlassCard className="overflow-hidden flex flex-col h-full transition-transform group-hover:-translate-y-0.5">
                          <div className="aspect-[3/4] bg-gradient-to-br from-accent/25 to-accent/5 flex items-center justify-center overflow-hidden">
                            {vol.coverUrl ? (
                              <img src={vol.coverUrl} alt={vol.name} className="w-full h-full object-cover" />
                            ) : (
                              <Layers className="text-accent/60" size={28} />
                            )}
                          </div>
                          <div className="p-3">
                            <p className="text-sm font-semibold text-ink truncate">{vol.name}</p>
                            <p className="text-[11px] text-ink-faint">{vol.chapters.length} chapter(s)</p>
                          </div>
                        </GlassCard>
                        <div className="absolute top-2 right-2 flex items-center gap-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); openEditVolume(vol); }}
                            className="p-1.5 rounded-lg bg-black/40 text-white hover:bg-black/60"
                            aria-label="Edit volume info"
                            title="Edit name/cover"
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDownloadVolumeZip(vol); }}
                            className="p-1.5 rounded-lg bg-black/40 text-white hover:bg-black/60"
                            aria-label="Download volume as ZIP"
                            title="Download as ZIP"
                          >
                            <Download size={12} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleUploadVolumeToCloud(activeManga, vol); }}
                            className="p-1.5 rounded-lg bg-black/40 text-white hover:bg-black/60"
                            aria-label="Upload volume to Telecloud"
                            title="Upload to Telecloud"
                          >
                            <UploadCloud size={12} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteVolume(vol); }}
                            className="p-1.5 rounded-lg bg-black/40 text-white hover:bg-black/60"
                            aria-label="Delete volume"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </button>
                    ), 'library-volumes')}
                  </div>
                </div>
              )}

              {/* Series list within workspace */}
              {activeWorkspace && !activeManga && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-display font-semibold text-ink">{activeWorkspace.name}</h2>
                    <Button size="sm" onClick={() => setShowCreateSeriesModal(true)}><Plus size={14} /> New Series</Button>
                  </div>
                  {mangas.length === 0 && (
                    <GlassCard className="p-10 flex flex-col items-center text-center gap-3">
                      <BookOpen className="text-ink-faint" size={30} />
                      <p className="text-sm text-ink-muted max-w-sm">This workspace is empty. Add your first manga or manhwa series to get started.</p>
                      <Button onClick={() => setShowCreateSeriesModal(true)}><Plus size={14} /> Create Series</Button>
                    </GlassCard>
                  )}
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                    {interleaveWithAds(mangas, manga => (
                      <button key={manga.id} onClick={() => setActiveMangaId(manga.id)} className="stagger-item group relative text-left overflow-hidden rounded-2xl">
                        <GlassCard className="overflow-hidden flex flex-col h-full transition-transform group-hover:-translate-y-0.5">
                          <div className="aspect-[3/4] bg-gradient-to-br from-accent/25 to-accent/5 flex items-center justify-center overflow-hidden">
                            {manga.coverUrl ? (
                              <img src={manga.coverUrl} alt={manga.title} className="w-full h-full object-cover" />
                            ) : (
                              <BookOpen className="text-accent/60" size={32} />
                            )}
                          </div>
                          <div className="p-3">
                            <p className="text-sm font-semibold text-ink truncate">{manga.title}</p>
                            <p className="text-[11px] text-ink-faint uppercase tracking-wide">{manga.type} · {manga.volumes.length} vol(s)</p>
                          </div>
                        </GlassCard>
                        <div className="absolute top-2 right-2 flex items-center gap-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); openEditManga(manga); }}
                            className="p-1.5 rounded-lg bg-black/40 text-white hover:bg-black/60"
                            aria-label="Edit series info"
                            title="Edit name/cover"
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDownloadMangaZip(manga); }}
                            className="p-1.5 rounded-lg bg-black/40 text-white hover:bg-black/60"
                            aria-label="Download series as ZIP"
                            title="Download as ZIP"
                          >
                            <Download size={12} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleUploadMangaToCloud(manga); }}
                            className="p-1.5 rounded-lg bg-black/40 text-white hover:bg-black/60"
                            aria-label="Upload series to Telecloud"
                            title="Upload to Telecloud"
                          >
                            <UploadCloud size={12} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteManga(manga); }}
                            className="p-1.5 rounded-lg bg-black/40 text-white hover:bg-black/60"
                            aria-label="Delete series"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </button>
                    ), 'library-series')}
                  </div>
                </div>
              )}

              {/* Workspace list (root) */}
              {!activeWorkspace && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-display font-semibold text-ink">My Workspaces</h2>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="secondary" onClick={() => mspImportInputRef.current?.click()}>
                        <Upload size={14} /> Import Project
                      </Button>
                      <input ref={mspImportInputRef} type="file" accept=".msp" className="hidden" onChange={handleImportMspFile} />
                      <Button size="sm" variant="secondary" onClick={() => zipImportInputRef.current?.click()}>
                        <PackagePlus size={14} /> Import ZIP
                      </Button>
                      <input ref={zipImportInputRef} type="file" accept=".zip" className="hidden" onChange={handleImportZipFile} />
                    </div>
                  </div>
                  {isLoadingLibrary && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                      {Array.from({ length: 8 }).map((_, i) => (
                        <SkeletonCard key={i} className="aspect-[3/4]" />
                      ))}
                    </div>
                  )}
                  {!isLoadingLibrary && workspaces.length === 0 && (
                    <GlassCard className="p-10 flex flex-col items-center text-center gap-3">
                      <Boxes className="text-ink-faint" size={30} />
                      <p className="text-sm text-ink-muted max-w-sm">Tap the + button below to create a workspace and start organizing your manga and manhwa libraries.</p>
                    </GlassCard>
                  )}
                  {!isLoadingLibrary && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                    {interleaveWithAds(workspaces, ws => (
                      <button key={ws.id} onClick={() => setActiveWorkspaceId(ws.id)} className="stagger-item group relative text-left overflow-hidden rounded-2xl">
                        <GlassCard className="overflow-hidden flex flex-col h-full transition-transform group-hover:-translate-y-0.5">
                          <div className="aspect-[3/4] bg-gradient-to-br from-accent/25 to-accent/5 flex items-center justify-center overflow-hidden">
                            {ws.coverUrl ? (
                              <img src={ws.coverUrl} alt={ws.name} className="w-full h-full object-cover" />
                            ) : (
                              <Boxes className="text-accent/60" size={32} />
                            )}
                          </div>
                          <div className="p-3 space-y-1.5">
                            <p className="text-sm font-semibold text-ink truncate">{ws.name}</p>
                            <p className="text-[11px] text-ink-faint uppercase tracking-wide">{ws.mangas.length} series</p>
                            {ws.description && (
                              <p className="text-[11px] text-ink-muted line-clamp-2">{ws.description}</p>
                            )}
                            {ws.tags.length > 0 && (
                              <div className="flex flex-wrap gap-1 pt-0.5">
                                {ws.tags.map(tag => (
                                  <span key={tag} className="px-1.5 py-0.5 rounded-full bg-accent/10 text-accent text-[10px] font-medium">{tag}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        </GlassCard>
                        <div className="absolute top-2 right-2 flex items-center gap-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); openEditWorkspace(ws); }}
                            className="p-1.5 rounded-lg bg-black/40 text-white hover:bg-black/60"
                            aria-label="Edit workspace info"
                            title="Edit name/cover"
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDownloadWorkspaceZip(ws); }}
                            className="p-1.5 rounded-lg bg-black/40 text-white hover:bg-black/60"
                            aria-label="Download workspace as ZIP"
                            title="Download as ZIP (folders)"
                          >
                            <Download size={12} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleUploadWorkspaceToCloud(ws); }}
                            className="p-1.5 rounded-lg bg-black/40 text-white hover:bg-black/60"
                            aria-label="Upload to Telecloud"
                            title="Upload to Telecloud"
                          >
                            <UploadCloud size={12} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setTagEditorWorkspaceId(ws.id); }}
                            className="p-1.5 rounded-lg bg-black/40 text-white hover:bg-black/60"
                            aria-label="Edit tags"
                            title="Edit tags"
                          >
                            <Tag size={12} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleExportWorkspace(ws); }}
                            className="p-1.5 rounded-lg bg-black/40 text-white hover:bg-black/60"
                            aria-label="Export project (.msp)"
                            title="Export project (.msp)"
                          >
                            <FileArchive size={12} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteWorkspace(ws); }}
                            className="p-1.5 rounded-lg bg-black/40 text-white hover:bg-black/60"
                            aria-label="Delete workspace"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </button>
                    ), 'library-workspaces')}
                  </div>
                  )}
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      <BottomTabBar activeTab={activeNavigationTab} onTabChange={setActiveNavigationTab} onCreatePress={handleCreatePress} />

      {/* Edit library card info (rename / re-cover a workspace, series, volume or chapter) */}
      <Modal
        open={!!editTarget}
        onClose={closeEditModal}
        title={editTarget ? `Edit ${editTarget.level === 'manga' ? 'Series' : editTarget.level.charAt(0).toUpperCase() + editTarget.level.slice(1)} Info` : ''}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={closeEditModal}>Cancel</Button>
            <Button onClick={handleSaveEdit}><Sparkles size={14} /> Save Changes</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => editCoverInputRef.current?.click()}
              className="w-20 h-28 rounded-xl border border-dashed border-hairline bg-ink/5 flex items-center justify-center overflow-hidden shrink-0 hover:border-accent transition-colors"
            >
              {editCoverUrl ? (
                <img src={editCoverUrl} alt="Cover" className="w-full h-full object-cover" />
              ) : (
                <ImagePlus size={20} className="text-ink-faint" />
              )}
            </button>
            <input ref={editCoverInputRef} type="file" accept="image/*" className="hidden" onChange={handleEditCoverUpload} />
            <div className="flex-1 space-y-2">
              <Input placeholder="Name" value={editName} onChange={(e) => setEditName(e.target.value)} />
              {editTarget?.level === 'manga' && (
                <div className="grid grid-cols-2 gap-2">
                  {(['manga', 'manhwa'] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => setEditType(t)}
                      className={`py-2 rounded-xl border text-xs font-medium capitalize transition-colors ${editType === t ? 'bg-accent-soft border-accent text-accent' : 'bg-ink/5 border-hairline text-ink-muted'}`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          {(editTarget?.level === 'workspace' || editTarget?.level === 'manga') && (
            <Textarea placeholder="Short description (optional)" value={editDesc} onChange={(e) => setEditDesc(e.target.value)} className="h-20" />
          )}
        </div>
      </Modal>

      {/* ZIP build/download/import progress — shown while a folder-tree ZIP is being packed or rendered locally */}
      <Modal open={!!zipProgress} onClose={() => {}} dismissible={false} title="Working on your ZIP" size="sm">
        {zipProgress && (
          <div className="space-y-4">
            <p className="text-sm font-semibold text-ink truncate">{zipProgress.label}</p>
            <div className="w-full bg-ink/10 border border-hairline h-3 rounded-full overflow-hidden relative">
              <div
                className="absolute top-0 left-0 bg-accent h-full transition-all duration-300"
                style={{ width: `${zipProgress.total > 0 ? Math.round((zipProgress.current / zipProgress.total) * 100) : 0}%` }}
              />
              <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-white mix-blend-difference">
                {zipProgress.total > 0 ? Math.round((zipProgress.current / zipProgress.total) * 100) : 0}%
              </span>
            </div>
            <p className="text-xs text-ink-faint font-mono">{zipProgress.current} / {zipProgress.total}</p>
          </div>
        )}
      </Modal>

      {/* Create Workspace Modal */}
      <Modal
        open={showCreateWorkspaceModal}
        onClose={() => setShowCreateWorkspaceModal(false)}
        title="New Workspace"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowCreateWorkspaceModal(false)}>Cancel</Button>
            <Button onClick={handleCreateWorkspace}><Sparkles size={14} /> Create Workspace</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => workspaceCoverInputRef.current?.click()}
              className="w-20 h-28 rounded-xl border border-dashed border-hairline bg-ink/5 flex items-center justify-center overflow-hidden shrink-0 hover:border-accent transition-colors"
            >
              {newWorkspaceCoverUrl ? (
                <img src={newWorkspaceCoverUrl} alt="Cover" className="w-full h-full object-cover" />
              ) : (
                <ImagePlus size={20} className="text-ink-faint" />
              )}
            </button>
            <input ref={workspaceCoverInputRef} type="file" accept="image/*" className="hidden" onChange={handleWorkspaceCoverUpload} />
            <div className="flex-1 space-y-2">
              <Input placeholder="Workspace name" value={newWorkspaceName} onChange={(e) => setNewWorkspaceName(e.target.value)} />
            </div>
          </div>
          <Textarea placeholder="Short description (optional)" value={newWorkspaceDesc} onChange={(e) => setNewWorkspaceDesc(e.target.value)} className="h-20" />
        </div>
      </Modal>

      {/* Workspace Tag Editor Modal */}
      <Modal
        open={!!tagEditorWorkspaceId}
        onClose={() => { setTagEditorWorkspaceId(null); setNewTagValue(''); }}
        title="Edit Tags"
        footer={
          <div className="flex justify-end">
            <Button variant="secondary" onClick={() => { setTagEditorWorkspaceId(null); setNewTagValue(''); }}>Done</Button>
          </div>
        }
      >
        {(() => {
          const ws = workspaces.find(w => w.id === tagEditorWorkspaceId);
          if (!ws) return null;
          return (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-1.5">
                {ws.tags.length === 0 && <p className="text-sm text-ink-faint">No tags yet.</p>}
                {ws.tags.map(tag => (
                  <span key={tag} className="flex items-center gap-1 px-2 py-1 rounded-full bg-accent/10 text-accent text-xs font-medium">
                    {tag}
                    <button onClick={() => handleRemoveTag(ws.id, tag)} aria-label={`Remove tag ${tag}`} className="hover:text-danger">
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="New tag"
                  value={newTagValue}
                  onChange={(e) => setNewTagValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddTag(ws.id, newTagValue); } }}
                />
                <Button size="sm" onClick={() => handleAddTag(ws.id, newTagValue)}><Plus size={14} /> Add</Button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Cloud Connect Modal — shown when uploading to Telecloud from Library without an active session */}
      <Modal
        open={showCloudConnectModal}
        onClose={() => { setShowCloudConnectModal(false); setPendingCloudUpload(null); }}
        title="Connect to Telecloud"
      >
        <CloudConfig cc={cloudClient} />
      </Modal>

      {/* Create Series Modal */}
      <Modal
        open={showCreateSeriesModal}
        onClose={() => setShowCreateSeriesModal(false)}
        title="New Series"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowCreateSeriesModal(false)}>Cancel</Button>
            <Button onClick={handleCreateSeries}><Sparkles size={14} /> Create Series</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => coverFileInputRef.current?.click()}
              className="w-20 h-28 rounded-xl border border-dashed border-hairline bg-ink/5 flex items-center justify-center overflow-hidden shrink-0 hover:border-accent transition-colors"
            >
              {newSeriesCoverUrl ? (
                <img src={newSeriesCoverUrl} alt="Cover" className="w-full h-full object-cover" />
              ) : (
                <ImagePlus size={20} className="text-ink-faint" />
              )}
            </button>
            <input ref={coverFileInputRef} type="file" accept="image/*" className="hidden" onChange={handleCoverUpload} />
            <div className="flex-1 space-y-2">
              <Input placeholder="Series title" value={newSeriesTitle} onChange={(e) => setNewSeriesTitle(e.target.value)} />
              <div className="grid grid-cols-2 gap-2">
                {(['manga', 'manhwa'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setNewSeriesType(t)}
                    className={`py-2 rounded-xl border text-xs font-medium capitalize transition-colors ${newSeriesType === t ? 'bg-accent-soft border-accent text-accent' : 'bg-ink/5 border-hairline text-ink-muted'}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <Textarea placeholder="Short description (optional)" value={newSeriesDesc} onChange={(e) => setNewSeriesDesc(e.target.value)} className="h-20" />
        </div>
      </Modal>

      {/* Create Volume Modal */}
      <Modal
        open={showCreateVolumeModal}
        onClose={() => setShowCreateVolumeModal(false)}
        title="New Volume"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowCreateVolumeModal(false)}>Cancel</Button>
            <Button onClick={handleCreateVolume}><Sparkles size={14} /> Add Volume</Button>
          </div>
        }
      >
        <div className="flex items-center gap-4">
          <button
            onClick={() => volumeCoverInputRef.current?.click()}
            className="w-20 h-28 rounded-xl border border-dashed border-hairline bg-ink/5 flex items-center justify-center overflow-hidden shrink-0 hover:border-accent transition-colors"
          >
            {newVolumeCoverUrl ? (
              <img src={newVolumeCoverUrl} alt="Cover" className="w-full h-full object-cover" />
            ) : (
              <ImagePlus size={20} className="text-ink-faint" />
            )}
          </button>
          <input ref={volumeCoverInputRef} type="file" accept="image/*" className="hidden" onChange={handleVolumeCoverUpload} />
          <div className="flex-1">
            <Input placeholder="e.g. Volume 1" value={newVolumeName} onChange={(e) => setNewVolumeName(e.target.value)} />
          </div>
        </div>
      </Modal>

      {/* Create Chapter Modal */}
      <Modal
        open={showCreateChapterModal}
        onClose={() => setShowCreateChapterModal(false)}
        title="New Chapter"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowCreateChapterModal(false)}>Cancel</Button>
            <Button onClick={handleCreateChapter}><Sparkles size={14} /> Add Chapter</Button>
          </div>
        }
      >
        <div className="flex items-center gap-4">
          <button
            onClick={() => chapterCoverInputRef.current?.click()}
            className="w-20 h-28 rounded-xl border border-dashed border-hairline bg-ink/5 flex items-center justify-center overflow-hidden shrink-0 hover:border-accent transition-colors"
          >
            {newChapterCoverUrl ? (
              <img src={newChapterCoverUrl} alt="Cover" className="w-full h-full object-cover" />
            ) : (
              <ImagePlus size={20} className="text-ink-faint" />
            )}
          </button>
          <input ref={chapterCoverInputRef} type="file" accept="image/*" className="hidden" onChange={handleChapterCoverUpload} />
          <div className="flex-1">
            <Input placeholder="e.g. Chapter 1" value={newChapterName} onChange={(e) => setNewChapterName(e.target.value)} />
          </div>
        </div>
      </Modal>

      {/* Legal Modals */}
      <Modal open={showPrivacyModal} onClose={() => setShowPrivacyModal(false)} title="Privacy Policy" size="lg">
        <PrivacyPolicy />
      </Modal>
      <Modal open={showTermsModal} onClose={() => setShowTermsModal(false)} title="User Agreement" size="lg">
        <UserAgreement />
      </Modal>

      {/* Mounted globally so Telecloud upload/download/restore progress is visible
          from any tab (e.g. a Library "Upload to Telecloud" action), not only
          while the Cloud tab happens to be open. */}
      <CloudTransferModals cc={cloudClient} />
      <AppContextMenu />
      </AuthGate>}
    </div>
  );
}
