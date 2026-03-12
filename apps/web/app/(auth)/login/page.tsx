"use client";

import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "../../../lib/auth-context";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Image from "next/image";
import api from "../../../lib/api-client";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(4)
});

export default function LoginPage() {
  const { register, handleSubmit, formState } = useForm({ resolver: zodResolver(schema) });
  const { login } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [verifyEmail, setVerifyEmail] = useState("");
  const [verifyOtp, setVerifyOtp] = useState("");
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifySuccess, setVerifySuccess] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  const onSubmit = async (values: any) => {
    setError(null);
    try {
      await login(values.email, values.password);
      router.push("/");
    } catch (err: any) {
      setError("Invalid credentials");
    }
  };

  const onVerifyOtp = async () => {
    if (!verifyEmail || !verifyOtp) return;
    setVerifyError(null);
    setVerifySuccess(null);
    setIsVerifying(true);
    try {
      await api.post("/users/verify-email-otp", {
        email: verifyEmail,
        otp: verifyOtp
      });
      setVerifySuccess("Email verified. You can sign in now.");
      setVerifyOtp("");
    } catch (err: any) {
      setVerifyError(err?.message || "Verification failed");
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center px-4">
      <div className="glass p-8 rounded-2xl w-full max-w-md">
        <div className="flex items-center gap-3 mb-6">
          <Image src="/logo.svg" alt="Signature Auto Care" width={56} height={56} className="w-14 h-14 rounded" />
          <div>
            <p className="font-semibold text-lg">Signature Auto Care</p>
            <p className="text-xs text-muted-foreground">Operations Console</p>
          </div>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="text-sm text-muted-foreground">Email</label>
            <input
              type="email"
              {...register("email")}
              className="mt-1 w-full rounded-lg border border-border bg-muted px-3 py-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div>
            <label className="text-sm text-muted-foreground">Password</label>
            <input
              type="password"
              {...register("password")}
              className="mt-1 w-full rounded-lg border border-border bg-muted px-3 py-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          {error && <p className="text-sm text-[var(--danger-text)]">{error}</p>}
          <button
            type="submit"
            className="w-full rounded-lg bg-gradient-to-r from-brand.red to-brand.blue py-2 font-semibold text-white shadow-sm"
            disabled={formState.isSubmitting}
          >
            {formState.isSubmitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
        <div className="mt-6 space-y-2 border-t border-border pt-4">
          <p className="text-sm font-semibold text-foreground">Verify email with OTP</p>
          <input
            type="email"
            value={verifyEmail}
            onChange={(e) => setVerifyEmail(e.target.value)}
            placeholder="Email"
            className="w-full rounded-lg border border-border bg-muted px-3 py-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <input
            value={verifyOtp}
            onChange={(e) => setVerifyOtp(e.target.value)}
            placeholder="6-digit OTP"
            className="w-full rounded-lg border border-border bg-muted px-3 py-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
          {verifyError && <p className="text-xs text-[var(--danger-text)]">{verifyError}</p>}
          {verifySuccess && <p className="text-xs text-[var(--success-text)]">{verifySuccess}</p>}
          <button
            type="button"
            onClick={onVerifyOtp}
            className="w-full rounded-lg border border-border bg-card py-2 font-semibold shadow-sm hover:bg-muted"
            disabled={isVerifying}
          >
            {isVerifying ? "Verifying..." : "Verify OTP"}
          </button>
        </div>
      </div>
    </div>
  );
}
