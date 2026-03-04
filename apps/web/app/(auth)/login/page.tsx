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
            <p className="text-xs text-white/60">Operations Console</p>
          </div>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="text-sm text-white/70">Email</label>
            <input
              type="email"
              {...register("email")}
              className="mt-1 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 focus:outline-none focus:border-brand.blue"
            />
          </div>
          <div>
            <label className="text-sm text-white/70">Password</label>
            <input
              type="password"
              {...register("password")}
              className="mt-1 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 focus:outline-none focus:border-brand.red"
            />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            type="submit"
            className="w-full py-2 rounded-lg bg-gradient-to-r from-brand.red to-brand.blue font-semibold"
            disabled={formState.isSubmitting}
          >
            {formState.isSubmitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
        <div className="mt-6 pt-4 border-t border-white/10 space-y-2">
          <p className="text-sm text-white/80 font-semibold">Verify email with OTP</p>
          <input
            type="email"
            value={verifyEmail}
            onChange={(e) => setVerifyEmail(e.target.value)}
            placeholder="Email"
            className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 focus:outline-none focus:border-brand.blue"
          />
          <input
            value={verifyOtp}
            onChange={(e) => setVerifyOtp(e.target.value)}
            placeholder="6-digit OTP"
            className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 focus:outline-none focus:border-brand.red"
          />
          {verifyError && <p className="text-xs text-red-400">{verifyError}</p>}
          {verifySuccess && <p className="text-xs text-green-400">{verifySuccess}</p>}
          <button
            type="button"
            onClick={onVerifyOtp}
            className="w-full py-2 rounded-lg bg-white/10 font-semibold"
            disabled={isVerifying}
          >
            {isVerifying ? "Verifying..." : "Verify OTP"}
          </button>
        </div>
      </div>
    </div>
  );
}
