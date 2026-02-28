import React, { createContext, useContext, useState, useEffect } from "react";
import * as SecureStore from "expo-secure-store";
import { authApi } from "../services/api";

interface User {
    id: number;
    email: string;
    username: string;
}

interface AuthContextType {
    user: User | null;
    token: string | null;
    loading: boolean;
    login: (email: string, password: string) => Promise<void>;
    register: (email: string, username: string, password: string) => Promise<void>;
    logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [token, setToken] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Restore session on app launch
        (async () => {
            try {
                const saved = await SecureStore.getItemAsync("access_token");
                if (saved) {
                    setToken(saved);
                    const res = await authApi.me();
                    setUser(res.data);
                }
            } catch {
                await SecureStore.deleteItemAsync("access_token");
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const login = async (email: string, password: string) => {
        const res = await authApi.login(email, password);
        const t = res.data.access_token;
        await SecureStore.setItemAsync("access_token", t);
        setToken(t);
        const me = await authApi.me();
        setUser(me.data);
    };

    const register = async (email: string, username: string, password: string) => {
        const res = await authApi.register(email, username, password);
        const t = res.data.access_token;
        await SecureStore.setItemAsync("access_token", t);
        setToken(t);
        const me = await authApi.me();
        setUser(me.data);
    };

    const logout = async () => {
        await SecureStore.deleteItemAsync("access_token");
        setToken(null);
        setUser(null);
    };

    return (
        <AuthContext.Provider value={{ user, token, loading, login, register, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);
