"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { authApi, type User } from "@/lib/api";
import { getStoredAuthToken, setStoredAuthToken } from "@/lib/auth-storage";

type AuthState = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string, opts?: { redirectTo?: string }) => Promise<void>;
  logout: () => void;
  register: (
    email: string,
    password: string,
    name?: string,
    token?: string,
    joinCode?: string,
    companyName?: string
  ) => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const refreshUser = useCallback(async () => {
    try {
      const token = getStoredAuthToken();
      if (!token) {
        setUser(null);
        return;
      }
      const { data } = await authApi.me();
      setUser(data);
    } catch {
      setStoredAuthToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  const login = useCallback(
    async (email: string, password: string, opts?: { redirectTo?: string }) => {
      const { data } = await authApi.login({
        email: email.trim().toLowerCase(),
        password,
      });
      setStoredAuthToken(data.token);
      setUser(data.user);
      let dest = (opts?.redirectTo ?? "").trim() || "/app";
      if (dest !== "/app" && dest !== "/dev") dest = "/app";
      if (dest === "/dev" && !data.user.devPanelAccess) dest = "/app";
      router.push(dest);
    },
    [router]
  );

  const logout = useCallback(() => {
    setStoredAuthToken(null);
    setUser(null);
    router.push("/");
  }, [router]);

  const register = useCallback(
    async (
      email: string,
      password: string,
      name?: string,
      token?: string,
      joinCode?: string,
      companyName?: string
    ) => {
      const { data } = await authApi.register({
        email: email.trim().toLowerCase(),
        password,
        name: name?.trim() || undefined,
        inviteToken: token?.trim() || undefined,
        joinCode: joinCode?.trim() || undefined,
        companyName: companyName?.trim() || undefined,
      });
      setStoredAuthToken(data.token);
      setUser(data.user);
      router.push("/app");
    },
    [router]
  );

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, register, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
