
"use client";

import { useState, useEffect, useRef } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { getGatewayKeys } from "@/ai/flows/gateway-keys";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, CalendarIcon, Upload, Trash2, FileText, PlusCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useDate } from "@/hooks/useDate";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Calendar } from "../ui/calendar";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { FilePreview } from "../vouchers/FilePreview";
import { compressFile } from "@/lib/compression";
import { compressImageForCompany, attachmentImageStillTooLargeToastFields } from "@/lib/attachmentCompressionUi";
import { AttachmentHoldPasteSurface } from "@/components/vouchers/AttachmentHoldPasteSurface";
import { syntheticFileInputChangeEvent } from "@/lib/syntheticFileInputChangeEvent";


const fileSchema = z.object({
  file: z.custom<File | null>().optional(),
});

const formSchema = z.object({
  payeeName: z.string(),
  payeeId: z.string(),
  fromAccount: z.string().min(1, "Please select a bank account."),
  amount: z.number().min(1, "Amount must be greater than zero."),
  date: z.date(),
  voucherNumber: z.string().min(1, "Voucher number is required."),
  narration: z.string().optional(),
  files: z.array(fileSchema).optional(),
});

type FormValues = z.infer<typeof formSchema>;

const MAX_FILE_SIZE_MB = 0.5;

export function CommissionPayoutDialog({
  agent,
  isOpen,
  onOpenChange,
  onVoucherCreated,
}: {
  agent: any;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onVoucherCreated: () => void;
}) {
  const [bankAccounts, setBankAccounts] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { formatCurrency } = useDate();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<(File | string)[]>([]);


  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      payeeName: agent?.name || "",
      payeeId: agent?.id || "",
      amount: agent?.commissionBalance || 0,
      date: new Date(),
      voucherNumber: "",
    },
  });

  useEffect(() => {
    if (agent) {
      form.reset({
        payeeName: agent.name,
        payeeId: agent.id,
        amount: agent.commissionBalance || 0,
        date: new Date(),
        voucherNumber: "",
        fromAccount: "",
        narration: "",
      });
       setFiles([]);
    }
  }, [agent, form]);

  useEffect(() => {
    async function fetchBankAccounts() {
      try {
        const keys = await getGatewayKeys();
        const availableAccounts = [];
        if (keys.stripeSecretKey) availableAccounts.push("Stripe");
        if (keys.khaltiPublicKey) availableAccounts.push("Khalti");
        if (keys.esewaMerchantCode) availableAccounts.push("eSewa");
        setBankAccounts(availableAccounts);
      } catch (error) {
        toast({
          variant: "destructive",
          title: "Error",
          description: "Could not load bank accounts.",
        });
      }
    }
    if (isOpen) {
      fetchBankAccounts();
    }
  }, [isOpen, toast]);

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const newFiles = Array.from(e.target.files);
    
    for (const file of newFiles) {
       if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
          toast({
            variant: "destructive",
            title: "File Too Large",
            description: `Please select a file smaller than ${MAX_FILE_SIZE_MB}MB.`,
          });
          continue;
        }
      if (files.length < 3) {
        const { file: compressedFile, maxBytes, maxKb } = await compressImageForCompany(file, null);
        setFiles(prev => [...prev, compressedFile]);
      } else {
        toast({ variant: "destructive", title: "Limit Reached", description: "You can only upload up to 3 files."});
        break;
      }
    }
  };

  const onSubmit = async (data: FormValues) => {
    setIsSubmitting(true);
    // In a real app, you would process the payment here.
    // For now, we just simulate a delay and show a success message.
    await new Promise((resolve) => setTimeout(resolve, 1500));

    toast({
      title: "Payout Successful",
      description: `Paid ${formatCurrency(data.amount)} to ${data.payeeName}.`,
    });
    setIsSubmitting(false);
    onVoucherCreated();
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Commission Payout</DialogTitle>
          <DialogDescription>
            Create a payment voucher to pay commission to the distributor.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField
                control={form.control}
                name="payeeName"
                render={({ field }: any) => (
                  <FormItem>
                    <FormLabel>Pay To (Distributor)</FormLabel>
                    <FormControl>
                      <Input {...field} readOnly className="bg-muted" />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="fromAccount"
                render={({ field }: any) => (
                  <FormItem>
                    <FormLabel>From Account (Payer)</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a bank account" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {bankAccounts.map((acc) => (
                          <SelectItem key={acc} value={acc}>
                            {acc}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="amount"
                render={({ field }: any) => (
                  <FormItem>
                    <FormLabel>Amount</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
               <FormField
                  control={form.control}
                  name="voucherNumber"
                  render={({ field }: any) => (
                    <FormItem>
                      <FormLabel>Voucher No.</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. CP-001" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              <FormField
                control={form.control}
                name="date"
                render={({ field }: any) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Payment Date</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant={"outline"}
                            className={cn(
                              "w-full pl-3 text-left font-normal",
                              !field.value && "text-muted-foreground"
                            )}
                          >
                            {field.value ? (
                              format(field.value, "PPP")
                            ) : (
                              <span>Pick a date</span>
                            )}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={field.value}
                          onSelect={field.onChange}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="narration"
              render={({ field }: any) => (
                <FormItem>
                  <FormLabel>Narration</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="e.g. Commission payout for May 2024"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormItem>
                <FormLabel>Attach Files (Optional)</FormLabel>
                 <div className="flex flex-wrap gap-4">
                  {files.map((file, index) => (
                    <FilePreview key={index} file={file} onRemove={() => setFiles(prev => prev.filter((_, i) => i !== index))} />
                  ))}
                  {files.length < 3 && (
                    <AttachmentHoldPasteSurface
                      enabled
                      onShortActivate={() => fileInputRef.current?.click()}
                      onPastedFiles={(incoming) => void handleFileChange(syntheticFileInputChangeEvent(incoming))}
                      voucherAttachmentReuse={{ currentFiles: files, setFiles, maxFiles: 3 }}
                      className="relative w-24 h-24 border-2 border-dashed rounded-lg flex flex-col justify-center items-center text-muted-foreground hover:border-primary transition-colors cursor-pointer"
                    >
                      <PlusCircle className="h-6 w-6" />
                      <span className="text-xs mt-1">Add File</span>
                      <Input
                        type="file"
                        className="hidden"
                        ref={fileInputRef}
                        onChange={handleFileChange}
                        accept="image/*,application/pdf"
                        multiple
                      />
                    </AttachmentHoldPasteSurface>
                  )}
                </div>
              </FormItem>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Create Voucher
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
