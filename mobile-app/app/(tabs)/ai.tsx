import React, { useEffect, useState, useCallback } from "react";
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity,
    RefreshControl, ActivityIndicator, TextInput, Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../context/ThemeContext";
import { aiApi, walletApi } from "../../services/api";

interface Recommendation {
    rank: number;
    stock_symbol: string;
    stock_name: string;
    sector: string;
    current_price: number;
    allocation_pct: number;
    suggested_amount: number;
    policy_weight?: number;
    rationale: string;
    explanation: {
        feature_scores?: Record<string, number>;
        shap_values?: Record<string, number>;
        top_factor?: string;
        method?: string;
        policy_weight?: number;
        note?: string;
    };
}

const FEATURE_COLORS: Record<string, string> = {
    momentum: "#00D4FF",
    low_volatility: "#22C55E",
    value: "#F59E0B",
    large_cap: "#A855F7",
};
const FEATURE_ICONS: Record<string, any> = {
    momentum: "trending-up-outline",
    low_volatility: "shield-outline",
    value: "pricetag-outline",
    large_cap: "business-outline",
};

export default function AIScreen() {
    const { theme } = useTheme();
    const [recs, setRecs] = useState<Recommendation[]>([]);
    const [meta, setMeta] = useState<any>(null);
    const [balance, setBalance] = useState(0);
    const [amount, setAmount] = useState("100");
    const [topN, setTopN] = useState("4");
    const [loading, setLoading] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [expanded, setExpanded] = useState<string | null>(null);

    const fetchRecs = useCallback(async () => {
        setLoading(true);
        try {
            const [aiRes, walRes] = await Promise.all([
                aiApi.recommend(parseFloat(amount) || 100, parseInt(topN) || 4),
                walletApi.balance(),
            ]);
            setMeta(aiRes.data);
            setRecs(aiRes.data.recommendations);
            setBalance(walRes.data.balance);
        } catch (e: any) {
            Alert.alert("Error", e?.response?.data?.detail ?? "Failed to fetch recommendations.");
        } finally { setLoading(false); setRefreshing(false); }
    }, [amount, topN]);

    useEffect(() => { fetchRecs(); }, []);
    const onRefresh = () => { setRefreshing(true); fetchRecs(); };

    const s = makeStyles(theme);

    return (
        <ScrollView style={s.container}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.amber} />}>

            {/* Header */}
            <View style={s.header}>
                <View>
                    <Text style={s.title}>AI Advisor</Text>
                    <Text style={s.subtitle}>PPO RL · Policy Explained</Text>
                </View>
                <View style={s.aiBadge}>
                    <Ionicons name="sparkles" size={14} color={theme.amber} />
                    <Text style={s.aiBadgeText}>AI Powered</Text>
                </View>
            </View>

            {/* Config Card */}
            <View style={s.configCard}>
                <Text style={s.configTitle}>Configure Recommendation</Text>
                <View style={s.configRow}>
                    <View style={s.configField}>
                        <Text style={s.label}>Amount (₹)</Text>
                        <TextInput
                            style={s.input}
                            value={amount}
                            onChangeText={setAmount}
                            keyboardType="decimal-pad"
                            placeholderTextColor={theme.muted}
                        />
                    </View>
                    <View style={s.configField}>
                        <Text style={s.label}>Top N Stocks</Text>
                        <TextInput
                            style={s.input}
                            value={topN}
                            onChangeText={setTopN}
                            keyboardType="number-pad"
                            placeholderTextColor={theme.muted}
                        />
                    </View>
                </View>
                <Text style={s.walletNote}>
                    Wallet: <Text style={{ color: theme.accent }}>₹{balance.toFixed(2)}</Text>
                </Text>
                <TouchableOpacity style={s.runBtn} onPress={fetchRecs} disabled={loading}>
                    {loading
                        ? <ActivityIndicator color="#000" />
                        : <><Ionicons name="sparkles" size={16} color="#000" /><Text style={s.runBtnText}>Run AI Analysis</Text></>}
                </TouchableOpacity>
            </View>

            {/* Model Info */}
            {meta && (
                <View style={s.modelInfo}>
                    <Ionicons name="information-circle-outline" size={14} color={theme.amber} />
                    <Text style={s.modelText}>{meta.model} · {meta.explanation_method}</Text>
                </View>
            )}

            {/* Portfolio Summary */}
            {meta?.portfolio_summary && (
                <View style={s.summaryRow}>
                    <View style={s.summaryChip}>
                        <Ionicons name="layers-outline" size={13} color={theme.accent} />
                        <Text style={s.summaryChipText}>{meta.portfolio_summary.n_assets} assets selected</Text>
                    </View>
                    {Object.entries(meta.portfolio_summary.sector_exposure ?? {}).map(([sec, cnt]) => (
                        <View key={sec} style={s.summaryChip}>
                            <Text style={s.summaryChipText}>{sec} ×{cnt as number}</Text>
                        </View>
                    ))}
                </View>
            )}

            {/* Recommendations */}
            <Text style={s.sectionTitle}>RECOMMENDATIONS</Text>
            {loading && recs.length === 0 ? (
                <View style={s.loadingBox}><ActivityIndicator size="large" color={theme.amber} /></View>
            ) : recs.map((rec) => {
                const isExpanded = expanded === rec.stock_symbol;
                const topFactor = rec.explanation?.top_factor ?? null;
                const topColor = topFactor ? (FEATURE_COLORS[topFactor] ?? theme.accent) : theme.accent;
                const shapVals = rec.explanation?.shap_values ?? null;
                const maxShap = shapVals ? Math.max(...Object.values(shapVals)) : 0;

                return (
                    <View key={rec.stock_symbol} style={s.recCard}>
                        {/* Rank + Stock Info */}
                        <View style={s.recHeader}>
                            <View style={s.rankBadge}><Text style={s.rankText}>#{rec.rank}</Text></View>
                            <View style={s.recInfo}>
                                <View style={s.recNameRow}>
                                    <Text style={s.recSymbol}>{rec.stock_symbol}</Text>
                                    <View style={s.sectorBadge}><Text style={s.sectorText}>{rec.sector}</Text></View>
                                </View>
                                <Text style={s.recName}>{rec.stock_name}</Text>
                                <Text style={s.recPrice}>₹{rec.current_price.toFixed(2)} per share</Text>
                            </View>
                            <View style={s.allocBox}>
                                <Text style={s.allocPct}>{rec.allocation_pct.toFixed(1)}%</Text>
                                <Text style={s.allocAmt}>₹{rec.suggested_amount.toFixed(2)}</Text>
                            </View>
                        </View>

                        {/* Top Factor Badge — heuristic mode */}
                        {topFactor && (
                            <View style={[s.topFactorRow, { backgroundColor: `${topColor}15`, borderColor: `${topColor}30` }]}>
                                <Ionicons name={FEATURE_ICONS[topFactor] ?? "analytics-outline"} size={13} color={topColor} />
                                <Text style={[s.topFactorText, { color: topColor }]}>Top factor: {topFactor.replace("_", " ")}</Text>
                            </View>
                        )}

                        {/* PPO mode badge */}
                        {!topFactor && rec.explanation?.method && (
                            <View style={[s.topFactorRow, { backgroundColor: theme.accentDim, borderColor: theme.accentBorder }]}>
                                <Ionicons name="sparkles-outline" size={13} color={theme.accent} />
                                <Text style={[s.topFactorText, { color: theme.accent }]}>
                                    PPO RL · weight: {rec.policy_weight?.toFixed(4)}
                                </Text>
                            </View>
                        )}

                        {/* Rationale */}
                        <Text style={s.rationale}>{rec.rationale}</Text>

                        {/* SHAP / PPO note */}
                        {shapVals ? (
                            <>
                                <TouchableOpacity style={s.expandBtn} onPress={() => setExpanded(isExpanded ? null : rec.stock_symbol)}>
                                    <Text style={s.expandText}>{isExpanded ? "Hide" : "View"} SHAP Explanation</Text>
                                    <Ionicons name={isExpanded ? "chevron-up" : "chevron-down"} size={14} color={theme.amber} />
                                </TouchableOpacity>
                                {isExpanded && (
                                    <View style={s.shapBox}>
                                        <Text style={s.shapTitle}>Feature Importance (SHAP)</Text>
                                        {Object.entries(shapVals).sort((a, b) => b[1] - a[1]).map(([feat, val]) => {
                                            const color = FEATURE_COLORS[feat] ?? theme.text;
                                            const pct = maxShap > 0 ? (val / maxShap) * 100 : 0;
                                            return (
                                                <View key={feat} style={s.shapRow}>
                                                    <Ionicons name={FEATURE_ICONS[feat] ?? "analytics-outline"} size={13} color={color} style={{ width: 20 }} />
                                                    <Text style={s.shapFeat}>{feat.replace("_", " ")}</Text>
                                                    <View style={s.shapBar}>
                                                        <View style={[s.shapFill, { width: `${pct}%` as any, backgroundColor: color }]} />
                                                    </View>
                                                    <Text style={[s.shapVal, { color }]}>{val.toFixed(4)}</Text>
                                                </View>
                                            );
                                        })}
                                        <Text style={s.shapNote}>Higher SHAP value = stronger influence on recommendation</Text>
                                    </View>
                                )}
                            </>
                        ) : rec.explanation?.note ? (
                            <Text style={s.shapNote}>{rec.explanation.note}</Text>
                        ) : null}
                    </View>
                );
            })}
            <View style={{ height: 40 }} />
        </ScrollView>
    );
}

