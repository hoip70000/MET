import { useCallback, useEffect, useRef, useState } from 'react';
import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { swal, swalToast } from './swalTheme';
import { genId } from './id';
import { migrateWorkspace } from './migrate';
import { loadTelegramCredentials, saveTelegramCredentials } from './telegramSync';
import { supabase } from './supabaseClient';
import type { Workspace } from '../types';

export type BackupScope = 'workspace' | 'series' | 'volume' | 'chapter';

export interface CloudFile {
  id: number;
  msg: any;
  type: 'workspace_backup' | 'team_file';
  scope: BackupScope;
  name: string;
  description: string;
  tags: string[];
  sender: string;
  folderId: number | null;
  coverMsgId: number;
  sizeBytes: number;
  date: string;
}

export interface CloudFolder {
  id: number;
  name: string;
  parentId: number | null;
  /** User ids allowed to upload into this folder. Empty = unrestricted. Admins always bypass. */
  members: string[];
}

export interface CloudFileComment {
  id: number;
  fileId: number;
  /** Legacy free-text Telegram display name — kept only as a fallback for comments posted before authorUserId existed. */
  author: string;
  /** Supabase auth user id of the commenter; resolved against team members/profiles for display. Null for legacy comments. */
  authorUserId: string | null;
  body: string;
  date: string;
}

