"use client";

import { numToWords } from "@/lib/number-to-words";
import { useCompany } from "@/hooks/useCompany";
import { useDate } from "@/hooks/useDate";
import { firestore } from "@/lib/firebase";
import { doc, Timestamp } from "firebase/firestore";
import { onSnapshot, getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { useParams } from "next/navigation";
import { useEffect, useState, useRef, useCallback } from "react";
import { Loader2 } from "lucide-react";
import Image from "next/image";
import { format as formatDateFns } from "date-fns";
import type { Party } from "@/components/party/types";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";
import { shouldUseInAppPdfPreviewOverlay } from "@/lib/shouldUseInAppPdfPreview";
import { showInAppPdfPreview } from "@/lib/inAppPdfPreview";
import { openPdfBlobInExternalViewer, shouldOpenPdfInExternalViewer } from "@/lib/openPdfExternal";
import { isStaticAppBuild } from "@/lib/isStaticAppBuild";
import { getCompanyDocFromBrowserDb } from "@/lib/localCompanyDocMirror";

type LineItem = { itemId: string; quantity: number; rate: number; amount: number };
type Invoice = {
  id: string; partyId?: string; voucherNumber: string; date: Timestamp;
  lineItems: LineItem[]; subTotal: number; discount: number; tax: number; total: number; narration?: string;
};

export function InvoicePageClient() {
  const params = useParams();
  const { id } = params;
  const { company, companyId } = useCompany();
  const { formatDate, formatDateBS } = useDate();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [party, setParty] = useState<Party | null>(null);
  const [itemsData, setItemsData] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const invoiceRef = useRef<HTMLDivElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const generateAndDisplayPdf = useCallback(async () => {
    if (!invoiceRef.current || isGenerating || !invoice || !company) return;
    setIsGenerating(true);
    const { default: html2pdf } = await import("html2pdf.js");
    const opt = {
      margin: [10, 10, 10, 10] as [number, number, number, number],
      filename: `invoice_${invoice?.voucherNumber || "invoice"}.pdf`,
      image: { type: "jpeg" as const, quality: 1 },
      html2canvas: { scale: 3, useCORS: true },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" as const, compress: true },
    };
    html2pdf().from(invoiceRef.current).set(opt).toPdf().get("pdf")
      .then((pdf: any) => {
        const blob = pdf.output("blob") as Blob;
        const name = `invoice_${invoice?.voucherNumber || "invoice"}.pdf`;
        // Mobile / native: turant bahar PDF viewer; baaki: overlay ya nayi tab
        if (shouldOpenPdfInExternalViewer()) {
          void openPdfBlobInExternalViewer(blob, name);
        } else if (shouldUseInAppPdfPreviewOverlay()) {
          const url = URL.createObjectURL(blob);
          showInAppPdfPreview(url, () => URL.revokeObjectURL(url), { title: "Invoice", fileName: name });
        } else {
          const url = URL.createObjectURL(blob);
          window.open(url, "_blank");
        }
      })
      .finally(() => setIsGenerating(false));
  }, [invoice, company, isGenerating]);

  useEffect(() => {
    if (!id || !companyId) { setLoading(false); return; }
    setLoading(true);

    const enrichPartyAndItemsFromBrowser = async (invoiceData: Invoice) => {
      let associatedParty: Party | null = null;
      if (invoiceData.partyId) {
        const p = await getCompanyDocFromBrowserDb(companyId, "parties", invoiceData.partyId);
        if (p) associatedParty = p as Party;
      }
      const newItemsData: Record<string, any> = {};
      if (invoiceData.lineItems?.length) {
        for (const line of invoiceData.lineItems) {
          if (line.itemId) {
            const it = await getCompanyDocFromBrowserDb(companyId, "items", line.itemId);
            if (it) newItemsData[line.itemId] = it;
          }
        }
      }
      setParty(associatedParty);
      setItemsData(newItemsData);
    };

    const applyLocalInvoice = async (): Promise<boolean> => {
      if (!isStaticAppBuild()) return false;
      const local = await getCompanyDocFromBrowserDb(companyId, "vouchers", id as string);
      if (!local) return false;
      const invoiceData = { id: id as string, ...local } as Invoice;
      setInvoice(invoiceData);
      await enrichPartyAndItemsFromBrowser(invoiceData);
      return true;
    };

    // Static: cache se pehle dikhau jab tak snapshot na aaye / network fail ho.
    applyLocalInvoice().then(() => {});

    const unsubInvoice = onSnapshot(
      doc(firestore, `companies/${companyId}/vouchers`, id as string),
      async (docSnap) => {
        if (docSnap.exists()) {
          const invoiceData = { id: docSnap.id, ...docSnap.data() } as Invoice;
          let associatedParty = null;
          if (invoiceData.partyId) {
            const partySnap = await getDoc(doc(firestore, `companies/${companyId}/parties`, invoiceData.partyId));
            if (partySnap.exists()) associatedParty = partySnap.data() as Party;
            else if (isStaticAppBuild()) {
              const p = await getCompanyDocFromBrowserDb(companyId, "parties", invoiceData.partyId);
              if (p) associatedParty = p as Party;
            }
          }
          let newItemsData: Record<string, any> = {};
          if (invoiceData.lineItems?.length) {
            for (const item of invoiceData.lineItems) {
              if (item.itemId) {
                const itemSnap = await getDoc(doc(firestore, `companies/${companyId}/items`, item.itemId));
                if (itemSnap.exists()) newItemsData[item.itemId] = itemSnap.data();
                else if (isStaticAppBuild()) {
                  const it = await getCompanyDocFromBrowserDb(companyId, "items", item.itemId);
                  if (it) newItemsData[item.itemId] = it;
                }
              }
            }
          }
          setInvoice(invoiceData); setParty(associatedParty); setItemsData(newItemsData);
        } else if (isStaticAppBuild()) {
          // Firestore cache miss: ho sakta hai local mirror mein ho (offline / delayed rules).
          await applyLocalInvoice();
        }
        setLoading(false);
      },
      async () => {
        await applyLocalInvoice();
        setLoading(false);
      }
    );
    return () => unsubInvoice();
  }, [id, companyId]);

  if (loading) return <div className="flex h-screen w-screen flex-col gap-4 items-center justify-center bg-gray-50 text-black"><Loader2 className="h-12 w-12 animate-spin text-primary" /><p className="text-lg font-medium text-muted-foreground">Loading Invoice Data...</p></div>;
  if (!invoice) return <div className="flex h-screen w-screen flex-col gap-4 items-center justify-center bg-gray-50 text-black"><p className="text-lg font-medium text-red-500">Invoice not found.</p></div>;

  const invoiceDate = invoice.date.toDate();
  const taxableValue = invoice.subTotal - invoice.discount;
  const TOTAL_ROWS = 15;

  return (
    <div className="bg-gray-50 py-4">
      <div className="mx-auto w-fit mb-4">
        <Button onClick={generateAndDisplayPdf} disabled={isGenerating}>
          {isGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4" />}
          Print to PDF
        </Button>
      </div>
      <div ref={invoiceRef} className="w-[210mm] h-[297mm] bg-white text-black mx-auto border border-black font-sans text-sm p-4 flex flex-col">
        <div className="flex items-center justify-between pb-2 border-b border-black">
          <div className="w-1/4"><Image src="https://picsum.photos/seed/bpslogo/150/50" alt="Company Logo" width={150} height={50} /></div>
          <div className="w-1/2 text-center">
            <h1 className="text-xl font-bold uppercase">{company?.name}</h1>
            <p className="text-xs">{company?.address}</p>
            <p className="text-xs">Ph.No: {company?.phone}</p>
            <p className="text-xs">VAT No.: {company?.pan}</p>
          </div>
          <div className="w-1/4 text-right"><h2 className="text-lg font-semibold underline">Tax Invoice</h2></div>
        </div>
        <div className="grid grid-cols-2 gap-x-4 mt-2 pb-2 text-xs border-b border-black">
          <div><p>Customer Name : {party?.name || "N/A"}</p><p>Pan / Vat No. : {party?.pan || "N/A"}</p><p>Customer Address : {party?.address || "N/A"}</p><p>Customer Cnt No. : {party?.phone || "N/A"}</p></div>
          <div><p>Invoice No. : {invoice.voucherNumber}</p><p>Date of Transaction : {formatDate(invoiceDate)}</p><p>Miti of Transaction : {formatDateBS(invoiceDate)}</p></div>
        </div>
        <div className="flex justify-between mt-1 pb-1 text-xs border-b border-black">
          <p><span className="font-semibold">Mode of Payment :</span> Cash/Cheque/Credit/Other</p>
          <p><span className="font-semibold">Bill Type :</span> Credit</p>
        </div>
        <div className="flex-grow">
          <table className="w-full text-xs border-collapse mt-2 table-fixed border-l border-r border-black">
            <thead>
              <tr>
                <th className="border border-black w-[5%]">S/N</th>
                <th className="border border-black w-[10%]">HS Code</th>
                <th className="border border-black w-[40%]">Particular</th>
                <th className="border border-black w-[10%]">Qty</th>
                <th className="border border-black w-[10%]">Unite</th>
                <th className="border border-black w-[10%]">Rate</th>
                <th className="border border-black w-[10%]">P.Disc</th>
                <th className="border border-black w-[15%]">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lineItems.map((item: any, index: number) => (
                <tr key={index}>
                  <td className="border border-black text-center">{index + 1}</td>
                  <td className="border border-black text-center">{itemsData[item.itemId]?.hsCode || ""}</td>
                  <td className="border border-black px-1">{itemsData[item.itemId]?.name || "Item Name"}</td>
                  <td className="border border-black text-center">{item.quantity.toFixed(2)}</td>
                  <td className="border border-black text-center">{item.unit}</td>
                  <td className="border border-black text-right px-1">{item.rate.toFixed(2)}</td>
                  <td className="border border-black text-right px-1">0.00</td>
                  <td className="border border-black text-right px-1">{item.amount.toFixed(2)}</td>
                </tr>
              ))}
              {Array.from({ length: Math.max(0, TOTAL_ROWS - invoice.lineItems.length) }).map((_, i) => (
                <tr key={`pad-${i}`} className="h-6">
                  {[...Array(8)].map((_, j) => <td key={j} className="border-x border-black"></td>)}
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-black">
              <tr>
                <td rowSpan={5} colSpan={3} className="border-r border-black p-1 align-top">
                  <div className="flex flex-col h-full">
                    <div className="border-b border-black p-1 flex-grow"><span className="font-semibold">Remarks:</span> {invoice.narration || 'N/A'}</div>
                    <div className="p-1 flex-grow"><span className="font-semibold not-italic">In Words:</span> <span className="italic">Rs. {numToWords(invoice.total)} Only</span></div>
                  </div>
                </td>
                <td colSpan={4} className="text-right p-1 font-medium border-x border-black">Basic Amount</td>
                <td className="text-right p-1 border-r border-black">{invoice.subTotal.toFixed(2)}</td>
              </tr>
              <tr><td colSpan={4} className="text-right p-1 font-medium border-x border-black">Discount</td><td className="text-right p-1 border-r border-black">{invoice.discount.toFixed(2)}</td></tr>
              <tr><td colSpan={4} className="text-right p-1 font-medium border-x border-black">Taxable Value</td><td className="text-right p-1 border-r border-black">{taxableValue.toFixed(2)}</td></tr>
              <tr><td colSpan={4} className="text-right p-1 font-medium border-x border-black">VAT 13%</td><td className="text-right p-1 border-r border-black">{invoice.tax.toFixed(2)}</td></tr>
              <tr className="font-bold border-b border-black"><td colSpan={4} className="text-right p-1 border-t border-x border-black">Net Amount</td><td className="text-right p-1 border-t border-r border-black">{invoice.total.toFixed(2)}</td></tr>
            </tfoot>
          </table>
        </div>
        <div className="mt-auto pt-4 text-xs">
          <div className="flex justify-between items-end">
            <div className="text-center"><p className="border-t border-dotted border-black w-32 pt-1">Received By</p></div>
            <div className="text-center"><p className="font-semibold">ISHWOR</p><p className="border-t border-dotted border-black w-32 pt-1">Prepared By</p></div>
            <div className="text-center"><p className="border-t border-dotted border-black w-40 pt-1">For : {company?.name}</p></div>
          </div>
          <p className="text-right mt-2">Print Date & Time : {formatDateFns(new Date(), "dd/MM/yyyy h:mm:ss a")}</p>
        </div>
      </div>
    </div>
  );
}
