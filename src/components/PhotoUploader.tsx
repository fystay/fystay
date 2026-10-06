"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { ImagePlus, X } from "lucide-react";
import { toast } from "sonner";
import { Spinner } from "@/components/ui/Spinner";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { isOptimizableImage } from "@/lib/image";
import { cn } from "@/lib/cn";
import { PHOTO_TOO_LARGE_MESSAGE, preparePhotoForUpload } from "@/lib/photoUpload";

export function PhotoUploader({
  photos,
  onChange,
}: {
  photos: string[];
  onChange: (photos: string[]) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [pastedUrl, setPastedUrl] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function addPastedUrl() {
    const url = pastedUrl.trim();
    if (!url) return;
    if (!photos.includes(url)) onChange([...photos, url]);
    setPastedUrl("");
  }

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;

    setUploading(true);
    const uploaded: string[] = [];

    for (const original of Array.from(fileList)) {
      try {
        const file = await preparePhotoForUpload(original);
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/uploads", { method: "POST", body: formData });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.url) {
          toast.error(data.error ?? `We couldn't upload ${original.name}. Please try again.`);
          continue;
        }
        uploaded.push(data.url);
      } catch (error) {
        toast.error(
          error instanceof Error && error.message === PHOTO_TOO_LARGE_MESSAGE
            ? `${original.name}: ${PHOTO_TOO_LARGE_MESSAGE}`
            : `We couldn't upload ${original.name}. Please try again.`,
        );
      }
    }

    setUploading(false);
    if (uploaded.length > 0) {
      onChange([...photos, ...uploaded]);
    }
  }

  function removePhoto(url: string) {
    onChange(photos.filter((p) => p !== url));
  }

  return (
    <div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {photos.map((url, i) => (
          <div
            key={url}
            className="group relative aspect-square overflow-hidden rounded-lg bg-surface-muted"
          >
            <Image
              src={url}
              alt=""
              fill
              className="object-cover"
              sizes="150px"
              unoptimized={!isOptimizableImage(url)}
            />
            {i === 0 && (
              <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                Cover
              </span>
            )}
            <button
              type="button"
              onClick={() => removePhoto(url)}
              aria-label="Remove photo"
              className="focus-ring absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className={cn(
            "focus-ring flex aspect-square flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-border-subtle text-stone-400 transition-colors hover:border-stone-300 hover:text-stone-500",
            uploading && "pointer-events-none opacity-60",
          )}
        >
          {uploading ? <Spinner /> : <ImagePlus className="h-5 w-5" />}
          <span className="text-xs font-medium">{uploading ? "Uploading…" : "Add photo"}</span>
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-medium text-stone-600">
          Or paste an image URL instead
        </summary>
        <div className="mt-2 flex gap-2">
          <Input
            value={pastedUrl}
            onChange={(e) => setPastedUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addPastedUrl();
              }
            }}
            placeholder="https://example.com/photo.jpg"
          />
          <Button type="button" variant="outline" onClick={addPastedUrl}>
            Add
          </Button>
        </div>
      </details>
    </div>
  );
}
