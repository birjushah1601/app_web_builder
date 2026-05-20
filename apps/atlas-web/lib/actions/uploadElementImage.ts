"use server";
import { uploadReference } from "@/lib/actions/uploadReference";

/** Thin wrapper around uploadReference: takes a FormData with a single `file`
 *  field, persists to `.next/cache/atlas-references/<sha>.<ext>`, returns the
 *  served URL the patch engine should write into the JSX `src=`. Kept as its
 *  own action so future image-specific extensions (sandbox /code/public/
 *  copy, alt-derivation) don't add complexity to the more general
 *  uploadReference. */
export async function uploadElementImage(formData: FormData): Promise<{ url: string }> {
  return uploadReference(formData);
}
