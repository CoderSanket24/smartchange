/**
 * ThemeContext.tsx
 * Provides light/dark colour tokens and a toggle.
 * Persists user preference in AsyncStorage.
 */
import React, { createContext, useContext, useEffect, useState } from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

// ── Token sets ────────────────────────────────────────────────────────────────
export const darkTheme = {
    mode: "dark" as const,
    bg: "#0A0E1A",
    surface: "#0D1117",
    border: "#1A2332",
    text: "#FFFFFF",
    subtext: "#8B9BB4",
    muted: "#4A5568",
    accent: "#00D4FF",
    accentDim: "rgba(0,212,255,0.10)",
    accentBorder: "rgba(0,212,255,0.25)",
    card: "#0D1117",
    inputBg: "#0A0E1A",
    overlayBg: "rgba(0,0,0,0.75)",
    tabBar: "#0D1117",
    tabBorder: "#1A2332",
    divider: "#1A2332",
    green: "#22C55E",
    red: "#EF4444",
    purple: "#A855F7",
    amber: "#F59E0B",
};

export const lightTheme = {
    mode: "light" as const,
    bg: "#F0F4FF",
    surface: "#FFFFFF",
    border: "#E2E8F0",
    text: "#0F172A",
    subtext: "#475569",
    muted: "#94A3B8",
    accent: "#0284C7",
    accentDim: "rgba(2,132,199,0.10)",
    accentBorder: "rgba(2,132,199,0.30)",
    card: "#FFFFFF",
    inputBg: "#F8FAFC",
    overlayBg: "rgba(0,0,0,0.50)",
    tabBar: "#FFFFFF",
    tabBorder: "#E2E8F0",
    divider: "#E2E8F0",
    green: "#16A34A",
    red: "#DC2626",
    purple: "#7C3AED",
    amber: "#D97706",
};

export type ThemeMode = "dark" | "light";

// Derive the shape from darkTheme, but widen `mode` to the union
export type Theme = Omit<typeof darkTheme, "mode"> & { mode: ThemeMode };

// ── Context ───────────────────────────────────────────────────────────────────
interface ThemeContextValue {
    theme: Theme;
    isDark: boolean;
    toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
    theme: darkTheme,
    isDark: true,
    toggle: () => { },
});

const PREF_KEY = "@smartchange_theme";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const systemScheme = useColorScheme();
    const [isDark, setIsDark] = useState(true);   // default dark

    useEffect(() => {
        AsyncStorage.getItem(PREF_KEY).then(val => {
            if (val === "light") setIsDark(false);
            else if (val === "dark") setIsDark(true);
            else setIsDark(systemScheme !== "light");  // follow system if no pref saved
        });
    }, []);

    const toggle = async () => {
        const next = !isDark;
        setIsDark(next);
        await AsyncStorage.setItem(PREF_KEY, next ? "dark" : "light");
    };

    const theme = isDark ? darkTheme : lightTheme;

    return (
        <ThemeContext.Provider value={{ theme, isDark, toggle }}>
            {children}
        </ThemeContext.Provider>
    );
}

export const useTheme = () => useContext(ThemeContext);
