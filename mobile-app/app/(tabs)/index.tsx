import React, { useEffect, useState, useCallback } from "react";
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity,
    RefreshControl, ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../context/AuthContext";
import { walletApi, portfolioApi } from "../../services/api";
import { router } from "expo-router";

export default function HomeScreen() {
    const { user, logout } = useAuth();
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

    if (loading) {
        return <View style={styles.center}><ActivityIndicator size="large" color="#00D4FF" /></View>;
    }

    return (
        <ScrollView style={styles.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00D4FF" />}>
            {/* Header */}
            <View style={styles.header}>
                <View>
                    <Text style={styles.greeting}>Good evening 👋</Text>
                    <Text style={styles.username}>{user?.username}</Text>
                </View>
                <TouchableOpacity onPress={logout} style={styles.logoutBtn}>
                    <Ionicons name="log-out-outline" size={20} color="#4A5568" />
                </TouchableOpacity>
            </View>

            {/* Balance Hero Card */}
            <View style={styles.heroCard}>
                <Text style={styles.heroLabel}>Investment Wallet</Text>
                <Text style={styles.heroAmount}>₹{balance.toFixed(2)}</Text>
                <View style={styles.heroBadge}>
                    <Ionicons name="shield-checkmark" size={12} color="#00D4FF" />
                    <Text style={styles.heroBadgeText}>Virtual portfolio · Protected</Text>
                </View>
            </View>

            {/* Stats Row */}
            <View style={styles.statsRow}>
                <View style={[styles.statCard, { flex: 1, marginRight: 8 }]}>
                    <Ionicons name="bar-chart-outline" size={20} color="#A855F7" />
                    <Text style={styles.statValue}>₹{portfolioValue.toFixed(2)}</Text>
                    <Text style={styles.statLabel}>Portfolio Value</Text>
                </View>
                <View style={[styles.statCard, { flex: 1 }]}>
                    <Ionicons name={plPositive ? "trending-up" : "trending-down"} size={20} color={plPositive ? "#22C55E" : "#EF4444"} />
                    <Text style={[styles.statValue, { color: plPositive ? "#22C55E" : "#EF4444" }]}>
                        {plPositive ? "+" : ""}₹{totalPL.toFixed(2)}
                    </Text>
                    <Text style={styles.statLabel}>Total P&L</Text>
                </View>
            </View>

            {/* Quick Actions */}
            <Text style={styles.sectionTitle}>Quick Actions</Text>
            <View style={styles.actionsRow}>
                {[
                    { icon: "add-circle-outline", label: "Add Spend", color: "#00D4FF", route: "/(tabs)/wallet" },
                    { icon: "bar-chart-outline", label: "Portfolio", color: "#A855F7", route: "/(tabs)/portfolio" },
                    { icon: "sparkles-outline", label: "AI Picks", color: "#F59E0B", route: "/(tabs)/ai" },
                ].map(({ icon, label, color, route: r }) => (
                    <TouchableOpacity key={label} style={styles.actionBtn} onPress={() => router.push(r as any)}>
                        <View style={[styles.actionIcon, { backgroundColor: `${color}1A` }]}>
                            <Ionicons name={icon as any} size={22} color={color} />
                        </View>
                        <Text style={styles.actionLabel}>{label}</Text>
                    </TouchableOpacity>
                ))}
            </View>

            {/* How it works */}
            <Text style={styles.sectionTitle}>How SmartChange Works</Text>
            <View style={styles.howCard}>
                {[
                    { n: "1", t: "Spend normally", d: "Log any purchase — coffee, groceries, etc." },
                    { n: "2", t: "Round-up happens", d: "We round up to the next ₹ automatically" },
                    { n: "3", t: "Spare change invested", d: "AI picks the best stocks for that spare change" },
                ].map(({ n, t, d }) => (
                    <View key={n} style={styles.howRow}>
                        <View style={styles.howNum}><Text style={styles.howNumText}>{n}</Text></View>
                        <View style={styles.howText}>
                            <Text style={styles.howTitle}>{t}</Text>
                            <Text style={styles.howDesc}>{d}</Text>
                        </View>
                    </View>
                ))}
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: "#0A0E1A" },
    center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#0A0E1A" },
    header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 24, paddingTop: 56 },
    greeting: { color: "#4A5568", fontSize: 13 },
    username: { color: "#FFFFFF", fontSize: 20, fontWeight: "700" },
    logoutBtn: { padding: 8, backgroundColor: "#0D1117", borderRadius: 10, borderWidth: 1, borderColor: "#1A2332" },
    heroCard: {
        margin: 20, marginTop: 4, padding: 28, borderRadius: 20,
        backgroundColor: "#0D1117", borderWidth: 1, borderColor: "#1A2332",
        alignItems: "center",
    },
    heroLabel: { color: "#4A5568", fontSize: 13, marginBottom: 8 },
    heroAmount: { color: "#00D4FF", fontSize: 42, fontWeight: "800", letterSpacing: 1 },
    heroBadge: { flexDirection: "row", alignItems: "center", marginTop: 12, gap: 6 },
    heroBadgeText: { color: "#4A5568", fontSize: 11 },
    statsRow: { flexDirection: "row", paddingHorizontal: 20, marginBottom: 24 },
    statCard: { backgroundColor: "#0D1117", borderRadius: 16, padding: 18, borderWidth: 1, borderColor: "#1A2332", alignItems: "flex-start" },
    statValue: { color: "#FFFFFF", fontSize: 18, fontWeight: "700", marginTop: 8 },
    statLabel: { color: "#4A5568", fontSize: 11, marginTop: 2 },
    sectionTitle: { color: "#8B9BB4", fontSize: 12, fontWeight: "600", letterSpacing: 0.8, paddingHorizontal: 20, marginBottom: 12 },
    actionsRow: { flexDirection: "row", paddingHorizontal: 20, gap: 12, marginBottom: 28 },
    actionBtn: { flex: 1, alignItems: "center" },
    actionIcon: { width: 52, height: 52, borderRadius: 16, justifyContent: "center", alignItems: "center", marginBottom: 6 },
    actionLabel: { color: "#8B9BB4", fontSize: 11, fontWeight: "600" },
    howCard: { margin: 20, marginTop: 0, backgroundColor: "#0D1117", borderRadius: 16, padding: 20, borderWidth: 1, borderColor: "#1A2332", gap: 16, marginBottom: 40 },
    howRow: { flexDirection: "row", gap: 16, alignItems: "flex-start" },
    howNum: { width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(0,212,255,0.12)", justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: "rgba(0,212,255,0.3)" },
    howNumText: { color: "#00D4FF", fontSize: 12, fontWeight: "700" },
    howText: { flex: 1 },
    howTitle: { color: "#FFFFFF", fontSize: 14, fontWeight: "600", marginBottom: 2 },
    howDesc: { color: "#4A5568", fontSize: 12 },
});
