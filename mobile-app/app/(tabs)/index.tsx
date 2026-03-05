import React, { useEffect, useState, useCallback } from "react";
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity,
    RefreshControl, ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import { walletApi, portfolioApi } from "../../services/api";
import { router } from "expo-router";

export default function HomeScreen() {
    const { user, logout } = useAuth();
    const { theme, isDark, toggle } = useTheme();
    const [balance, setBalance] = useState<number>(0);
    const [portfolioValue, setPortfolioValue] = useState<number>(0);
    const [totalPL, setTotalPL] = useState<number>(0);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const fetchData = useCallback(async () => {
        try {
            const [walletRes, perfRes] = await Promise.all([
                walletApi.summary(),
                portfolioApi.performance(),
            ]);
            setBalance(walletRes.data.balance);
            setPortfolioValue(perfRes.data.current_value ?? 0);
            setTotalPL(perfRes.data.total_profit_loss ?? 0);
        } catch { /* silently fail */ }
        finally { setLoading(false); setRefreshing(false); }
    }, []);

    useEffect(() => { fetchData(); }, []);
    const onRefresh = () => { setRefreshing(true); fetchData(); };
    const plPositive = totalPL >= 0;

    const s = makeStyles(theme);

    if (loading) {
        return <View style={s.center}><ActivityIndicator size="large" color={theme.accent} /></View>;
    }

    return (
        <ScrollView style={s.container}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />}>

            {/* Header */}
            <View style={s.header}>
                <View>
                    <Text style={s.greeting}>Good evening 👋</Text>
                    <Text style={s.username}>{user?.username}</Text>
                </View>
                <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
                    {/* Theme Toggle */}
                    <TouchableOpacity onPress={toggle} style={s.iconBtn}>
                        <Ionicons name={isDark ? "sunny-outline" : "moon-outline"} size={18} color={theme.accent} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={logout} style={s.iconBtn}>
                        <Ionicons name="log-out-outline" size={18} color={theme.muted} />
                    </TouchableOpacity>
                </View>
            </View>

            {/* Balance Hero Card */}
            <View style={s.heroCard}>
                <Text style={s.heroLabel}>Investment Wallet</Text>
                <Text style={s.heroAmount}>₹{balance.toFixed(2)}</Text>
                <View style={s.heroBadge}>
                    <Ionicons name="shield-checkmark" size={12} color={theme.accent} />
                    <Text style={s.heroBadgeText}>Virtual portfolio · Protected</Text>
                </View>
            </View>

            {/* Stats Row */}
            <View style={s.statsRow}>
                <View style={[s.statCard, { flex: 1, marginRight: 8 }]}>
                    <Ionicons name="bar-chart-outline" size={20} color={theme.purple} />
                    <Text style={s.statValue}>₹{portfolioValue.toFixed(2)}</Text>
                    <Text style={s.statLabel}>Portfolio Value</Text>
                </View>
                <View style={[s.statCard, { flex: 1 }]}>
                    <Ionicons name={plPositive ? "trending-up" : "trending-down"} size={20}
                        color={plPositive ? theme.green : theme.red} />
                    <Text style={[s.statValue, { color: plPositive ? theme.green : theme.red }]}>
                        {plPositive ? "+" : ""}₹{totalPL.toFixed(2)}
                    </Text>
                    <Text style={s.statLabel}>Total P&L</Text>
                </View>
            </View>

            {/* Quick Actions */}
            <Text style={s.sectionTitle}>QUICK ACTIONS</Text>
            <View style={s.actionsRow}>
                {[
                    { icon: "add-circle-outline", label: "Add Spend", color: theme.accent, route: "/(tabs)/wallet" },
                    { icon: "bar-chart-outline", label: "Portfolio", color: theme.purple, route: "/(tabs)/portfolio" },
                    { icon: "sparkles-outline", label: "AI Picks", color: theme.amber, route: "/(tabs)/ai" },
                ].map(({ icon, label, color, route: r }) => (
                    <TouchableOpacity key={label} style={s.actionBtn} onPress={() => router.push(r as any)}>
                        <View style={[s.actionIcon, { backgroundColor: `${color}20` }]}>
                            <Ionicons name={icon as any} size={22} color={color} />
                        </View>
                        <Text style={s.actionLabel}>{label}</Text>
                    </TouchableOpacity>
                ))}
            </View>

            {/* How it works */}
            <Text style={s.sectionTitle}>HOW SMARTCHANGE WORKS</Text>
            <View style={s.howCard}>
                {[
                    { n: "1", t: "Spend normally", d: "Log any purchase — coffee, groceries, etc." },
                    { n: "2", t: "Round-up happens", d: "We round up to the next ₹ automatically" },
                    { n: "3", t: "Spare change invested", d: "AI picks the best stocks for that spare change" },
                ].map(({ n, t, d }) => (
                    <View key={n} style={s.howRow}>
                        <View style={s.howNum}><Text style={s.howNumText}>{n}</Text></View>
                        <View style={{ flex: 1 }}>
                            <Text style={s.howTitle}>{t}</Text>
                            <Text style={s.howDesc}>{d}</Text>
                        </View>
                    </View>
                ))}
            </View>
        </ScrollView>
    );
}

