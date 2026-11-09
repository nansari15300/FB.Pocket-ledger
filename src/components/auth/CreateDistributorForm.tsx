

"use client";

import { addDoc, updateDoc } from "@/lib/writeGateway/pbWrites";
import { useForm, SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { firestore, storage } from "@/lib/plClientSession";
import { collection, serverTimestamp, query, where, doc } from "@/lib/pbCompat/firestore";
import { getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { ref, uploadBytes, getDownloadURL } from "@/lib/pocketbaseData/pbStorage";
import { Loader2, Upload, Trash2, FileText, PlusCircle, Eye, EyeOff } from "lucide-react";
import Image from "next/image";
import { useState, useRef, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { FilePreview } from "@/components/vouchers/FilePreview";
import { compressFile } from "@/lib/compression";
import { compressImageForCompany, attachmentImageStillTooLargeToastFields } from "@/lib/attachmentCompressionUi";
import { RestrictedFileUploader } from "../ui/RestrictedFileUploader";
import { AttachmentHoldPasteSurface } from "@/components/vouchers/AttachmentHoldPasteSurface";
import { syntheticFileInputChangeEvent } from "@/lib/syntheticFileInputChangeEvent";


const formSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters."),
  phone: z.string().min(10, "Please enter a valid phone number."),
  pan: z.string().optional(),
  address: z.string().min(5, "Please enter a complete address."),
  email: z.string().email(),
  password: z.string().min(6, "Password must be at least 6 characters.").optional(),
});

type FormValues = z.infer<typeof formSchema>;

const MAX_FILE_SIZE_MB = 0.5;

export function CreateDistributorForm({ application, onApplicationUpdated, onApplicationCreated }: { application?: any, onApplicationUpdated?: () => void, onApplicationCreated?: () => void }) {
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [profilePicPreview, setProfilePicPreview] = useState<string | null>(null);
  const [documentFiles, setDocumentFiles] = useState<(File | string)[]>([]);
  const profilePicInputRef = useRef<HTMLInputElement>(null);
  const documentsInputRef = useRef<HTMLInputElement>(null);
  const [profilePicFile, setProfilePicFile] = useState<File | null>(null);
  const isEditing = !!application;
  const [showPassword, setShowPassword] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", phone: "", pan: "", address: "", email: "" },
  });

  useEffect(() => {
    if (isEditing && application) {
      form.reset(application);
      setProfilePicPreview(application.profilePic || null);
      setDocumentFiles(application.documents || []);
    } else if (user) {
      form.setValue("email", user.email || "");
      form.setValue("name", user.displayName || "");
    }
  }, [user, form, application, isEditing]);


  const handleProfilePicChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setProfilePicFile(file);
      setProfilePicPreview(URL.createObjectURL(file));
    }
  };

  const handleDocumentsChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const newFiles = Array.from(e.target.files);

    for (const file of newFiles) {
      if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        toast({ variant: "destructive", title: "File Too Large", description: `Please select files smaller than ${MAX_FILE_SIZE_MB}MB.` });
        continue;
      }
      if (documentFiles.length < 3) {
        const { file: compressed, maxBytes, maxKb } = await compressImageForCompany(file, null);
        setDocumentFiles(prev => [...prev, compressed]);
      } else {
        toast({ variant: "destructive", title: "Limit Reached", description: "You can upload a maximum of 3 documents."});
        break;
      }
    }
  };

  const removeDocument = (index: number) => {
    setDocumentFiles(prev => prev.filter((_, i) => i !== index));
  };


  const onSubmit: SubmitHandler<FormValues> = async (data) => {
    if (!user) {
      toast({ variant: "destructive", title: "Authentication Error", description: "You must be logged in to apply." });
      return;
    }
    setIsLoading(true);
    try {
      let profilePicUrl = profilePicPreview;
      if (profilePicFile) {
        const storageRef = ref(storage, `distributor-applications/${user.uid}/profile_${profilePicFile.name}`);
        await uploadBytes(storageRef, profilePicFile);
        profilePicUrl = await getDownloadURL(storageRef);
      }

      const existingUrls = documentFiles.filter(f => typeof f === 'string') as string[];
      const newFiles = documentFiles.filter(f => f instanceof File) as File[];

      const newUrls = await Promise.all(
        newFiles.map(async (file) => {
           const docRef = ref(storage, `distributor-applications/${user.uid}/documents/${Date.now()}_${file.name}`);
           await uploadBytes(docRef, file);
           return getDownloadURL(docRef);
        })
      );
      
      const allDocumentUrls = [...existingUrls, ...newUrls];
      
      const { ...restData } = data;

      if (isEditing) {
        await updateDoc(doc(firestore, "distributor_applications", application.id), {
            ...restData,
            profilePic: profilePicUrl,
            documents: allDocumentUrls,
        });
        toast({ title: "Application Updated!", description: "The application has been successfully updated." });
        onApplicationUpdated?.();
      } else {
         await addDoc(collection(firestore, "distributor_applications"), {
            userId: user.uid,
            ...restData,
            profilePic: profilePicUrl,
            documents: allDocumentUrls,
            status: "pending",
            submittedAt: serverTimestamp(),
          });
          toast({ title: "Application Submitted!", description: "Your application is under review." });
          onApplicationCreated?.();
      }

    } catch (error) {
      console.error("Error submitting application:", error);
      toast({ variant: "destructive", title: "Submission Failed", description: "An error occurred. Please try again." });
    } finally {
      setIsLoading(false);
    }
  };

  if (authLoading) {
    return <div className="flex justify-center items-center h-full"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }
  
  const formId = `distributor-form-${application?.id || 'new'}`;

  return (
    <Form {...form}>
        <form id={formId} onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <FormField
                control={form.control} name="name" render={({ field }: any) => (
                <FormItem>
                    <FormLabel>Full Name</FormLabel>
                    <FormControl><Input placeholder="e.g., John Doe" {...field} /></FormControl>
                    <FormMessage />
                </FormItem>
                )}
            />
            <FormField
                control={form.control} name="phone" render={({ field }: any) => (
                <FormItem>
                    <FormLabel>Phone Number</FormLabel>
                    <FormControl><Input placeholder="e.g., 98XXXXXXXX" {...field} /></FormControl>
                    <FormMessage />
                </FormItem>
                )}
            />
            <FormField
                control={form.control} name="pan" render={({ field }: any) => (
                <FormItem>
                    <FormLabel>PAN Number</FormLabel>
                    <FormControl><Input placeholder="Enter your PAN" {...field} /></FormControl>
                    <FormMessage />
                </FormItem>
                )}
            />
            <FormField
                control={form.control} name="email" render={({ field }: any) => (
                <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl><Input type="email" placeholder="you@example.com" {...field} disabled /></FormControl>
                    <FormMessage />
                </FormItem>
                )}
            />
            </div>
            
             <FormField
                control={form.control}
                name="password"
                render={({ field }: any) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <div className="relative">
                      <FormControl>
                        <Input
                          type={showPassword ? "text" : "password"}
                          placeholder="Create a password for your account"
                          {...field}
                        />
                      </FormControl>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

            <FormField
            control={form.control} name="address" render={({ field }: any) => (
                <FormItem>
                <FormLabel>Full Address</FormLabel>
                <FormControl><Textarea placeholder="Your detailed address..." {...field} /></FormControl>
                <FormMessage />
                </FormItem>
            )}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <FormItem>
                    <FormLabel>Profile Picture</FormLabel>
                    <RestrictedFileUploader>
                        <div className="flex items-center gap-4">
                            <FilePreview file={profilePicPreview || ""} onRemove={() => { setProfilePicPreview(null); setProfilePicFile(null); }} />
                            <Button type="button" variant="outline" onClick={() => profilePicInputRef.current?.click()}>Upload Image</Button>
                            <Input type="file" className="hidden" ref={profilePicInputRef} onChange={handleProfilePicChange} accept="image/*" />
                        </div>
                    </RestrictedFileUploader>
                    <FormMessage />
                </FormItem>
            <FormItem>
                <FormLabel>Official Documents (Max 3)</FormLabel>
                <RestrictedFileUploader>
                    <div className="flex flex-wrap gap-4">
                        {documentFiles.map((file, index) => (
                        <FilePreview key={index} file={file} onRemove={() => removeDocument(index)} />
                        ))}
                        {documentFiles.length < 3 && (
                          <AttachmentHoldPasteSurface
                            enabled={documentFiles.length < 3}
                            onShortActivate={() => documentsInputRef.current?.click()}
                            onPastedFiles={(incoming) =>
                              void handleDocumentsChange(syntheticFileInputChangeEvent(incoming))
                            }
                            className="relative flex h-24 w-24 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed text-muted-foreground transition-colors hover:border-primary"
                          >
                            <PlusCircle className="h-6 w-6" />
                            <span className="mt-1 text-xs">Add File(s)</span>
                            <Input
                              type="file"
                              className="hidden"
                              ref={documentsInputRef}
                              onChange={handleDocumentsChange}
                              accept="image/*,application/pdf"
                              multiple
                            />
                          </AttachmentHoldPasteSurface>
                        )}
                    </div>
                </RestrictedFileUploader>
            </FormItem>
            </div>
             <div className="flex justify-end pt-4">
                 <Button type="submit" form={formId} disabled={isLoading} className="w-full md:w-auto">
                    {isLoading && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    {isEditing ? "Update Application" : "Submit Application"}
                </Button>
            </div>
        </form>
    </Form>
  );
}
