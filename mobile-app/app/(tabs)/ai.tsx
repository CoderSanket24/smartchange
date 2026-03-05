import React, { useEffect, useState, useCallback } from "react";
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity,
    RefreshControl, ActivityIndicator, TextInput, Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { aiApi, walletApi } from "../../services/api";

interface Recommendation {
    rank: number;
    stock_symbol: string;
    stock_name: string;
    sector: string;
    current_price: number;
    allocation_pct: number;
    suggested_amount: number;
    policy_weight?: number;      // PPO normalised portfolio weight (renamed from q_value)
    rationale: string;
    explanation: {
        // Heuristic / equal-weight fields
        feature_scores?: Record<string, number>;
        shap_values?: Record<string, number>;
        top_factor?: string;
        // PPO fields
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

    return (
        <ScrollView style={styles.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#F59E0B" />}>
            {/* Header */}
            <View style={styles.header}>
                <View>
                    <Text style={styles.title}>AI Advisor</Text>
                    <Text style={styles.subtitle}>Epsilon-Greedy RL · SHAP Explained</Text>
                </View>
                <View style={styles.aiBadge}>
                    <Ionicons name="sparkles" size={14} color="#F59E0B" />
                    <Text style={styles.aiBadgeText}>AI Powered</Text>
                </View>
            </View>

            {/* Config Card */}
            <View style={styles.configCard}>
                <Text style={styles.configTitle}>Configure Recommendation</Text>
                <View style={styles.configRow}>
                    <View style={styles.configField}>
                        <Text style={styles.label}>Amount (₹)</Text>
                        <TextInput
                            style={styles.input}
                            value={amount}
                            onChangeText={setAmount}
                            keyboardType="decimal-pad"
                            placeholderTextColor="#4A5568"
                        />
                    </View>
                    <View style={styles.configField}>
                        <Text style={styles.label}>Top N Stocks</Text>
                        <TextInput
                            style={styles.input}
                            value={topN}
                            onChangeText={setTopN}
                            keyboardType="number-pad"
                            placeholderTextColor="#4A5568"
                        />
                    </View>
                </View>
                <Text style={styles.walletNote}>Wallet: <Text style={{ color: "#00D4FF" }}>₹{balance.toFixed(2)}</Text></Text>
                <TouchableOpacity style={styles.runBtn} onPress={fetchRecs} disabled={loading}>
                    {loading ? <ActivityIndicator color="#000" /> : (
                        <><Ionicons name="sparkles" size={16} color="#000" /><Text style={styles.runBtnText}>Run AI Analysis</Text></>
                    )}
                </TouchableOpacity>
            </View>

            {/* Model Info */}
            {meta && (
                <View style={styles.modelInfo}>
                    <Ionicons name="information-circle-outline" size={14} color="#F59E0B" />
                    <Text style={styles.modelText}>{meta.model} · {meta.explanation_method}</Text>
                </View>
            )}

            {/* Recommendations */}
            <Text style={styles.sectionTitle}>Recommendations</Text>
            {loading && recs.length === 0 ? (
                <View style={styles.loadingBox}><ActivityIndicator size="large" color="#F59E0B" /></View>
            ) : recs.map((rec) => {
                const isExpanded = expanded === rec.stock_symbol;
                const topFactor = rec.explanation?.top_factor ?? null;
                const topColor = topFactor ? (FEATURE_COLORS[topFactor] ?? "#00D4FF") : "#00D4FF";
                const shapVals = rec.explanation?.shap_values ?? null;
                const maxShap = shapVals ? Math.max(...Object.values(shapVals)) : 0;

                return (
                    <View key={rec.stock_symbol} style={styles.recCard}>
                        {/* Rank Badge + Stock Info */}
                        <View style={styles.recHeader}>
                            <View style={styles.rankBadge}><Text style={styles.rankText}>#{rec.rank}</Text></View>
                            <View style={styles.recInfo}>
                                <View style={styles.recNameRow}>
                                    <Text style={styles.recSymbol}>{rec.stock_symbol}</Text>
                                    <View style={styles.sectorBadge}><Text style={styles.sectorText}>{rec.sector}</Text></View>
                                </View>
                                <Text style={styles.recName}>{rec.stock_name}</Text>
                                <Text style={styles.recPrice}>₹{rec.current_price.toFixed(2)} per share</Text>
                            </View>
                            <View style={styles.allocBox}>
                                <Text style={styles.allocPct}>{rec.allocation_pct.toFixed(1)}%</Text>
                                <Text style={styles.allocAmt}>₹{rec.suggested_amount.toFixed(2)}</Text>
                            </View>
                        </View>

                        {/* Top Factor Badge — only shown for heuristic recommendations */}
                        {topFactor && (
                            <View style={[styles.topFactorRow, { backgroundColor: `${topColor}15`, borderColor: `${topColor}30` }]}>
                                <Ionicons name={FEATURE_ICONS[topFactor] ?? "analytics-outline"} size={13} color={topColor} />
                                <Text style={[styles.topFactorText, { color: topColor }]}>Top factor: {topFactor.replace("_", " ")}</Text>
                            </View>
                        )}

                        {/* PPO mode info badge */}
                        {!topFactor && rec.explanation?.method && (
                            <View style={[styles.topFactorRow, { backgroundColor: "rgba(0,212,255,0.08)", borderColor: "rgba(0,212,255,0.2)" }]}>
                                <Ionicons name="sparkles-outline" size={13} color="#00D4FF" />
                                <Text style={[styles.topFactorText, { color: "#00D4FF" }]}>PPO RL · weight: {rec.policy_weight?.toFixed(4)}</Text>
                            </View>
                        )}

                        {/* Rationale */}
                        <Text style={styles.rationale}>{rec.rationale}</Text>

                        {/* Expand/collapse SHAP — only if shap_values exist */}
                        {shapVals ? (
                            <>
                                <TouchableOpacity style={styles.expandBtn} onPress={() => setExpanded(isExpanded ? null : rec.stock_symbol)}>
                                    <Text style={styles.expandText}>{isExpanded ? "Hide" : "View"} SHAP Explanation</Text>
                                    <Ionicons name={isExpanded ? "chevron-up" : "chevron-down"} size={14} color="#F59E0B" />
                                </TouchableOpacity>
                                {isExpanded && (
                                    <View style={styles.shapBox}>
                                        <Text style={styles.shapTitle}>Feature Importance (SHAP)</Text>
                                        {Object.entries(shapVals).sort((a, b) => b[1] - a[1]).map(([feat, val]) => {
                                            const color = FEATURE_COLORS[feat] ?? "#FFFFFF";
                                            const pct = maxShap > 0 ? (val / maxShap) * 100 : 0;
                                            return (
                                                <View key={feat} style={styles.shapRow}>
                                                    <Ionicons name={FEATURE_ICONS[feat] ?? "analytics-outline"} size={13} color={color} style={{ width: 20 }} />
                                                    <Text style={styles.shapFeat}>{feat.replace("_", " ")}</Text>
                                                    <View style={styles.shapBar}>
                                                        <View style={[styles.shapFill, { width: `${pct}%`, backgroundColor: color }]} />
                                                    </View>
                                                    <Text style={[styles.shapVal, { color }]}>{val.toFixed(4)}</Text>
                                                </View>
                                            );
                                        })}
                                        <Text style={styles.shapNote}>Higher SHAP value = stronger influence on recommendation</Text>
                                    </View>
                                )}
                            </>
                        ) : (
                            rec.explanation?.note ? (
                                <Text style={styles.shapNote}>{rec.explanation.note}</Text>
                            ) : null
                        )}
                    </View>
                );
            })}
            <View style={{ height: 40 }} />
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: "#0A0E1A" },
    header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 24, paddingTop: 56 },
    title: { color: "#FFFFFF", fontSize: 24, fontWeight: "700" },
    subtitle: { color: "#4A5568", fontSize: 11, marginTop: 2 },
    aiBadge: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(245,158,11,0.12)", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: "rgba(245,158,11,0.3)" },
    aiBadgeText: { color: "#F59E0B", fontSize: 11, fontWeight: "700" },
    configCard: { margin: 20, marginTop: 0, backgroundColor: "#0D1117", borderRadius: 16, padding: 20, borderWidth: 1, borderColor: "#1A2332" },
    configTitle: { color: "#FFFFFF", fontSize: 14, fontWeight: "700", marginBottom: 16 },
    configRow: { flexDirection: "row", gap: 12, marginBottom: 12 },
    configField: { flex: 1 },
    label: { color: "#8B9BB4", fontSize: 12, fontWeight: "600", marginBottom: 6 },
    input: { backgroundColor: "#0A0E1A", borderRadius: 10, borderWidth: 1, borderColor: "#1A2332", color: "#FFFFFF", paddingHorizontal: 12, height: 44, fontSize: 14 },
    walletNote: { color: "#4A5568", fontSize: 12, marginBottom: 14 },
    runBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: "#F59E0B", borderRadius: 12, height: 48, gap: 8 },
    runBtnText: { color: "#000", fontWeight: "700", fontSize: 15 },
    modelInfo: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 20, marginBottom: 16 },
    modelText: { color: "#4A5568", fontSize: 11 },
    sectionTitle: { color: "#8B9BB4", fontSize: 12, fontWeight: "600", letterSpacing: 0.8, paddingHorizontal: 20, marginBottom: 12 },
    loadingBox: { alignItems: "center", padding: 40 },
    recCard: { marginHorizontal: 20, marginBottom: 14, backgroundColor: "#0D1117", borderRadius: 16, padding: 18, borderWidth: 1, borderColor: "#1A2332" },
    recHeader: { flexDirection: "row", alignItems: "flex-start", marginBottom: 12, gap: 12 },
    rankBadge: { width: 32, height: 32, borderRadius: 10, backgroundColor: "rgba(245,158,11,0.15)", justifyContent: "center", alignItems: "center" },
    rankText: { color: "#F59E0B", fontSize: 12, fontWeight: "700" },
    recInfo: { flex: 1 },
    recNameRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 },
    recSymbol: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
    sectorBadge: { backgroundColor: "#1A2332", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
    sectorText: { color: "#4A5568", fontSize: 10 },
    recName: { color: "#8B9BB4", fontSize: 12 },
    recPrice: { color: "#4A5568", fontSize: 11, marginTop: 2 },
    allocBox: { alignItems: "flex-end" },
    allocPct: { color: "#F59E0B", fontSize: 18, fontWeight: "700" },
    allocAmt: { color: "#4A5568", fontSize: 11, marginTop: 2 },
    topFactorRow: { flexDirection: "row", alignItems: "center", gap: 6, padding: 8, borderRadius: 8, borderWidth: 1, marginBottom: 10 },
    topFactorText: { fontSize: 12, fontWeight: "600" },
    rationale: { color: "#8B9BB4", fontSize: 12, lineHeight: 18, marginBottom: 12 },
    expandBtn: { flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "flex-end" },
    expandText: { color: "#F59E0B", fontSize: 12, fontWeight: "600" },
    shapBox: { marginTop: 14, backgroundColor: "#0A0E1A", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#1A2332" },
    shapTitle: { color: "#FFFFFF", fontSize: 12, fontWeight: "700", marginBottom: 12 },
    shapRow: { flexDirection: "row", alignItems: "center", marginBottom: 10, gap: 8 },
    shapFeat: { color: "#8B9BB4", fontSize: 11, width: 100 },
    shapBar: { flex: 1, height: 6, backgroundColor: "#1A2332", borderRadius: 3, overflow: "hidden" },
    shapFill: { height: "100%", borderRadius: 3 },
    shapVal: { fontSize: 11, fontWeight: "600", width: 46, textAlign: "right" },
    shapNote: { color: "#2D3748", fontSize: 10, marginTop: 8 },
});