function formatSize(bytes: number): string {
  if (!bytes) return 'unknown size';
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${Math.round(bytes / 1024)} KB`;
  return `${mb.toFixed(1)} MB`;
}

export function useCloudClient() {
  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');
  const [chatId, setChatId] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [client, setClient] = useState<TelegramClient | null>(null);
  const [meName, setMeName] = useState('');
  const [isSessionSynced, setIsSessionSynced] = useState<boolean | null>(null);

  const [files, setFiles] = useState<CloudFile[]>([]);
  const [folders, setFolders] = useState<CloudFolder[]>([]);
  const [coverUrls, setCoverUrls] = useState<Record<string, string>>({});
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);

  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadLabel, setUploadLabel] = useState('');
  const [uploadTotalBytes, setUploadTotalBytes] = useState(0);

  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadLabel, setDownloadLabel] = useState('');
  const [downloadTotalBytes, setDownloadTotalBytes] = useState(0);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState(0);
  const [restoreLabel, setRestoreLabel] = useState('');
  const [restoreTotalBytes, setRestoreTotalBytes] = useState(0);

  const loadMe = useCallback(async (newClient: TelegramClient) => {
    try {
      const me = await newClient.getMe();
      const name = [(me as any)?.firstName, (me as any)?.lastName].filter(Boolean).join(' ') || (me as any)?.username || 'Team Member';
      setMeName(name);
    } catch {
      setMeName('Team Member');
    }
  }, []);

  const initClient = useCallback(async (id: string, hash: string, session: string) => {
    try {
      setIsLoading(true);
      const stringSession = new StringSession(session);
      const newClient = new TelegramClient(stringSession, Number(id), hash, {
        connectionRetries: 5,
        useWSS: true,
      });
      await newClient.connect();
      setClient(newClient);
      setIsConnected(true);
      await loadMe(newClient);
    } catch (error) {
      console.error(error);
      setIsConnected(false);
    } finally {
      setIsLoading(false);
    }
  }, [loadMe]);

  useEffect(() => {
    const savedApiId = localStorage.getItem('tg_api_id');
    const savedApiHash = localStorage.getItem('tg_api_hash');
    const savedSession = localStorage.getItem('tg_session');
    const savedChatId = localStorage.getItem('tg_chat_id');

    if (savedApiId) setApiId(savedApiId);
    if (savedApiHash) setApiHash(savedApiHash);
    if (savedChatId) setChatId(savedChatId);

    // Supabase is the source of truth across devices; localStorage is only an
    // offline cache. Always pull synced credentials first and let them win
    // over whatever's cached locally (e.g. a session logged out on another
    // device), falling back to the local session only if Supabase has
    // nothing usable — offline, or the sync call itself fails.
    loadTelegramCredentials().then(creds => {
      if (creds?.apiId) setApiId(creds.apiId);
      if (creds?.apiHash) setApiHash(creds.apiHash);
      if (creds?.chatId) setChatId(creds.chatId);
      setIsSessionSynced(!!creds?.session);
      if (creds?.session && creds.apiId && creds.apiHash) {
        localStorage.setItem('tg_api_id', creds.apiId);
        localStorage.setItem('tg_api_hash', creds.apiHash);
        localStorage.setItem('tg_session', creds.session);
        if (creds.chatId) localStorage.setItem('tg_chat_id', creds.chatId);
        initClient(creds.apiId, creds.apiHash, creds.session);
      } else if (savedSession && savedApiId && savedApiHash) {
        initClient(savedApiId, savedApiHash, savedSession);
      }
    }).catch(err => {
      console.error('Failed to load synced Telegram credentials', err);
      setIsSessionSynced(false);
      if (savedSession && savedApiId && savedApiHash) {
        initClient(savedApiId, savedApiHash, savedSession);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogin = async () => {
    if (!apiId || !apiHash || !phoneNumber) {
      swal({ title: 'Error', text: 'Please enter API ID, API Hash, and phone number', icon: 'error' });
      return;
    }

    setIsLoading(true);
    try {
      const stringSession = new StringSession('');
      const newClient = new TelegramClient(stringSession, Number(apiId), apiHash, {
        connectionRetries: 5,
        useWSS: true,
      });
      await newClient.connect();

      const { phoneCodeHash } = await newClient.sendCode(
        { apiId: Number(apiId), apiHash },
        phoneNumber
      );

      const { value: code } = await swal({
        title: 'Enter Verification Code',
        input: 'text',
        inputLabel: 'A verification code was sent to your Telegram account',
      });

      if (code) {
        try {
          await newClient.invoke(new Api.auth.SignIn({
            phoneNumber,
            phoneCodeHash,
            phoneCode: code
          }));
        } catch (signInErr: any) {
          // Accounts with Two-Step Verification enabled reject the code alone and require
          // the account's cloud password too — GramJS surfaces this as an RPC error rather
          // than throwing a distinct class, so it's matched by message.
          if (signInErr?.errorMessage === 'SESSION_PASSWORD_NEEDED' || /SESSION_PASSWORD_NEEDED/.test(String(signInErr?.message))) {
            const { value: password } = await swal({
              title: 'Two-Step Verification',
              input: 'password',
              inputLabel: 'Enter your Telegram cloud password',
              inputPlaceholder: 'Password',
            });
            if (!password) throw new Error('Two-Step Verification password is required to finish signing in.');
            await newClient.signInWithPassword(
              { apiId: Number(apiId), apiHash },
              { password: async () => password, onError: async (err) => { throw err; } }
            );
          } else {
            throw signInErr;
          }
        }

        const sessionString = newClient.session.save() as unknown as string;
        localStorage.setItem('tg_api_id', apiId);
        localStorage.setItem('tg_api_hash', apiHash);
        localStorage.setItem('tg_session', sessionString);
        try {
          await saveTelegramCredentials({ apiId, apiHash, phone: phoneNumber, session: sessionString });
          setIsSessionSynced(true);
        } catch (syncErr) {
          console.error('Failed to sync Telegram session to the cloud', syncErr);
          setIsSessionSynced(false);
          swalToast({ icon: 'warning', title: 'Logged in, but the session failed to sync to the cloud — other devices won\'t see it' });
        }
        setClient(newClient);
        setIsConnected(true);
        await loadMe(newClient);

        swal({ title: 'Success', text: 'Logged in successfully!', icon: 'success' });
      }
    } catch (err: any) {
      console.error('Login error:', err);
      swal({ title: 'Error', text: err.message || 'Login failed', icon: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  // A first "preview" page loads fast rather than pulling the whole channel history up
  // front — fetchMoreFiles below pages further back in time as the user asks for more.
  const PREVIEW_PAGE_SIZE = 30;
  const [hasMoreFiles, setHasMoreFiles] = useState(true);
  const [isLoadingMoreFiles, setIsLoadingMoreFiles] = useState(false);
  const oldestFetchedIdRef = useRef<number | null>(null);

  const fetchFiles = useCallback(async () => {
    if (!client || !chatId) return;
    setIsLoading(true);
    try {
      const msgs = await client.getMessages(chatId, { limit: PREVIEW_PAGE_SIZE });
      oldestFetchedIdRef.current = msgs.length > 0 ? msgs[msgs.length - 1].id : null;
      setHasMoreFiles(msgs.length === PREVIEW_PAGE_SIZE);

      const cloudFiles: CloudFile[] = [];
      const cloudFolders: CloudFolder[] = [];

      msgs.forEach(m => {
        if (!m.message) return;
        try {
          const data = JSON.parse(m.message);
          if (!data || typeof data !== 'object') return;
          if (m.media && data.type === 'workspace_backup') {
            cloudFiles.push({
              id: m.id,
              msg: m,
              type: data.type,
              scope: (['workspace', 'series', 'volume', 'chapter'].includes(data.scope) ? data.scope : 'workspace') as BackupScope,
              name: data.name || 'Untitled',
              description: data.description || '',
              tags: Array.isArray(data.tags) ? data.tags : [],
              sender: data.sender || 'Team Member',
              folderId: typeof data.folderId === 'number' ? data.folderId : null,
              coverMsgId: data.coverMsgId || 0,
              sizeBytes: data.sizeBytes || 0,
              date: data.date || new Date(m.date * 1000).toISOString(),
            });
          } else if (!m.media && data.type === 'folder') {
            cloudFolders.push({
              id: m.id,
              name: data.name || 'Untitled Folder',
              parentId: typeof data.parentId === 'number' ? data.parentId : null,
              members: Array.isArray(data.members) ? data.members : [],
            });
          }
        } catch {
          // not one of ours, ignore
        }
      });

      setFiles(cloudFiles);
      setFolders(cloudFolders);
      setLastSyncedAt(Date.now());

      cloudFiles.forEach(async (f) => {
        if (f.coverMsgId && !coverUrls[f.id]) {
          try {
            const coverMsgs = await client.getMessages(chatId, { ids: [f.coverMsgId] });
            if (coverMsgs.length > 0 && coverMsgs[0]) {
              const buffer = await client.downloadMedia(coverMsgs[0]);
              if (buffer) {
                const blob = new Blob([buffer], { type: 'image/jpeg' });
                const url = URL.createObjectURL(blob);
                setCoverUrls(prev => ({ ...prev, [f.id]: url }));
              }
            }
          } catch (e) {
            console.error('Failed to load cover', e);
          }
        }
      });
    } catch (err) {
      console.error(err);
      swal({ title: 'Error', text: 'Check that the Chat ID is correct', icon: 'error' });
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, chatId]);

  const fetchMoreFiles = useCallback(async () => {
    if (!client || !chatId || !hasMoreFiles || oldestFetchedIdRef.current == null) return;
    setIsLoadingMoreFiles(true);
    try {
      const msgs = await client.getMessages(chatId, { limit: PREVIEW_PAGE_SIZE, offsetId: oldestFetchedIdRef.current });
      oldestFetchedIdRef.current = msgs.length > 0 ? msgs[msgs.length - 1].id : oldestFetchedIdRef.current;
      setHasMoreFiles(msgs.length === PREVIEW_PAGE_SIZE);

      const moreFiles: CloudFile[] = [];
      const moreFolders: CloudFolder[] = [];
      msgs.forEach(m => {
        if (!m.message) return;
        try {
          const data = JSON.parse(m.message);
          if (!data || typeof data !== 'object') return;
          if (m.media && data.type === 'workspace_backup') {
            moreFiles.push({
              id: m.id,
              msg: m,
              type: data.type,
              scope: (['workspace', 'series', 'volume', 'chapter'].includes(data.scope) ? data.scope : 'workspace') as BackupScope,
              name: data.name || 'Untitled',
              description: data.description || '',
              tags: Array.isArray(data.tags) ? data.tags : [],
              sender: data.sender || 'Team Member',
              folderId: typeof data.folderId === 'number' ? data.folderId : null,
              coverMsgId: data.coverMsgId || 0,
              sizeBytes: data.sizeBytes || 0,
              date: data.date || new Date(m.date * 1000).toISOString(),
            });
          } else if (!m.media && data.type === 'folder') {
            moreFolders.push({
              id: m.id,
              name: data.name || 'Untitled Folder',
              parentId: typeof data.parentId === 'number' ? data.parentId : null,
              members: Array.isArray(data.members) ? data.members : [],
            });
          }
        } catch {
          // not one of ours, ignore
        }
      });

      setFiles(prev => [...prev, ...moreFiles]);
      setFolders(prev => [...prev, ...moreFolders]);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingMoreFiles(false);
    }
  }, [client, chatId, hasMoreFiles]);

  const createFolder = async (name: string, parentId: number | null, members: string[] = []) => {
    if (!client || !chatId) return;
    try {
      await client.sendMessage(chatId, { message: JSON.stringify({ type: 'folder', name, parentId, members }) });
      await fetchFiles();
    } catch (err: any) {
      swal({ title: 'Error', text: err.message || 'Failed to create folder', icon: 'error' });
    }
  };

  const deleteFolder = async (folder: CloudFolder) => {
    if (!client || !chatId) return;
    const result = await swal({
      icon: 'warning',
      title: `Delete folder "${folder.name}"?`,
      text: 'Files inside will remain in Cloud Storage, unfiled.',
      showCancelButton: true,
      confirmButtonText: 'Delete Folder',
      confirmButtonColor: '#FF3B30',
    });
    if (!result.isConfirmed) return;
    try {
      await client.deleteMessages(chatId, [folder.id], { revoke: true });
      await fetchFiles();
    } catch (err: any) {
      swal({ title: 'Error', text: err.message || 'Failed to delete folder', icon: 'error' });
    }
  };

  const moveFile = async (file: CloudFile, folderId: number | null) => {
    if (!client || !chatId) return;
    try {
      const metadata = {
        type: file.type,
        scope: file.scope,
        name: file.name,
        description: file.description,
        tags: file.tags,
        sender: file.sender,
        folderId,
        coverMsgId: file.coverMsgId,
        sizeBytes: file.sizeBytes,
        date: file.date,
      };
      await client.editMessage(chatId, { message: file.id, text: JSON.stringify(metadata, null, 2) });
      await fetchFiles();
    } catch (err: any) {
      swal({ title: 'Error', text: err.message || 'Failed to move file', icon: 'error' });
    }
  };

  const uploadWorkspaceBackup = async (workspace: Workspace, opts: { notes: string; tags: string[]; folderId: number | null; scope?: BackupScope }) => {
    if (!client || !chatId) {
      swal({ title: 'Error', text: 'Connect to Telegram and set a Chat ID first', icon: 'error' });
      return;
    }

    const json = JSON.stringify(workspace);
    const sizeBytes = new Blob([json]).size;

    setIsUploading(true);
    setUploadProgress(0);
    setUploadLabel(workspace.name);
    setUploadTotalBytes(sizeBytes);

    try {
      const fileBuffer: any = Buffer.from(json, 'utf-8');
      fileBuffer.name = `${workspace.name.replace(/[^a-z0-9]+/gi, '_')}.json`;

      let coverMsgId = 0;
      if (workspace.coverUrl) {
        try {
          const coverBlob = await (await fetch(workspace.coverUrl)).blob();
          const coverArrayBuffer = await coverBlob.arrayBuffer();
          const coverBuffer: any = Buffer.from(coverArrayBuffer);
          coverBuffer.name = 'cover.jpg';
          const coverMsg = await client.sendFile(chatId, { file: coverBuffer, forceDocument: false, caption: '[COVER_IMAGE_FOR_PROJECT]' });
          if (coverMsg && coverMsg.id) coverMsgId = coverMsg.id;
        } catch (err) {
          console.error('Cover upload failed', err);
        }
      }

      const metadata = {
        type: 'workspace_backup',
        scope: opts.scope || 'workspace',
        name: workspace.name,
        description: opts.notes || workspace.description || '',
        tags: opts.tags,
        sender: meName || 'Team Member',
        folderId: opts.folderId,
        coverMsgId,
        sizeBytes,
        date: new Date().toISOString()
      };

      await client.sendFile(chatId, {
        file: fileBuffer,
        caption: JSON.stringify(metadata, null, 2),
        forceDocument: true,
        fileSize: sizeBytes,
        progressCallback: (progress: number) => setUploadProgress(Math.round(progress * 100)),
      });

      localStorage.setItem('tg_last_backup_at', Date.now().toString());
      swalToast({ icon: 'success', title: `"${workspace.name}" backed up to Cloud Storage` });
      fetchFiles();
    } catch (err: any) {
      console.error(err);
      swal({ title: 'Backup Error', text: err.message || 'An error occurred during backup', icon: 'error' });
      throw err;
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const downloadCloudFile = async (file: CloudFile) => {
    const result = await swal({
      icon: 'question',
      title: `Download "${file.name}"?`,
      text: `File size: ${formatSize(file.sizeBytes)}`,
      showCancelButton: true,
      confirmButtonText: 'Download',
    });
    if (!result.isConfirmed) return;

    setIsDownloading(true);
    setDownloadProgress(0);
    setDownloadLabel(file.name);
    setDownloadTotalBytes(file.sizeBytes);
    try {
      const buffer = await client?.downloadMedia(file.msg, {
        progressCallback: (downloaded: any, total: any) => setDownloadProgress(Math.min(100, Math.round(Number(downloaded) / Number(total || 1) * 100))),
      } as any);
      if (buffer) {
        const blob = new Blob([buffer]);
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        const ext = (file.msg as any)?.file?.name?.split('.').pop() || 'zip';
        a.download = `${file.name || 'project'}.${ext}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      } else {
        swal({ title: 'Error', text: 'Empty file buffer received', icon: 'error' });
      }
    } catch (e: any) {
      swal({ title: 'Error', text: e?.message || 'Download failed', icon: 'error' });
    } finally {
      setIsDownloading(false);
    }
  };

  const downloadFolderAsZip = async (folderId: number | null, folderName: string) => {
    const filesInFolder = files.filter(f => f.folderId === folderId);
    if (filesInFolder.length === 0) {
      swal({ icon: 'info', title: 'Empty folder', text: 'This folder has no files to download.' });
      return;
    }
    setIsDownloading(true);
    setDownloadProgress(0);
    setDownloadLabel(`Packing "${folderName}"...`);
    setDownloadTotalBytes(filesInFolder.reduce((sum, f) => sum + (f.sizeBytes || 0), 0));
    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      for (let i = 0; i < filesInFolder.length; i++) {
        const file = filesInFolder[i];
        const buffer = await client?.downloadMedia(file.msg, {
          progressCallback: () => setDownloadProgress(Math.min(99, Math.round((i / filesInFolder.length) * 100))),
        } as any);
        if (buffer) {
          const ext = (file.msg as any)?.file?.name?.split('.').pop() || 'bin';
          zip.file(`${file.name || `file-${i + 1}`}.${ext}`, buffer as any);
        }
      }
      const blob = await zip.generateAsync({ type: 'blob' }, meta => setDownloadProgress(Math.round(meta.percent)));
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `${folderName || 'folder'}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      swal({ title: 'Error', text: e?.message || 'Could not build the folder ZIP', icon: 'error' });
    } finally {
      setIsDownloading(false);
    }
  };

  const restoreWorkspaceFromCloud = async (file: CloudFile): Promise<Workspace | null> => {
    setIsRestoring(true);
    setRestoreProgress(0);
    setRestoreLabel(file.name);
    setRestoreTotalBytes(file.sizeBytes);
    try {
      const buffer = await client?.downloadMedia(file.msg, {
        progressCallback: (downloaded: any, total: any) => setRestoreProgress(Math.min(100, Math.round(Number(downloaded) / Number(total || 1) * 100))),
      } as any);
      if (!buffer) {
        swal({ title: 'Error', text: 'Empty file buffer received', icon: 'error' });
        return null;
      }
      const text = new TextDecoder('utf-8').decode(buffer as Uint8Array);
      // Normalize older backups (flat `images: ProcessedImage[]`) to the current `pages: Page[]` shape.
      const parsed = migrateWorkspace(JSON.parse(text) as Workspace);

      // Regenerate every id so restoring doesn't collide with existing local data.
      const restored: Workspace = {
        ...parsed,
        id: genId('workspace'),
        mangas: (parsed.mangas || []).map(m => ({
          ...m,
          id: genId('manga'),
          volumes: (m.volumes || []).map(v => ({
            ...v,
            id: genId('volume'),
            chapters: (v.chapters || []).map(c => ({
              ...c,
              id: genId('chapter'),
              pages: (c.pages || []).map(page => ({
                ...page,
                id: genId('page'),
                original: { ...page.original, id: genId('image') },
                cleaned: page.cleaned ? { ...page.cleaned, id: genId('image') } : null,
              })),
            })),
          })),
        })),
      };
      return restored;
    } catch (e: any) {
      console.error(e);
      swal({ title: 'Error', text: e?.message || 'Restore failed', icon: 'error' });
      return null;
    } finally {
      setIsRestoring(false);
    }
  };

  const uploadTaskAttachment = async (channelId: string, file: File, onProgress?: (pct: number) => void): Promise<{ msgId: number; name: string; size: number } | null> => {
    if (!client || !channelId) {
      swal({ title: 'Error', text: 'Connect Telegram and make sure the team has a channel set first', icon: 'error' });
      return null;
    }
    try {
      const arrayBuffer = await file.arrayBuffer();
      const fileBuffer: any = Buffer.from(arrayBuffer);
      fileBuffer.name = file.name;
      const msg = await client.sendFile(channelId, {
        file: fileBuffer,
        caption: file.name,
        forceDocument: true,
        fileSize: file.size,
        progressCallback: (progress: number) => onProgress?.(Math.round(progress * 100)),
      });
      if (!msg || !msg.id) return null;
      return { msgId: msg.id, name: file.name, size: file.size };
    } catch (err: any) {
      console.error(err);
      swal({ title: 'Upload Error', text: err.message || 'An error occurred during upload', icon: 'error' });
      return null;
    }
  };

  const downloadTaskAttachment = async (channelId: string, msgId: number, fileName: string, onProgress?: (pct: number) => void): Promise<void> => {
    if (!client || !channelId) {
      swal({ title: 'Error', text: 'Connect Telegram first', icon: 'error' });
      return;
    }
    try {
      const msgs = await client.getMessages(channelId, { ids: [msgId] });
      const msg = msgs[0];
      if (!msg) {
        swal({ title: 'Error', text: 'Attachment message not found', icon: 'error' });
        return;
      }
      const buffer = await client.downloadMedia(msg, {
        progressCallback: (downloaded: any, total: any) => onProgress?.(Math.min(100, Math.round(Number(downloaded) / Number(total || 1) * 100))),
      } as any);
      if (!buffer) {
        swal({ title: 'Error', text: 'Empty file buffer received', icon: 'error' });
        return;
      }
      const blob = new Blob([buffer]);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error(err);
      swal({ title: 'Error', text: err.message || 'Download failed', icon: 'error' });
    }
  };

  // ---------------------------------------------------------------------
  // Team Files: browse/upload an arbitrary channel (the team's shared
  // Telegram channel) rather than the user's own personal cloud channel.
  // Any message with media is listed (task submissions included, so the
  // team can see everything sitting in that channel, not just curated
  // uploads); JSON-caption metadata is used when present for name/folder.
  // ---------------------------------------------------------------------

  const fetchChannelFiles = async (channelId: string): Promise<{ files: CloudFile[]; folders: CloudFolder[] }> => {
    if (!client || !channelId) return { files: [], folders: [] };
    const msgs = await client.getMessages(channelId, { limit: 200 });
    const cloudFiles: CloudFile[] = [];
    const cloudFolders: CloudFolder[] = [];

    msgs.forEach(m => {
      if (m.media) {
        let meta: any = null;
        try { meta = m.message ? JSON.parse(m.message) : null; } catch { /* plain caption, not JSON */ }
        // Only genuine uploaded files are surfaced here — workspace-backup covers/JSONs
        // (meta.type === 'workspace_backup') and TypeR-internal cover images are excluded,
        // this browser is for actual team file uploads/task work only.
        if (meta?.type === 'workspace_backup' || meta?.type === 'file_comment') return;
        cloudFiles.push({
          id: m.id,
          msg: m,
          type: 'team_file',
          scope: 'workspace' as BackupScope,
          name: meta?.name || m.message || (m as any).file?.name || 'Untitled',
          description: meta?.description || '',
          tags: Array.isArray(meta?.tags) ? meta.tags : [],
          sender: meta?.sender || 'Team Member',
          folderId: typeof meta?.folderId === 'number' ? meta.folderId : null,
          coverMsgId: 0,
          sizeBytes: meta?.sizeBytes || (m as any).file?.size || 0,
          date: meta?.date || new Date(m.date * 1000).toISOString(),
        });
      } else if (m.message) {
        try {
          const data = JSON.parse(m.message);
          if (data?.type === 'folder') {
            cloudFolders.push({ id: m.id, name: data.name || 'Untitled Folder', parentId: typeof data.parentId === 'number' ? data.parentId : null, members: Array.isArray(data.members) ? data.members : [] });
          }
        } catch { /* not a folder marker */ }
      }
    });

    return { files: cloudFiles, folders: cloudFolders };
  };

  const listFileComments = async (channelId: string, fileId: number): Promise<CloudFileComment[]> => {
    if (!client || !channelId) return [];
    const msgs = await client.getMessages(channelId, { limit: 300 });
    const comments: CloudFileComment[] = [];
    msgs.forEach(m => {
      if (!m.message) return;
      try {
        const data = JSON.parse(m.message);
        if (data?.type === 'file_comment' && data.fileId === fileId) {
          comments.push({ id: m.id, fileId, author: data.author || 'Team Member', authorUserId: data.authorUserId ?? null, body: data.body || '', date: data.date || new Date(m.date * 1000).toISOString() });
        }
      } catch { /* not a comment marker */ }
    });
    return comments.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  };

  const postFileComment = async (channelId: string, fileId: number, body: string): Promise<void> => {
    if (!client || !channelId) return;
    const { data: userData } = await supabase.auth.getUser();
    await client.sendMessage(channelId, { message: JSON.stringify({ type: 'file_comment', fileId, author: meName || 'Team Member', authorUserId: userData.user?.id ?? null, body, date: new Date().toISOString() }) });
  };

  // Single-pass variant of listFileComments — fetches the channel's messages
  // once and groups every comment by fileId, instead of one Telegram fetch
  // per file card (what per-card comment loading would otherwise cost).
  const listAllComments = async (channelId: string): Promise<CloudFileComment[]> => {
    if (!client || !channelId) return [];
    const msgs = await client.getMessages(channelId, { limit: 300 });
    const comments: CloudFileComment[] = [];
    msgs.forEach(m => {
      if (!m.message) return;
      try {
        const data = JSON.parse(m.message);
        if (data?.type === 'file_comment') {
          comments.push({ id: m.id, fileId: data.fileId, author: data.author || 'Team Member', authorUserId: data.authorUserId ?? null, body: data.body || '', date: data.date || new Date(m.date * 1000).toISOString() });
        }
      } catch { /* not a comment marker */ }
    });
    return comments.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  };

  // Chat attachments need the same folder/metadata handling as the Team
  // Files browser (uploadChannelFile) so they land filed under a folder
  // (the caller passes the secret .chat-uploads folder id) rather than
  // uploadTaskAttachment's bare, unfoldered caption — while still returning
  // uploadTaskAttachment's { msgId, name, size } shape that chat messages
  // store as their attachment reference.
  const uploadChatAttachment = async (channelId: string, file: File, folderId: number | null, onProgress?: (pct: number) => void): Promise<{ msgId: number; name: string; size: number } | null> => {
    if (!client || !channelId) {
      swal({ title: 'Error', text: 'Connect Telegram and make sure the team has a channel set first', icon: 'error' });
      return null;
    }
    try {
      const arrayBuffer = await file.arrayBuffer();
      const fileBuffer: any = Buffer.from(arrayBuffer);
      fileBuffer.name = file.name;
      const metadata = { type: 'team_file', name: file.name, description: '', tags: [], sender: meName || 'Team Member', folderId, sizeBytes: file.size, date: new Date().toISOString() };
      const msg = await client.sendFile(channelId, {
        file: fileBuffer,
        caption: JSON.stringify(metadata),
        forceDocument: true,
        fileSize: file.size,
        progressCallback: (progress: number) => onProgress?.(Math.round(progress * 100)),
      });
      if (!msg || !msg.id) return null;
      return { msgId: msg.id, name: file.name, size: file.size };
    } catch (err: any) {
      console.error(err);
      swal({ title: 'Upload Error', text: err.message || 'An error occurred during upload', icon: 'error' });
      return null;
    }
  };

  const downloadChannelFile = async (file: CloudFile): Promise<void> => {
    setIsDownloading(true);
    setDownloadProgress(0);
    setDownloadLabel(file.name);
    setDownloadTotalBytes(file.sizeBytes);
    try {
      const buffer = await client?.downloadMedia(file.msg, {
        progressCallback: (downloaded: any, total: any) => setDownloadProgress(Math.min(100, Math.round(Number(downloaded) / Number(total || 1) * 100))),
      } as any);
      if (buffer) {
        const blob = new Blob([buffer]);
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }
    } catch (e: any) {
      swal({ title: 'Error', text: e?.message || 'Download failed', icon: 'error' });
    } finally {
      setIsDownloading(false);
    }
  };

  const createChannelFolder = async (channelId: string, name: string, parentId: number | null, members: string[] = []): Promise<void> => {
    if (!client || !channelId) return;
    await client.sendMessage(channelId, { message: JSON.stringify({ type: 'folder', name, parentId, members }) });
  };

  const deleteChannelFolder = async (channelId: string, folder: CloudFolder): Promise<void> => {
    if (!client || !channelId) return;
    await client.deleteMessages(channelId, [folder.id], { revoke: true });
  };

  const updateChannelFolderMembers = async (channelId: string, folder: CloudFolder, members: string[]): Promise<void> => {
    if (!client || !channelId) return;
    await client.editMessage(channelId, { message: folder.id, text: JSON.stringify({ type: 'folder', name: folder.name, parentId: folder.parentId, members }) });
  };

  const uploadChannelFile = async (channelId: string, file: File, folderId: number | null, onProgress?: (pct: number) => void, opts?: { name?: string; description?: string }): Promise<number | null> => {
    if (!client || !channelId) {
      swal({ title: 'Error', text: 'Connect Telegram and make sure the team has a channel set first', icon: 'error' });
      return null;
    }
    try {
      const arrayBuffer = await file.arrayBuffer();
      const fileBuffer: any = Buffer.from(arrayBuffer);
      fileBuffer.name = file.name;
      const metadata = { type: 'team_file', name: opts?.name || file.name, description: opts?.description || '', tags: [], sender: meName || 'Team Member', folderId, sizeBytes: file.size, date: new Date().toISOString() };
      const msg = await client.sendFile(channelId, {
        file: fileBuffer,
        caption: JSON.stringify(metadata),
        forceDocument: true,
        fileSize: file.size,
        progressCallback: (progress: number) => onProgress?.(Math.round(progress * 100)),
      });
      return msg?.id ?? null;
    } catch (err: any) {
      console.error(err);
      swal({ title: 'Upload Error', text: err.message || 'An error occurred during upload', icon: 'error' });
      return null;
    }
  };

  const saveConfig = async () => {
    if (chatId) {
      localStorage.setItem('tg_chat_id', chatId);
      try {
        await saveTelegramCredentials({ chatId });
      } catch (err) {
        console.error('Failed to sync chat ID to the cloud', err);
        swalToast({ icon: 'warning', title: 'Saved locally, but failed to sync to the cloud' });
        return;
      }
    }
    swalToast({ icon: 'success', title: 'Saved' });
  };

  const retryCloudSync = async () => {
    const savedSession = localStorage.getItem('tg_session');
    if (!apiId || !apiHash || !savedSession) return;
    try {
      await saveTelegramCredentials({ apiId, apiHash, phone: phoneNumber, session: savedSession, chatId });
      setIsSessionSynced(true);
      swalToast({ icon: 'success', title: 'Session synced to the cloud' });
    } catch (err) {
      console.error('Failed to sync Telegram session to the cloud', err);
      setIsSessionSynced(false);
      swalToast({ icon: 'warning', title: 'Still failed to sync to the cloud' });
    }
  };

  const handleDisconnect = async () => {
    localStorage.removeItem('tg_session');
    setIsConnected(false);
    setClient(null);
    try {
      await saveTelegramCredentials({ session: '' });
      setIsSessionSynced(false);
    } catch (err) {
      console.error('Failed to clear the synced Telegram session in the cloud', err);
      swalToast({ icon: 'warning', title: 'Disconnected locally, but failed to clear the synced session in the cloud' });
    }
  };

  return {
    apiId, setApiId,
    apiHash, setApiHash,
    chatId, setChatId,
    phoneNumber, setPhoneNumber,
    isConnected,
    isLoading,
    handleLogin,
    handleDisconnect,
    saveConfig,
    retryCloudSync,
    meName,
    isSessionSynced,

    files,
    folders,
    coverUrls,
    lastSyncedAt,
    fetchFiles,
    fetchMoreFiles,
    hasMoreFiles,
    isLoadingMoreFiles,
    createFolder,
    deleteFolder,
    moveFile,

    isUploading,
    uploadProgress,
    uploadLabel,
    uploadTotalBytes,
    uploadWorkspaceBackup,

    isDownloading,
    downloadProgress,
    downloadLabel,
    downloadTotalBytes,
    downloadCloudFile,
    downloadFolderAsZip,

    isRestoring,
    restoreProgress,
    restoreLabel,
    restoreTotalBytes,
    restoreWorkspaceFromCloud,

    uploadTaskAttachment,
    downloadTaskAttachment,

    fetchChannelFiles,
    createChannelFolder,
    deleteChannelFolder,
    updateChannelFolderMembers,
    uploadChannelFile,
    downloadChannelFile,
    listFileComments,
    listAllComments,
    postFileComment,
    uploadChatAttachment,

    formatSize,
  };
}

export type CloudClient = ReturnType<typeof useCloudClient>;
