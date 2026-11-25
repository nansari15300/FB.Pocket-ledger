
import { NextRequest, NextResponse } from "next/server";
import { appendPaymentsCollectionDoc } from "@/lib/writeGateway/topLevelCollectionWrites";
import { mergeGatewayKeysWithEnv, type GatewayKeys } from "@/ai/flows/gateway-keys";
import { verifyEsewaPayment } from "@/lib/payments/esewaVerify";
import { pbBillingDb, pbBillingReady } from "@/lib/server/pbBilling/pbBillingDb";

/** Patch 12: merchant keys for the server-side eSewa check (saved Gateway keys, then env). */
async function loadEsewaKeys(): Promise<GatewayKeys> {
    let stored: Record<string, unknown> = {};
    if (pbBillingReady()) {
        try {
            const snap = await pbBillingDb().doc("app_settings/payment_gateways").get();
            if (snap.exists) stored = (snap.data() as Record<string, unknown>) || {};
        } catch {
            stored = {};
        }
    }
    return mergeGatewayKeysWithEnv(stored as GatewayKeys);
}

export async function GET(req: NextRequest) {
    const url = new URL(req.url);
    const data = url.searchParams.get('data');

    if (!data) {
        return NextResponse.redirect(new URL('/billing/cancel', req.url));
    }
    
    try {
        const decodedData = JSON.parse(atob(data));
        
        const { status, transaction_uuid, total_amount } = decodedData;

        if (status === 'COMPLETE' && transaction_uuid) {
            // Patch 12: never trust the redirect alone. Signature + eSewa status API first.
            const keys = await loadEsewaKeys();
            const check = await verifyEsewaPayment({
                decoded: decodedData as Record<string, unknown>,
                merchantCode: String(keys.esewaMerchantCode ?? ''),
                secretKey: String(keys.esewaSecretKey ?? ''),
                transactionUuid: String(transaction_uuid),
                totalAmount: total_amount,
            });
            if (check.ok === false) {
                // Kept for audit only: not "completed", nothing is activated from it.
                await appendPaymentsCollectionDoc({
                    paymentId: transaction_uuid,
                    amount: total_amount,
                    currency: 'NPR',
                    gateway: 'esewa',
                    status: 'unverified',
                    verified: false,
                    verifyError: check.error,
                    payload: decodedData,
                });
                return NextResponse.redirect(new URL('/billing/cancel', req.url));
            }
            await appendPaymentsCollectionDoc({
                paymentId: transaction_uuid,
                amount: total_amount,
                currency: 'NPR',
                gateway: 'esewa',
                status: 'completed',
                verified: true,
                esewaRefId: check.refId,
                payload: decodedData, // Store full payload for audit
            });
        }

        return NextResponse.redirect(new URL('/billing/success', req.url));
    } catch (err: any) {
        console.error("eSewa GET handler error:", err);
        return NextResponse.redirect(new URL('/billing/cancel', req.url));
    }
}