function makeStyles(t: ReturnType<typeof import("../../context/ThemeContext").useTheme>["theme"]) {
    return StyleSheet.create({
        container: { flex: 1, backgroundColor: t.bg },
        header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 24, paddingTop: 56 },
        title: { color: t.text, fontSize: 24, fontWeight: "700" },
        subtitle: { color: t.muted, fontSize: 11, marginTop: 2 },
        aiBadge: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: `${t.amber}20`, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: `${t.amber}50` },
        aiBadgeText: { color: t.amber, fontSize: 11, fontWeight: "700" },
        configCard: { margin: 20, marginTop: 0, backgroundColor: t.card, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: t.border },
        configTitle: { color: t.text, fontSize: 14, fontWeight: "700", marginBottom: 16 },
        configRow: { flexDirection: "row", gap: 12, marginBottom: 12 },
        configField: { flex: 1 },
        label: { color: t.subtext, fontSize: 12, fontWeight: "600", marginBottom: 6 },
        input: { backgroundColor: t.inputBg, borderRadius: 10, borderWidth: 1, borderColor: t.border, color: t.text, paddingHorizontal: 12, height: 44, fontSize: 14 },
        walletNote: { color: t.muted, fontSize: 12, marginBottom: 14 },
        runBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: t.amber, borderRadius: 12, height: 48, gap: 8 },
        runBtnText: { color: "#000", fontWeight: "700", fontSize: 15 },
        modelInfo: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 20, marginBottom: 10 },
        modelText: { color: t.muted, fontSize: 11 },
        summaryRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 20, marginBottom: 16 },
        summaryChip: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: t.accentDim, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1, borderColor: t.accentBorder },
        summaryChipText: { color: t.subtext, fontSize: 11 },
        sectionTitle: { color: t.subtext, fontSize: 11, fontWeight: "700", letterSpacing: 1, paddingHorizontal: 20, marginBottom: 12 },
        loadingBox: { alignItems: "center", padding: 40 },
        recCard: { marginHorizontal: 20, marginBottom: 14, backgroundColor: t.card, borderRadius: 16, padding: 18, borderWidth: 1, borderColor: t.border },
        recHeader: { flexDirection: "row", alignItems: "flex-start", marginBottom: 12, gap: 12 },
        rankBadge: { width: 32, height: 32, borderRadius: 10, backgroundColor: `${t.amber}25`, justifyContent: "center", alignItems: "center" },
        rankText: { color: t.amber, fontSize: 12, fontWeight: "700" },
        recInfo: { flex: 1 },
        recNameRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 },
        recSymbol: { color: t.text, fontSize: 16, fontWeight: "700" },
        sectorBadge: { backgroundColor: t.border, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
        sectorText: { color: t.muted, fontSize: 10 },
        recName: { color: t.subtext, fontSize: 12 },
        recPrice: { color: t.muted, fontSize: 11, marginTop: 2 },
        allocBox: { alignItems: "flex-end" },
        allocPct: { color: t.amber, fontSize: 18, fontWeight: "700" },
        allocAmt: { color: t.muted, fontSize: 11, marginTop: 2 },
        topFactorRow: { flexDirection: "row", alignItems: "center", gap: 6, padding: 8, borderRadius: 8, borderWidth: 1, marginBottom: 10 },
        topFactorText: { fontSize: 12, fontWeight: "600" },
        rationale: { color: t.subtext, fontSize: 12, lineHeight: 18, marginBottom: 12 },
        expandBtn: { flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "flex-end" },
        expandText: { color: t.amber, fontSize: 12, fontWeight: "600" },
        shapBox: { marginTop: 14, backgroundColor: t.inputBg, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: t.border },
        shapTitle: { color: t.text, fontSize: 12, fontWeight: "700", marginBottom: 12 },
        shapRow: { flexDirection: "row", alignItems: "center", marginBottom: 10, gap: 8 },
        shapFeat: { color: t.subtext, fontSize: 11, width: 100 },
        shapBar: { flex: 1, height: 6, backgroundColor: t.border, borderRadius: 3, overflow: "hidden" },
        shapFill: { height: "100%" as any, borderRadius: 3 },
        shapVal: { fontSize: 11, fontWeight: "600", width: 46, textAlign: "right" },
        shapNote: { color: t.muted, fontSize: 10, marginTop: 8, opacity: 0.7 },
    });
}
