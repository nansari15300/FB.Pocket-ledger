/**
 * Single choke point for the Firebase client SDK ("firebase/storage").
 * App code imports from here, never from "firebase/*" directly, so the SDK can be replaced
 * by a Pocket Ledger Server implementation in one place.
 */
export * from "firebase/storage";