function makeStyles(t: ReturnType<typeof import("../../context/ThemeContext").useTheme>["theme"]) {
    return StyleSheet.create({
        container: { flex: 1, backgroundColor: t.bg },
        center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: t.bg },
        header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 24, paddingTop: 56 },
        greeting: { color: t.muted, fontSize: 13 },
        username: { color: t.text, fontSize: 20, fontWeight: "700" },
        iconBtn: { padding: 8, backgroundColor: t.surface, borderRadius: 10, borderWidth: 1, borderColor: t.border },
        heroCard: { margin: 20, marginTop: 4, padding: 28, borderRadius: 20, backgroundColor: t.card, borderWidth: 1, borderColor: t.border, alignItems: "center" },
        heroLabel: { color: t.muted, fontSize: 13, marginBottom: 8 },
        heroAmount: { color: t.accent, fontSize: 42, fontWeight: "800", letterSpacing: 1 },
        heroBadge: { flexDirection: "row", alignItems: "center", marginTop: 12, gap: 6 },
        heroBadgeText: { color: t.muted, fontSize: 11 },
        statsRow: { flexDirection: "row", paddingHorizontal: 20, marginBottom: 24 },
        statCard: { backgroundColor: t.card, borderRadius: 16, padding: 18, borderWidth: 1, borderColor: t.border, alignItems: "flex-start" },
        statValue: { color: t.text, fontSize: 18, fontWeight: "700", marginTop: 8 },
        statLabel: { color: t.muted, fontSize: 11, marginTop: 2 },
        sectionTitle: { color: t.subtext, fontSize: 11, fontWeight: "700", letterSpacing: 1, paddingHorizontal: 20, marginBottom: 12 },
        actionsRow: { flexDirection: "row", paddingHorizontal: 20, gap: 12, marginBottom: 28 },
        actionBtn: { flex: 1, alignItems: "center" },
        actionIcon: { width: 52, height: 52, borderRadius: 16, justifyContent: "center", alignItems: "center", marginBottom: 6 },
        actionLabel: { color: t.subtext, fontSize: 11, fontWeight: "600" },
        howCard: { margin: 20, marginTop: 0, backgroundColor: t.card, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: t.border, gap: 16, marginBottom: 40 },
        howRow: { flexDirection: "row", gap: 16, alignItems: "flex-start" },
        howNum: { width: 28, height: 28, borderRadius: 14, backgroundColor: t.accentDim, justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: t.accentBorder },
        howNumText: { color: t.accent, fontSize: 12, fontWeight: "700" },
        howTitle: { color: t.text, fontSize: 14, fontWeight: "600", marginBottom: 2 },
        howDesc: { color: t.muted, fontSize: 12 },
    });
}
