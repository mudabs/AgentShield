import { Suspense } from "react";
import { ReceiptView } from "./receipt-view";

// The transaction hash is only known at request time, so the client view streams in
// after the static shell.
export default function ReceiptPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#080a0d]" />}>
      <ReceiptView />
    </Suspense>
  );
}
