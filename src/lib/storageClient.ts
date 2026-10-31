"use client";

/**
 * Client-side Firebase Storage helpers for static export / Capacitor.
 * Same logic as storage.ts but runs in browser (no server action).
 * Used by Gallery and other components when building for APK.
 */
import { ref, uploadBytes, getDownloadURL, deleteObject, getBlob } from "@/lib/pocketbaseData/pbStorage";
import { storage } from "./firebase";
import { format } from "date-fns";

const slugify = (text: string = "") =>
  text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

const safeFileName = (name: string) =>
  name
    .trim()
    .replace(/[^\w.\-() ]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120);

const getCompanyFolder = (companyId: string, companyName?: string) => {
  if (!companyName) return companyId;
  return `${companyId}__${slugify(companyName)}`;
};

const generateVoucherPath = (
  companyId: string,
  companyName: string | undefined,
  voucherType: string,
  voucherDate: Date,
  voucherId: string,
  fileName: string
) => {
  const year = format(voucherDate, "yyyy");
  const month = format(voucherDate, "MM");
  const day = format(voucherDate, "yyyy-MM-dd");
  const companyKey = getCompanyFolder(companyId, companyName);
  const uniqueName = `${Date.now()}_${safeFileName(fileName)}`;
  return `companies/${companyKey}/vouchers/${voucherType}/${year}/${month}/${day}/${voucherId}/${uniqueName}`;
};

const generateUnassignedPath = (
  companyId: string,
  companyName: string | undefined,
  fileName: string,
  uploadDate?: Date
) => {
  const d = uploadDate || new Date();
  const year = format(d, "yyyy");
  const month = format(d, "MM");
  const date = format(d, "yyyy-MM-dd");
  const companyKey = getCompanyFolder(companyId, companyName);
  const uniqueName = `${Date.now()}_${safeFileName(fileName)}`;
  return `companies/${companyKey}/unassigned/${year}/${month}/${date}/${uniqueName}`;
};

/** Client-side upload for unassigned docs. Use in Gallery for static/APK build. */
export async function uploadFileClient(
  fileData: { name: string; type: string; arrayBuffer: ArrayBuffer },
  companyId: string,
  companyName: string | undefined,
  uploadDate?: Date
): Promise<{ success: true; url: string; path: string } | { success: false; error: string }> {
  try {
    if (!companyId) throw new Error("Company ID is missing");
    const fullPath = generateUnassignedPath(companyId, companyName, fileData.name, uploadDate || new Date());
    const fileRef = ref(storage, fullPath);
    // Browser: use Uint8Array (Buffer is Node-only)
    const bytes = new Uint8Array(fileData.arrayBuffer);
    await uploadBytes(fileRef, bytes, { contentType: fileData.type });
    const downloadURL = await getDownloadURL(fileRef);
    return { success: true, url: downloadURL, path: fullPath };
  } catch (error: any) {
    console.error("Firebase Upload Error:", error);
    return { success: false, error: error.message || "Upload failed" };
  }
}

/** Client-side delete. Use in Gallery for static/APK build. */
export async function deleteFileFromStorageClient(path: string): Promise<{ success: boolean; error?: string }> {
  try {
    const fileRef = ref(storage, path);
    await deleteObject(fileRef);
    return { success: true };
  } catch (error: any) {
    if (error.code === "storage/object-not-found") {
      return { success: true };
    }
    console.error("Delete error:", error);
    return { success: false, error: error.message };
  }
}

/** Client-side move files from unassigned to voucher. Used by AddVoucherDialog attach flow. */
export async function moveFilesToVoucherDateClient({
  companyId,
  companyName,
  voucherType,
  voucherDate,
  voucherId,
  files,
}: {
  companyId: string;
  companyName: string | undefined;
  voucherType: string;
  voucherDate: Date;
  voucherId: string;
  files: { oldPath: string; fileName: string }[];
}): Promise<{ success: boolean; moved?: Array<{ oldPath: string; newPath: string; url: string; success: boolean; error?: string }>; error?: string }> {
  const movePromises = files.map(async (file) => {
    try {
      const newPath = generateVoucherPath(companyId, companyName, voucherType, voucherDate, voucherId, file.fileName);
      const oldFileRef = ref(storage, file.oldPath);
      const newFileRef = ref(storage, newPath);
      const blob = await getBlob(oldFileRef);
      await uploadBytes(newFileRef, blob);
      const newUrl = await getDownloadURL(newFileRef);
      await deleteObject(oldFileRef);
      return { oldPath: file.oldPath, newPath, url: newUrl, success: true };
    } catch (error: any) {
      console.error(`Failed to move file from ${file.oldPath}:`, error);
      try {
        const oldUrl = await getDownloadURL(ref(storage, file.oldPath));
        return { oldPath: file.oldPath, newPath: file.oldPath, url: oldUrl, success: false, error: error.message };
      } catch (e) {
        return { oldPath: file.oldPath, newPath: file.oldPath, url: "", success: false, error: (e as Error).message };
      }
    }
  });
  try {
    const movedFiles = await Promise.all(movePromises);
    return { success: true, moved: movedFiles };
  } catch (err) {
    return { success: false, error: "An unexpected error occurred during file move." };
  }
}
