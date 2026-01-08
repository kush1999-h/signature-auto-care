"use client";

import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "../../../lib/auth-context";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Image from "next/image";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(4)
});

export default function LoginPage() {
  const { register, handleSubmit, formState } = useForm({ resolver: zodResolver(schema) });
  const { login } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (values: any) => {
    setError(null);
    try {
      await login(values.email, values.password);
      router.push("/");
    } catch (err: any) {
      setError("Invalid credentials");
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
      </div>
    </div>
  );
}
