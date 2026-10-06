"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, Pencil } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Card, CardContent } from "@/components/ui/Card";
import { Field, FieldError, Label } from "@/components/ui/Label";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { PHOTO_TOO_LARGE_MESSAGE, preparePhotoForUpload } from "@/lib/photoUpload";


/**
 * Name and photo - the two profile details with no verification story of
 * their own (unlike email and phone, each with a dedicated card lower on
 * this page), so both save immediately with no separate confirm step.
 */
export function ProfileCard({
  initialName,
  email,
  image,
}: {
  initialName: string;
  email: string;
  image: string | null;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initialName);
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    setNameError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError("Enter your name");
      return;
    }
    setSavingName(true);
    const res = await fetch("/api/account/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
    const data = await res.json();
    setSavingName(false);
    if (!res.ok) {
      setNameError(data.error ?? "Couldn't save your name.");
      return;
    }
    setEditing(false);
    toast.success("Name updated");
    router.refresh();
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setUploadingAvatar(true);
    let data: { error?: string } = {};
    let ok = false;
    try {
      const prepared = await preparePhotoForUpload(file);
      const formData = new FormData();
      formData.append("file", prepared);
      const res = await fetch("/api/account/avatar", { method: "POST", body: formData });
      data = await res.json().catch(() => ({}));
      ok = res.ok;
    } catch (error) {
      data = { error: error instanceof Error && error.message === PHOTO_TOO_LARGE_MESSAGE ? error.message : undefined };
    }
    setUploadingAvatar(false);
    if (!ok) {
      toast.error(data.error ?? "We couldn't upload that photo. Please try again.");
      return;
    }
    toast.success("Photo updated");
    router.refresh();
  }

  return (
    <Card className="p-5">
      <CardContent className="flex items-center gap-4 p-0">
        <div className="relative shrink-0">
          <Avatar name={initialName} src={image} size={64} />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingAvatar}
            aria-label="Change photo"
            className="focus-ring absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-surface bg-brand-700 text-white hover:bg-brand-800 disabled:opacity-60"
          >
            <Camera className="h-3.5 w-3.5" aria-hidden />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleAvatarChange}
            aria-label="Profile photo"
            className="sr-only"
          />
        </div>

        <div className="min-w-0 flex-1">
          {editing ? (
            <form onSubmit={saveName} className="flex flex-col gap-2">
              <Field>
                <Label htmlFor="profile-name">Name</Label>
                <Input
                  id="profile-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  invalid={Boolean(nameError)}
                  autoFocus
                />
                <FieldError>{nameError}</FieldError>
              </Field>
              <div className="flex gap-2">
                <Button type="submit" size="sm" loading={savingName}>
                  Save
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditing(false);
                    setName(initialName);
                    setNameError(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <p className="truncate font-medium text-foreground">{initialName}</p>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  aria-label="Edit name"
                  className="focus-ring flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-stone-400 hover:bg-surface-muted hover:text-stone-600"
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
              <p className="truncate text-sm text-stone-500">{email}</p>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
