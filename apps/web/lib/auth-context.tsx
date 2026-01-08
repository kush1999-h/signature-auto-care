"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import api, { AUTH_LOGOUT_EVENT, setAuthToken } from "./api-client";

type User = {
  userId?: string;
  email: string;
  role: string;
  permissions: string[];
  name?: string;
};

type Session = {
  accessToken?: string;
  refreshToken?: string;
  user?: User;
};

type AuthContextValue = {
  session: Session | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue>({
  session: null,
  login: async () => {},
  logout: () => {}
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => {
    if (typeof window === "undefined") return null;
    const stored = localStorage.getItem("sac_session");
    if (stored) {
      const parsed = JSON.parse(stored);
      setAuthToken(parsed.accessToken);
      return parsed;
    }
    return null;
  });

  const logout = useCallback(() => {
    setSession(null);
    setAuthToken(undefined);
    localStorage.removeItem("sac_session");
  }, []);

  useEffect(() => {
    if (!session?.accessToken) return;
    api
      .get("/auth/me")
      .then((res) => setSession((prev) => ({ ...prev, user: res.data })))
      .catch(() => {
        logout();
      });
  }, [logout, session?.accessToken]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleLogout = () => logout();
    window.addEventListener(AUTH_LOGOUT_EVENT, handleLogout);
    return () => {
      window.removeEventListener(AUTH_LOGOUT_EVENT, handleLogout);
    };
  }, [logout]);

  const login = async (email: string, password: string) => {
    const res = await api.post("/auth/login", { email, password });
    const payload: Session = {
      accessToken: res.data.accessToken,
      refreshToken: res.data.refreshToken,
      user: res.data.user
    };
    setAuthToken(payload.accessToken);
    setSession(payload);
    localStorage.setItem("sac_session", JSON.stringify(payload));
  };

  return <AuthContext.Provider value={{ session, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
