import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Upload, X } from 'lucide-react';
import { IconButton } from '../ui';
import type { Chapter, Workspace } from '../../types';

const STORAGE_KEY = 'text_editor_split_preview';
const STORAGE_SCHEMA_VERSION = 1;
const STORAGE_DEBOUNCE_MS = 400;

interface StoredSelection {
  v: number;
  chapterId: string | null;
  pageIndex: number;
}

interface FlatChapter {
  id: string;
  label: string;
  chapter: Chapter;
}

function loadStoredSelection(): { chapterId: string | null; pageIndex: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { chapterId: null, pageIndex: 0 };
    const parsed = JSON.parse(raw) as StoredSelection;
    if (parsed.v !== STORAGE_SCHEMA_VERSION) return { chapterId: null, pageIndex: 0 };
    return { chapterId: parsed.chapterId, pageIndex: parsed.pageIndex };
  } catch {
    return { chapterId: null, pageIndex: 0 };
  }
}

function flattenChapters(workspaces: Workspace[]): FlatChapter[] {
  const flat: FlatChapter[] = [];
  for (const workspace of workspaces) {
    for (const manga of workspace.mangas) {
      for (const volume of manga.volumes) {
        for (const chapter of volume.chapters) {
          flat.push({ id: chapter.id, label: `${manga.title} / ${volume.name} / ${chapter.name}`, chapter });
        }
      }
    }
  }
  return flat;
}

interface SplitScreenPreviewProps {
  workspaces: Workspace[];
  onClose: () => void;
}

export function SplitScreenPreview({ workspaces, onClose }: SplitScreenPreviewProps) {
  const flatChapters = useMemo(() => flattenChapters(workspaces), [workspaces]);

  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(() => loadStoredSelection().chapterId);
  const [selectedPageIndex, setSelectedPageIndex] = useState(() => loadStoredSelection().pageIndex);
  const [uploadedPreviewUrl, setUploadedPreviewUrl] = useState<string | null>(null);
  const [uploadedIsPdf, setUploadedIsPdf] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadedUrlRef = useRef<string | null>(null);

  // Default to a chapter if none stored yet and one becomes available.
  useEffect(() => {
    if (selectedChapterId === null && flatChapters.length > 0) {
      setSelectedChapterId(flatChapters[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatChapters.length]);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const stored: StoredSelection = { v: STORAGE_SCHEMA_VERSION, chapterId: selectedChapterId, pageIndex: selectedPageIndex };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
      } catch {
        // Storage full/unavailable — selection just won't persist this time, not fatal.
      }
    }, STORAGE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [selectedChapterId, selectedPageIndex]);

  useEffect(() => () => {
    if (uploadedUrlRef.current) URL.revokeObjectURL(uploadedUrlRef.current);
  }, []);

  const selectedChapter = flatChapters.find(f => f.id === selectedChapterId)?.chapter ?? null;
  const pageCount = selectedChapter?.pages.length ?? 0;
  const clampedIndex = pageCount > 0 ? Math.min(selectedPageIndex, pageCount - 1) : 0;
  const currentPage = selectedChapter?.pages[clampedIndex] ?? null;
  const currentImage = currentPage ? (currentPage.cleaned ?? currentPage.original) : null;

  function handleChapterChange(id: string) {
    setSelectedChapterId(id);
    setSelectedPageIndex(0);
    clearUpload();
  }

  function goPrev() {
    setSelectedPageIndex(i => Math.max(0, i - 1));
    clearUpload();
  }

  function goNext() {
    setSelectedPageIndex(i => Math.min(pageCount - 1, i + 1));
    clearUpload();
  }

  function clearUpload() {
    if (uploadedUrlRef.current) {
      URL.revokeObjectURL(uploadedUrlRef.current);
      uploadedUrlRef.current = null;
    }
    setUploadedPreviewUrl(null);
    setUploadedIsPdf(false);
  }

  function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    const file = files[0];
    if (!file) return;
    if (uploadedUrlRef.current) URL.revokeObjectURL(uploadedUrlRef.current);
    const url = URL.createObjectURL(file);
    uploadedUrlRef.current = url;
    setUploadedPreviewUrl(url);
    setUploadedIsPdf(file.type === 'application/pdf');
  }

  return (
    <div className="w-[360px] shrink-0 border-l border-hairline flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between px-3 h-10 shrink-0 border-b border-hairline">
        <span className="text-xs font-semibold text-ink">Manga Preview</span>
        <IconButton size="sm" aria-label="Close split screen" onClick={onClose} className="!bg-transparent">
          <X size={14} />
        </IconButton>
      </div>

      <div className="flex flex-col gap-2 px-3 py-2 border-b border-hairline">
        <label className="text-[11px] text-ink-faint font-medium">Chapter</label>
        <select
          value={selectedChapterId ?? ''}
          onChange={(e) => handleChapterChange(e.target.value)}
          className="w-full bg-ink/5 border border-hairline rounded-md px-2 py-1.5 text-xs text-ink"
        >
          {flatChapters.length === 0 && <option value="">No chapters available</option>}
          {flatChapters.map(f => (
            <option key={f.id} value={f.id}>{f.label}</option>
          ))}
        </select>

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <IconButton size="sm" aria-label="Previous page" onClick={goPrev} disabled={clampedIndex <= 0} className="!bg-transparent">
              <ChevronLeft size={14} />
            </IconButton>
            <span className="text-[11px] text-ink-faint px-1 tabular-nums">
              {pageCount > 0 ? `Page ${clampedIndex + 1} of ${pageCount}` : 'No pages'}
            </span>
            <IconButton size="sm" aria-label="Next page" onClick={goNext} disabled={clampedIndex >= pageCount - 1} className="!bg-transparent">
              <ChevronRight size={14} />
            </IconButton>
          </div>
          <IconButton size="sm" aria-label="Upload reference image" onClick={() => fileInputRef.current?.click()} className="!bg-transparent">
            <Upload size={14} />
          </IconButton>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,application/pdf"
            onChange={handleFileChosen}
            className="hidden"
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto bg-[#e9e9ec] dark:bg-[#2a2a2a] flex items-center justify-center p-4">
        {uploadedPreviewUrl ? (
          uploadedIsPdf ? (
            <embed src={uploadedPreviewUrl} type="application/pdf" className="w-full h-full rounded-sm shadow-lg" />
          ) : (
            <img src={uploadedPreviewUrl} alt="Uploaded reference" className="max-w-full max-h-full rounded-sm shadow-lg" />
          )
        ) : currentImage ? (
          <img src={currentImage.dataUrl} alt={currentPage?.id ?? 'page'} className="max-w-full max-h-full rounded-sm shadow-lg" />
        ) : (
          <span className="text-xs text-ink-faint">No page to preview</span>
        )}
      </div>
    </div>
  );
}
