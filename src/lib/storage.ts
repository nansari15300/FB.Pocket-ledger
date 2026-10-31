/**
 * Firebase Storage helpers. No "use server" - works in browser for static export.
 * Buffer.from replaced with Uint8Array for client compatibility.
 */
import { ref, uploadBytes, getDownloadURL, deleteObject, getBlob } from "@/lib/pocketbaseData/pbStorage";
import { storage } from "./firebase";
import { format } from "date-fns";
import { shouldStageEntityProfileFilesLocally } from "@/lib/entityProfileLocalFiles";
import {
  buildCompanyLogoStorageObjectPath,
  resolveCompanyUsesPocketLedgerStorage,
} from "@/lib/firebaseStoragePaths";

type ActionState = {
  returnPath: string;
  uid: string;
  email?: string;
  formData: any;
};

// --- HELPERS ---
const slugify = (text: string = "") =>
  text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w-]/g, "") // remove special chars
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

// --- PATH BUILDERS (NEW STRUCTURE) ---

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

const generateCategoryPath = (
    companyId: string,
    companyName: string | undefined,
    category: "avatar" | "stamp" | "other",
    fileName: string,
    uploadDate?: Date
) => {
    const d = uploadDate || new Date();
    const year = format(d, "yyyy");
    const month = format(d, "MM");
    const date = format(d, "yyyy-MM-dd");
    const companyKey = getCompanyFolder(companyId, companyName);
    const uniqueName = `${Date.now()}_${safeFileName(fileName)}`;

    return `companies/${companyKey}/${category}/${year}/${month}/${date}/${uniqueName}`;
}


// --- COMPANY LOGO (Edit / Create company) ---

/** Firebase Storage path allowed by `storage.rules` under `companies/{companyKey}/avatar/...`. */
export function buildCompanyLogoStoragePath(
  companyId: string,
  companyName: string | undefined,
  fileName: string,
  uploadDate?: Date
): string {
  return generateCategoryPath(companyId, companyName, "avatar", fileName, uploadDate);
}

export async function uploadCompanyLogo(
  companyId: string,
  companyName: string | undefined,
  file: File,
  options?: { usePocketLedger?: boolean }
): Promise<string> {
  if (!companyId) throw new Error("Company ID is missing");
  if (await shouldStageEntityProfileFilesLocally(companyId)) {
    throw new Error("local_company_storage");
  }
  const usePocketLedger =
    options?.usePocketLedger === true ||
    (options?.usePocketLedger !== false && (await resolveCompanyUsesPocketLedgerStorage(companyId)));
  const fullPath = usePocketLedger
    ? buildCompanyLogoStorageObjectPath(companyId, true, file.name)
    : buildCompanyLogoStoragePath(companyId, companyName, file.name);
  const fileRef = ref(storage, fullPath);
  const body =
    typeof Buffer !== "undefined"
      ? Buffer.from(await file.arrayBuffer())
      : new Uint8Array(await file.arrayBuffer());
  await uploadBytes(fileRef, body, { contentType: file.type || "image/jpeg" });
  return getDownloadURL(fileRef);
}

export async function tryDeleteStorageFileByUrl(url: string): Promise<void> {
  const { tryGetStoragePathFromFirebaseDownloadUrl } = await import("@/lib/firebaseStorageDownloadUrl");
  const path = tryGetStoragePathFromFirebaseDownloadUrl(url);
  if (!path) return;
  try {
    await deleteObject(ref(storage, path));
  } catch {
    // Already deleted or not ours
  }
}

// --- CORE FUNCTIONS (UPDATED) ---

