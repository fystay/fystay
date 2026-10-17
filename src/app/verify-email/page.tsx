import type { Metadata } from "next";
import { VerifyEmailPanel } from "@/components/VerifyEmailPanel";

export const metadata: Metadata = { title: "Confirm your email", robots: { index: false } };

export default function VerifyEmailPage() {
  return <VerifyEmailPanel />;
}
