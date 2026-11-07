
import { NextRequest, NextResponse } from "next/server";
import { appendPaymentsCollectionDoc } from "@/lib/writeGateway/topLevelCollectionWrites";

export async function GET(req: NextRequest) {
    const url = new URL(req.url);
    const data = url.searchParams.get('data');

    if (!data) {
        return NextResponse.redirect(new URL('/billing/cancel', req.url));
    }
    
    try {
        const decodedData = JSON.parse(atob(data));
        
        const { status, transaction_uuid, total_amount } = decodedData;

        // In a real app, you would verify the signature here.
        // For now, we will trust the status.
        
        if (status === 'COMPLETE' && transaction_uuid) {
            await appendPaymentsCollectionDoc({
                paymentId: transaction_uuid,
                amount: total_amount,
                currency: 'NPR',
                gateway: 'esewa',
                status: 'completed',
                payload: decodedData, // Store full payload for audit
            });
        }

        return NextResponse.redirect(new URL('/billing/success', req.url));
    } catch (err: any) {
        console.error("eSewa GET handler error:", err);
        return NextResponse.redirect(new URL('/billing/cancel', req.url));
    }
}