export const uploadFile = async (
  fileData: { name: string; type: string; arrayBuffer: ArrayBuffer },
  companyId: string,
  companyName: string | undefined,
  category: "vouchers" | "unassigned" | "avatar" | "stamp" | "other",
  subCategory?: string, // e.g., voucher type like 'sale'
  voucherDate?: Date, // Required for voucher uploads
  voucherId?: string,
  uploadDate?: Date // For unassigned/avatar/stamp/other (default: now)
) => {
  try {
    if (!companyId) throw new Error("Company ID is missing");
    if (await shouldStageEntityProfileFilesLocally(companyId)) {
      return {
        success: false,
        error:
          "Local company files use device storage and Google Drive sync — not Firebase Storage.",
      };
    }

    let fullPath: string;
    if (category === "vouchers") {
        if (!subCategory || !voucherDate || !voucherId) {
            throw new Error("Voucher type, date, and ID are required for voucher file uploads.");
        }
        fullPath = generateVoucherPath(companyId, companyName, subCategory, voucherDate, voucherId, fileData.name);
    } else if (category === "unassigned") {
        fullPath = generateUnassignedPath(companyId, companyName, fileData.name, uploadDate || new Date());
    } else if (category === "avatar" || category === "stamp" || category === "other") {
        fullPath = generateCategoryPath(companyId, companyName, category, fileData.name, uploadDate || new Date());
    } else {
        const uniqueName = `${Date.now()}_${safeFileName(fileData.name)}`;
        const companyKey = getCompanyFolder(companyId, companyName);
        fullPath = `companies/${companyKey}/${category}/${uniqueName}`;
    }

    const fileRef = ref(storage, fullPath);
    const buffer = typeof Buffer !== "undefined" ? Buffer.from(fileData.arrayBuffer) : new Uint8Array(fileData.arrayBuffer);
    await uploadBytes(fileRef, buffer, { contentType: fileData.type });
    const downloadURL = await getDownloadURL(fileRef);

    return { success: true, url: downloadURL, path: fullPath };
  } catch (error: any) {
    console.error("Firebase Upload Error:", error);
    return { success: false, error: error.message || "Upload failed" };
  }
};


export const moveFilesToVoucherDate = async ({
    companyId,
    companyName,
    voucherType,
    voucherDate,
    voucherId,
    files
}: {
    companyId: string;
    companyName: string | undefined;
    voucherType: string;
    voucherDate: Date;
    voucherId: string;
    files: { oldPath: string; fileName: string }[];
}) => {
    const movePromises = files.map(async (file) => {
        try {
            const newPath = generateVoucherPath(companyId, companyName, voucherType, voucherDate, voucherId, file.fileName);
            const oldFileRef = ref(storage, file.oldPath);
            const newFileRef = ref(storage, newPath);

            // Download -> Re-upload -> Delete
            const blob = await getBlob(oldFileRef);
            await uploadBytes(newFileRef, blob);
            const newUrl = await getDownloadURL(newFileRef);
            await deleteObject(oldFileRef);
            
            return { oldPath: file.oldPath, newPath: newPath, url: newUrl, success: true };
        } catch (error: any) {
             console.error(`Failed to move file from ${file.oldPath}:`, error);
             // If move fails, try to get the original URL to prevent data loss
             try {
                const oldUrl = await getDownloadURL(ref(storage, file.oldPath));
                return { oldPath: file.oldPath, newPath: file.oldPath, url: oldUrl, success: false, error: error.message };
             } catch(e) {
                 return { oldPath: file.oldPath, newPath: file.oldPath, url: '', success: false, error: "Failed to move and could not retrieve original URL." };
             }
        }
    });

    try {
        const movedFiles = await Promise.all(movePromises);
        return { success: true, moved: movedFiles };
    } catch(err) {
        return { success: false, error: "An unexpected error occurred during file move." }
    }
}


export const deleteFileFromStorage = async (path: string) => {
  try {
    const fileRef = ref(storage, path);
    await deleteObject(fileRef);
    return { success: true };
  } catch (error: any) {
    // If file not found, it might have been already deleted. Consider it a success.
    if (error.code === 'storage/object-not-found') {
        console.warn(`File not found during deletion (might be already deleted): ${path}`);
        return { success: true };
    }
    console.error("Delete error:", error);
    return { success: false, error: error.message };
  }
};
