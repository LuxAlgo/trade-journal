"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { FolderPlus, Plus, Search } from "lucide-react";
import { FilterBar } from "@/components/filter-bar";
import { VoiceNote } from "@/components/voice-note";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { postJson, useApi } from "@/lib/use-api";
import { cn } from "@/lib/utils";

interface NoteRow {
  id: string;
  folderId: string;
  title: string;
  content: string;
  updatedAt: string;
}

interface FolderRow {
  id: string;
  name: string;
  kind: string;
}

export default function NotebookPage() {
  return (
    <Suspense>
      <Notebook />
    </Suspense>
  );
}

function Notebook() {
  const [folder, setFolder] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data, refresh } = useApi<{ notes: NoteRow[]; folders: FolderRow[] }>(
    `/api/notes?folder=${folder}&q=${encodeURIComponent(search)}`,
  );
  const selected = data?.notes.find((note) => note.id === selectedId) ?? null;

  const createNote = async () => {
    const result = await postJson<{ id: string }>("/api/notes", {
      folderId: folder === "all" ? "my-notes" : folder,
      title: "Untitled",
    });
    refresh();
    setSelectedId(result.id);
  };

  const createFolder = async () => {
    const name = prompt("Folder name");
    if (name) {
      await postJson("/api/folders", { name });
      refresh();
    }
  };

  return (
    <div>
      <FilterBar
        title="Notebook"
        actions={
          <Button size="sm" onClick={createNote}>
            <Plus />
            New note
          </Button>
        }
      />
      <div className="grid h-[calc(100vh-3.5rem)] grid-cols-[180px_280px_1fr]">
        <div className="space-y-0.5 overflow-y-auto border-r p-2">
          <button
            className={cn(
              "w-full rounded-md px-2.5 py-1.5 text-left text-sm",
              folder === "all"
                ? "bg-accent font-medium"
                : "text-muted-foreground hover:bg-accent/60",
            )}
            onClick={() => setFolder("all")}
          >
            All notes
          </button>
          {data?.folders
            .filter((f) => f.id !== "all")
            .map((f) => (
              <button
                key={f.id}
                className={cn(
                  "w-full rounded-md px-2.5 py-1.5 text-left text-sm",
                  folder === f.id
                    ? "bg-accent font-medium"
                    : "text-muted-foreground hover:bg-accent/60",
                )}
                onClick={() => setFolder(f.id)}
              >
                {f.name}
              </button>
            ))}
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-muted-foreground"
            onClick={createFolder}
          >
            <FolderPlus />
            New folder
          </Button>
        </div>

        <div className="overflow-y-auto border-r">
          <div className="sticky top-0 border-b bg-background p-2">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search notes"
                className="pl-8"
              />
            </div>
          </div>
          {data?.notes.length === 0 && (
            <p className="p-6 text-center text-sm text-muted-foreground">No notes here yet.</p>
          )}
          {data?.notes.map((note) => (
            <button
              key={note.id}
              className={cn(
                "block w-full border-b px-3 py-2.5 text-left hover:bg-accent/40",
                selectedId === note.id && "bg-accent/60",
              )}
              onClick={() => setSelectedId(note.id)}
            >
              <div className="truncate text-sm font-medium">{note.title || "Untitled"}</div>
              <div className="truncate text-xs text-muted-foreground">
                {note.updatedAt.slice(0, 10)} · {note.content.slice(0, 60) || "empty"}
              </div>
            </button>
          ))}
        </div>

        <div className="overflow-y-auto p-4">
          {selected ? (
            <NoteEditor key={selected.id} note={selected} onChanged={refresh} />
          ) : (
            <p className="py-24 text-center text-sm text-muted-foreground">
              Select or create a note.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function NoteEditor({ note, onChanged }: { note: NoteRow; onChanged: () => void }) {
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const save = (nextTitle: string, nextContent: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void postJson(
        `/api/notes/${note.id}`,
        { title: nextTitle, content: nextContent },
        "PATCH",
      ).then(onChanged);
    }, 600);
  };

  return (
    <Card className="mx-auto max-w-3xl">
      <CardContent className="space-y-3 pt-4">
        <div className="flex items-center gap-2">
          <Input
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              save(event.target.value, content);
            }}
            className="border-0 px-0 text-lg font-semibold shadow-none focus-visible:ring-0"
            placeholder="Title"
          />
          <VoiceNote
            onText={(text) => {
              const next = content ? `${content} ${text}` : text;
              setContent(next);
              save(title, next);
            }}
          />
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={async () => {
              if (confirm("Delete this note?")) {
                await postJson(`/api/notes/${note.id}`, undefined, "DELETE");
                onChanged();
              }
            }}
          >
            Delete
          </Button>
        </div>
        <Textarea
          value={content}
          onChange={(event) => {
            setContent(event.target.value);
            save(title, event.target.value);
          }}
          placeholder="Write in Markdown, or dictate…"
          className="min-h-[60vh] border-0 px-0 font-mono text-[13px] shadow-none focus-visible:ring-0"
        />
      </CardContent>
    </Card>
  );
}
