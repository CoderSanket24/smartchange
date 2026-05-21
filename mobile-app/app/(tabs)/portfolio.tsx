import React, { useEffect, useState, useCallback, useRef } from "react";
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity,
    RefreshControl, Alert, ActivityIndicator, Modal, TextInput,
    FlatList, Animated, Dimensions, StatusBar,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../context/ThemeContext";
import { portfolioApi, walletApi } from "../../services/api";
import { useFocusEffect } from "expo-router";

const { height: SCREEN_H, width: SCREEN_W } = Dimensions.get("window");

interface Stock { symbol: string; name: string; price: number; }
interface HoldingPerf {
    stock_symbol: string; stock_name: string; shares: number;
    invested_amount: number; current_value: number;
    profit_loss: number; profit_loss_pct: number;
    current_price: number; avg_buy_price: number;
    invested_at?: string | null;
}

// ── Skeleton ───────────────────────────────────────────────────────────────────
function SkeletonBox({ width, height, style }: { width: number | string; height: number; style?: object }) {
    const opacity = React.useRef(new Animated.Value(0.4)).current;
    useEffect(() => {
        const anim = Animated.loop(Animated.sequence([
            Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
            Animated.timing(opacity, { toValue: 0.4, duration: 700, useNativeDriver: true }),
        ]));
        anim.start();
        return () => anim.stop();
    }, [opacity]);
    return <Animated.View style={[{ width, height, borderRadius: 8, backgroundColor: "#2a2a3a" }, style, { opacity }]} />;
}

function SkeletonCard({ theme }: { theme: any }) {
    return (
        <View style={{ paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: theme.divider }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
                <SkeletonBox width={42} height={42} style={{ borderRadius: 12 }} />
                <View style={{ flex: 1, gap: 6 }}>
                    <SkeletonBox width="60%" height={12} />
                    <SkeletonBox width="40%" height={10} />
                </View>
                <View style={{ alignItems: "flex-end", gap: 6 }}>
                    <SkeletonBox width={70} height={12} />
                    <SkeletonBox width={50} height={10} />
                </View>
            </View>
        </View>
    );
}

// ── Stat Row used inside the detail sheet ─────────────────────────────────────
function StatRow({ label, value, valueColor, icon }: { label: string; value: string; valueColor?: string; icon?: string }) {
    return (
        <View style={detailStyles.statRow}>
            <Text style={detailStyles.statLabel}>{label}</Text>
            <Text style={[detailStyles.statValue, valueColor ? { color: valueColor } : {}]}>{value}</Text>
        </View>
    );
}

// ── Mini bar chart ─────────────────────────────────────────────────────────────
function MiniBarChart({ invested, current, theme }: { invested: number; current: number; theme: any }) {
    const max = Math.max(invested, current);
    const investedW = max > 0 ? (invested / max) * 100 : 50;
    const currentW  = max > 0 ? (current  / max) * 100 : 50;
    const isProfit   = current >= invested;

    return (
        <View style={{ marginTop: 20, marginBottom: 4 }}>
            <Text style={[detailStyles.statLabel, { marginBottom: 10 }]}>Invested vs Current</Text>
            <View style={{ gap: 8 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <Text style={{ color: theme.muted, fontSize: 10, width: 62 }}>Invested</Text>
                    <View style={{ flex: 1, height: 8, backgroundColor: theme.border, borderRadius: 4, overflow: "hidden" }}>
                        <Animated.View style={{ width: `${investedW}%`, height: "100%", backgroundColor: theme.accent, borderRadius: 4 }} />
                    </View>
                    <Text style={{ color: theme.subtext, fontSize: 10, width: 62, textAlign: "right" }}>₹{invested.toFixed(0)}</Text>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <Text style={{ color: theme.muted, fontSize: 10, width: 62 }}>Current</Text>
                    <View style={{ flex: 1, height: 8, backgroundColor: theme.border, borderRadius: 4, overflow: "hidden" }}>
                        <Animated.View style={{ width: `${currentW}%`, height: "100%", backgroundColor: isProfit ? "#22C55E" : "#EF4444", borderRadius: 4 }} />
                    </View>
                    <Text style={{ color: isProfit ? "#22C55E" : "#EF4444", fontSize: 10, width: 62, textAlign: "right" }}>₹{current.toFixed(0)}</Text>
                </View>
            </View>
        </View>
    );
}

// ── Stock Detail Bottom Sheet ──────────────────────────────────────────────────
function StockDetailSheet({
    holding, visible, onClose, theme, onInvestMore, onSell,
}: {
    holding: HoldingPerf | null;
    visible: boolean;
    onClose: () => void;
    theme: any;
    onInvestMore: (h: HoldingPerf) => void;
    onSell: (h: HoldingPerf) => void;
}) {
    const slideAnim = useRef(new Animated.Value(SCREEN_H)).current;

    useEffect(() => {
        if (visible) {
            Animated.spring(slideAnim, {
                toValue: 0,
                useNativeDriver: true,
                damping: 20,
                stiffness: 180,
            }).start();
        } else {
            Animated.timing(slideAnim, {
                toValue: SCREEN_H,
                duration: 260,
                useNativeDriver: true,
            }).start();
        }
    }, [visible]);

    if (!holding) return null;

    // Add null safety for all holding properties
    const profitLoss = holding.profit_loss ?? 0;
    const profitLossPct = holding.profit_loss_pct ?? 0;
    const currentPrice = holding.current_price ?? 0;
    const avgBuyPrice = holding.avg_buy_price ?? 0;
    const currentValue = holding.current_value ?? 0;
    const investedAmount = holding.invested_amount ?? 0;
    const shares = holding.shares ?? 0;

    const isProfit   = profitLoss >= 0;
    const plColor    = isProfit ? "#22C55E" : "#EF4444";
    const plIcon     = isProfit ? "trending-up" : "trending-down";
    const dayChange  = currentPrice - avgBuyPrice;
    const dayChangePct = avgBuyPrice > 0
        ? ((dayChange / avgBuyPrice) * 100).toFixed(2)
        : "0.00";

    const investedDate = holding.invested_at
        ? new Date(holding.invested_at).toLocaleDateString("en-IN", {
            day: "2-digit", month: "short", year: "numeric",
          })
        : "—";

    const portfolioWeight = investedAmount > 0
        ? ((currentValue / investedAmount) * 100 - 100).toFixed(2)
        : "0.00";

    // Sector colour map
    const sectorColors: Record<string, string> = {
        IT: "#818CF8", Banking: "#34D399", Energy: "#F59E0B",
        FMCG: "#FB923C", Metals: "#94A3B8", Infrastructure: "#60A5FA",
        NBFC: "#A78BFA", Auto: "#F472B6", Consumer: "#2DD4BF",
        "Consumer Durables": "#FBBF24", Cement: "#9CA3AF",
        Telecom: "#38BDF8", Conglomerate: "#E879F9",
    };

    return (
        <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}
            statusBarTranslucent>
            {/* Scrim */}
            <TouchableOpacity activeOpacity={1} style={detailStyles.scrim} onPress={onClose} />

            {/* Sheet */}
            <Animated.View
                style={[detailStyles.sheet, { backgroundColor: theme.surface, transform: [{ translateY: slideAnim }] }]}
            >
                {/* Drag handle */}
                <View style={detailStyles.handle} />

                {/* ── Header ── */}
                <View style={detailStyles.sheetHeader}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
                        <View style={[detailStyles.bigBadge, { backgroundColor: `${theme.purple}22` }]}>
                            <Text style={[detailStyles.bigBadgeText, { color: theme.purple }]}>
                                {holding.stock_symbol.slice(0, 4)}
                            </Text>
                        </View>
                        <View>
                            <Text style={[detailStyles.sheetTitle, { color: theme.text }]}>{holding.stock_name}</Text>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 }}>
                                <View style={{ backgroundColor: `${theme.border}`, borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2 }}>
                                    <Text style={{ color: theme.muted, fontSize: 10, fontWeight: "600" }}>NSE:{holding.stock_symbol}</Text>
                                </View>
                            </View>
                        </View>
                    </View>
                    <TouchableOpacity onPress={onClose} style={detailStyles.closeBtn}>
                        <Ionicons name="close" size={18} color={theme.muted} />
                    </TouchableOpacity>
                </View>

                {/* ── Live Price Hero ── */}
                <View style={[detailStyles.priceHero, { backgroundColor: `${plColor}12`, borderColor: `${plColor}25` }]}>
                    <View>
                        <Text style={{ color: theme.muted, fontSize: 11, marginBottom: 2 }}>Current Price</Text>
                        <Text style={{ color: theme.text, fontSize: 28, fontWeight: "800" }}>
                            ₹{currentPrice.toFixed(2)}
                        </Text>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4 }}>
                            <Ionicons name={plIcon} size={14} color={plColor} />
                            <Text style={{ color: plColor, fontSize: 13, fontWeight: "700" }}>
                                {isProfit ? "+" : ""}{dayChange.toFixed(2)} ({isProfit ? "+" : ""}{dayChangePct}%)
                            </Text>
                            <Text style={{ color: theme.muted, fontSize: 11 }}>vs avg buy</Text>
                        </View>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                        <Text style={{ color: theme.muted, fontSize: 10, marginBottom: 2 }}>Your P&L</Text>
                        <Text style={{ color: plColor, fontSize: 20, fontWeight: "800" }}>
                            {isProfit ? "+" : ""}₹{Math.abs(profitLoss).toFixed(2)}
                        </Text>
                        <View style={[detailStyles.plPill, { backgroundColor: `${plColor}22` }]}>
                            <Text style={{ color: plColor, fontSize: 12, fontWeight: "700" }}>
                                {isProfit ? "+" : ""}{profitLossPct.toFixed(2)}%
                            </Text>
                        </View>
                    </View>
                </View>

                <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
                    {/* ── Holdings Stats Grid ── */}
                    <View style={[detailStyles.statsCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
                        <Text style={[detailStyles.cardSectionTitle, { color: theme.subtext }]}>POSITION DETAILS</Text>

                        <View style={detailStyles.statsGrid}>
                            {/* Col 1 */}
                            <View style={{ flex: 1, gap: 16 }}>
                                <View>
                                    <Text style={detailStyles.gridLabel}>Invested</Text>
                                    <Text style={[detailStyles.gridValue, { color: theme.text }]}>₹{investedAmount.toFixed(2)}</Text>
                                </View>
                                <View>
                                    <Text style={detailStyles.gridLabel}>Avg Buy Price</Text>
                                    <Text style={[detailStyles.gridValue, { color: theme.text }]}>₹{avgBuyPrice.toFixed(2)}</Text>
                                </View>
                                <View>
                                    <Text style={detailStyles.gridLabel}>Shares Held</Text>
                                    <Text style={[detailStyles.gridValue, { color: theme.text }]}>{shares.toFixed(6)}</Text>
                                </View>
                            </View>

                            {/* Divider */}
                            <View style={{ width: 1, backgroundColor: theme.border, marginHorizontal: 16 }} />

                            {/* Col 2 */}
                            <View style={{ flex: 1, gap: 16 }}>
                                <View>
                                    <Text style={detailStyles.gridLabel}>Current Value</Text>
                                    <Text style={[detailStyles.gridValue, { color: theme.text }]}>₹{currentValue.toFixed(2)}</Text>
                                </View>
                                <View>
                                    <Text style={detailStyles.gridLabel}>Live Price</Text>
                                    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#22C55E" }} />
                                        <Text style={[detailStyles.gridValue, { color: "#22C55E" }]}>₹{currentPrice.toFixed(2)}</Text>
                                    </View>
                                </View>
                                <View>
                                    <Text style={detailStyles.gridLabel}>Invested On</Text>
                                    <Text style={[detailStyles.gridValue, { color: theme.text }]}>{investedDate}</Text>
                                </View>
                            </View>
                        </View>

                        {/* Bar chart */}
                        <MiniBarChart invested={investedAmount} current={currentValue} theme={theme} />
                    </View>

                    {/* ── Returns Card ── */}
                    <View style={[detailStyles.statsCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
                        <Text style={[detailStyles.cardSectionTitle, { color: theme.subtext }]}>RETURNS BREAKDOWN</Text>
                        <StatRow label="Total P&L"
                            value={`${isProfit ? "+" : ""}₹{profitLoss.toFixed(2)}`}
                            valueColor={plColor} />
                        <View style={detailStyles.divider} />
                        <StatRow label="Return %"
                            value={`${isProfit ? "+" : ""}${profitLossPct.toFixed(2)}%`}
                            valueColor={plColor} />
                        <View style={detailStyles.divider} />
                        <StatRow label="Price Change vs Avg"
                            value={`${dayChange >= 0 ? "+" : ""}₹${dayChange.toFixed(2)}`}
                            valueColor={dayChange >= 0 ? "#22C55E" : "#EF4444"} />
                        <View style={detailStyles.divider} />
                        <StatRow label="Portfolio Gain/Loss"
                            value={`${parseFloat(portfolioWeight) >= 0 ? "+" : ""}${portfolioWeight}%`}
                            valueColor={parseFloat(portfolioWeight) >= 0 ? "#22C55E" : "#EF4444"} />
                    </View>

                    <View style={{ height: 24 }} />
                </ScrollView>

                {/* ── Action Buttons ── */}
                <View style={[detailStyles.actionBar, { borderTopColor: theme.border }]}>
                    <TouchableOpacity
                        style={[detailStyles.actionBtn, { backgroundColor: `${theme.purple}20`, borderColor: `${theme.purple}40`, borderWidth: 1 }]}
                        onPress={() => { onClose(); onInvestMore(holding); }}
                    >
                        <Ionicons name="add-circle-outline" size={16} color={theme.purple} />
                        <Text style={[detailStyles.actionBtnText, { color: theme.purple }]}>Invest More</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[detailStyles.actionBtn, { backgroundColor: `${theme.red}20`, borderColor: `${theme.red}40`, borderWidth: 1 }]}
                        onPress={() => { onClose(); onSell(holding); }}
                    >
                        <Ionicons name="trending-down-outline" size={16} color={theme.red} />
                        <Text style={[detailStyles.actionBtnText, { color: theme.red }]}>Sell</Text>
                    </TouchableOpacity>
                </View>
            </Animated.View>
        </Modal>
    );
}

const detailStyles = StyleSheet.create({
    scrim: {
        position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: "rgba(0,0,0,0.55)",
    },
    sheet: {
        position: "absolute", bottom: 0, left: 0, right: 0,
        borderTopLeftRadius: 28, borderTopRightRadius: 28,
        paddingTop: 12, paddingHorizontal: 20,
        maxHeight: SCREEN_H * 0.88,
        shadowColor: "#000", shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.3, shadowRadius: 20, elevation: 30,
    },
    handle: {
        width: 40, height: 4, borderRadius: 2,
        backgroundColor: "rgba(255,255,255,0.2)",
        alignSelf: "center", marginBottom: 16,
    },
    sheetHeader: {
        flexDirection: "row", justifyContent: "space-between",
        alignItems: "flex-start", marginBottom: 16,
    },
    bigBadge: {
        width: 52, height: 52, borderRadius: 16,
        justifyContent: "center", alignItems: "center",
    },
    bigBadgeText: { fontSize: 11, fontWeight: "800" },
    sheetTitle: { fontSize: 17, fontWeight: "700" },
    closeBtn: {
        width: 32, height: 32, borderRadius: 10,
        backgroundColor: "rgba(255,255,255,0.07)",
        justifyContent: "center", alignItems: "center",
    },
    priceHero: {
        flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start",
        borderRadius: 16, padding: 16, marginBottom: 16,
        borderWidth: 1,
    },
    plPill: {
        borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginTop: 4,
    },
    statsCard: {
        borderRadius: 16, padding: 18, marginBottom: 12,
        borderWidth: 1,
    },
    cardSectionTitle: {
        fontSize: 10, fontWeight: "700", letterSpacing: 1, marginBottom: 16,
    },
    statsGrid: { flexDirection: "row" },
    gridLabel: { color: "#6B7280", fontSize: 11, marginBottom: 4 },
    gridValue: { fontSize: 14, fontWeight: "700" },
    statRow: {
        flexDirection: "row", justifyContent: "space-between",
        alignItems: "center", paddingVertical: 10,
    },
    statLabel: { color: "#6B7280", fontSize: 13 },
    statValue: { color: "#F9FAFB", fontSize: 13, fontWeight: "700" },
    divider: { height: 1, backgroundColor: "rgba(255,255,255,0.06)" },
    actionBar: {
        flexDirection: "row", gap: 10, paddingVertical: 16,
        borderTopWidth: 1, paddingBottom: 32,
    },
    actionBtn: {
        flex: 1, flexDirection: "row", alignItems: "center",
        justifyContent: "center", gap: 6,
        borderRadius: 14, height: 50,
    },
    actionBtnText: { fontWeight: "700", fontSize: 14 },
});

// ── Main Screen ────────────────────────────────────────────────────────────────
export default function PortfolioScreen() {
    const { theme } = useTheme();
    const [perf, setPerf] = useState<any>(null);
    const [stocks, setStocks] = useState<Stock[]>([]);
    const [balance, setBalance] = useState(0);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [priceLoading, setPriceLoading] = useState(false);
    const [lastUpdated, setLastUpdated] = useState<string | null>(null);

    // Invest modal
    const [investModal, setInvestModal] = useState(false);
    const [selectedStock, setSelectedStock] = useState<Stock | null>(null);
    const [investAmount, setInvestAmount] = useState("");
    const [investing, setInvesting] = useState(false);

    // Sell modal
    const [sellModal, setSellModal] = useState(false);
    const [sellHolding, setSellHolding] = useState<HoldingPerf | null>(null);
    const [sellShares, setSellShares] = useState("");
    const [selling, setSelling] = useState(false);

    // Detail sheet
    const [detailHolding, setDetailHolding] = useState<HoldingPerf | null>(null);
    const [detailVisible, setDetailVisible] = useState(false);

    const fetchData = useCallback(async (showPriceSpinner = false) => {
        if (showPriceSpinner) setPriceLoading(true);
        try {
            const [perfRes, stocksRes, walRes] = await Promise.all([
                portfolioApi.performance(),
                portfolioApi.stocks(),
                walletApi.balance(),
            ]);
            setPerf(perfRes.data);
            setStocks(stocksRes.data);
            setBalance(walRes.data.balance);
            setLastUpdated(new Date().toLocaleTimeString());
        } catch { /* ignore */ }
        finally {
            setLoading(false);
            setRefreshing(false);
            setPriceLoading(false);
        }
    }, []);

    useFocusEffect(useCallback(() => { fetchData(true); }, [fetchData]));
    const onRefresh = () => { setRefreshing(true); fetchData(); };

    const openDetail = (h: HoldingPerf) => {
        setDetailHolding(h);
        setDetailVisible(true);
    };

    const closeDetail = () => {
        setDetailVisible(false);
        setTimeout(() => setDetailHolding(null), 300);
    };

    const openInvestFor = (h: HoldingPerf | null) => {
        if (h) {
            const match = stocks.find(s => s.symbol === h.stock_symbol);
            if (match) setSelectedStock(match);
        }
        setInvestModal(true);
    };

    const handleInvest = async () => {
        const amt = parseFloat(investAmount);
        if (!selectedStock || !amt || amt <= 0) return Alert.alert("Invalid", "Enter a valid amount.");
        if (amt > balance) return Alert.alert("Insufficient Balance", `Wallet balance: ₹${balance.toFixed(2)}.`);
        setInvesting(true);
        try {
            await portfolioApi.invest(selectedStock.symbol, amt);
            setInvestModal(false); setInvestAmount(""); setSelectedStock(null);
            fetchData(true);
            Alert.alert("✅ Invested!", `₹${amt.toFixed(2)} invested in ${selectedStock.symbol}.`);
        } catch (e: any) {
            Alert.alert("Error", e?.response?.data?.detail ?? "Investment failed.");
        } finally { setInvesting(false); }
    };

    const openSellFor = (h: HoldingPerf) => {
        setSellHolding(h);
        setSellModal(true);
    };

    const handleSell = async () => {
        const shares = parseFloat(sellShares);
        if (!sellHolding || !shares || shares <= 0) return Alert.alert("Invalid", "Enter a valid number of shares.");
        if (shares > sellHolding.shares) return Alert.alert("Insufficient Shares", `You own ${sellHolding.shares.toFixed(6)} shares.`);
        setSelling(true);
        try {
            const res = await portfolioApi.sell(sellHolding.stock_symbol, shares);
            setSellModal(false); setSellShares(""); setSellHolding(null);
            fetchData(true);
            const data = res.data;
            Alert.alert(
                "✅ Sold Successfully!",
                `Sold ${data.shares_sold} shares of ${data.stock_symbol} at ₹${data.sale_price.toFixed(2)}\n\n` +
                `Total Amount: ₹${data.total_amount.toFixed(2)}\n` +
                `P&L: ${data.profit_loss >= 0 ? '+' : ''}₹${data.profit_loss.toFixed(2)}\n` +
                `New Wallet Balance: ₹${data.wallet_balance.toFixed(2)}`
            );
        } catch (e: any) {
            Alert.alert("Error", e?.response?.data?.detail ?? "Sale failed.");
        } finally { setSelling(false); }
    };

    const s = makeStyles(theme);
    const plPositive = (perf?.total_profit_loss ?? 0) >= 0;

    return (
        <View style={s.container}>
            <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.purple} />}>

                {/* Header */}
                <View style={s.header}>
                    <View>
                        <Text style={s.title}>Portfolio</Text>
                        {lastUpdated && (
                            <View style={s.liveRow}>
                                <View style={s.liveDot} />
                                <Text style={s.liveText}>Live · {lastUpdated}</Text>
                                {priceLoading && <ActivityIndicator size="small" color={theme.green} style={{ marginLeft: 6 }} />}
                            </View>
                        )}
                    </View>
                    <TouchableOpacity style={s.investBtn} onPress={() => setInvestModal(true)}>
                        <Ionicons name="add" size={18} color="#fff" />
                        <Text style={s.investBtnText}>Invest</Text>
                    </TouchableOpacity>
                </View>

                {/* Summary Card */}
                {loading ? (
                    <View style={[s.summaryCard, { gap: 16 }]}>
                        <View style={{ flexDirection: "row", gap: 16 }}>
                            <View style={{ flex: 1, gap: 6 }}><SkeletonBox width="50%" height={10} /><SkeletonBox width="70%" height={22} /></View>
                            <View style={{ flex: 1, gap: 6 }}><SkeletonBox width="50%" height={10} /><SkeletonBox width="70%" height={22} /></View>
                        </View>
                        <SkeletonBox width="100%" height={40} style={{ borderRadius: 10 }} />
                    </View>
                ) : (
                    <View style={s.summaryCard}>
                        <View style={s.summaryRow}>
                            <View style={s.summaryItem}>
                                <Text style={s.summaryLabel}>Current Value</Text>
                                <Text style={s.summaryValue}>₹{(perf?.current_value ?? 0).toFixed(2)}</Text>
                            </View>
                            <View style={s.summaryItem}>
                                <Text style={s.summaryLabel}>Total Invested</Text>
                                <Text style={s.summaryValue}>₹{(perf?.total_invested ?? 0).toFixed(2)}</Text>
                            </View>
                        </View>
                        <View style={[s.plBadge, { backgroundColor: plPositive ? `${theme.green}20` : `${theme.red}20` }]}>
                            <Ionicons name={plPositive ? "trending-up" : "trending-down"} size={16}
                                color={plPositive ? theme.green : theme.red} />
                            <View>
                                <Text style={[s.plText, { color: plPositive ? theme.green : theme.red }]}>
                                    {plPositive ? "+" : ""}₹{(perf?.total_profit_loss ?? 0).toFixed(2)}
                                    {" "}({(perf?.total_profit_loss_pct ?? 0).toFixed(2)}%)
                                </Text>
                                <Text style={s.plSubtext}>Overall P&L</Text>
                            </View>
                        </View>
                    </View>
                )}

                {/* Holdings */}
                <Text style={s.sectionTitle}>HOLDINGS</Text>
                {loading ? (
                    [1, 2, 3].map(k => <SkeletonCard key={k} theme={theme} />)
                ) : (!perf?.holdings || perf.holdings.length === 0) ? (
                    <View style={s.emptyCard}>
                        <Ionicons name="bar-chart-outline" size={40} color={theme.border} />
                        <Text style={s.emptyText}>No holdings yet</Text>
                        <Text style={s.emptySub}>Tap "Invest" to buy your first stock</Text>
                    </View>
                ) : (
                    perf.holdings.map((h: HoldingPerf) => {
                        // Add null safety checks
                        const profitLoss = h.profit_loss ?? 0;
                        const profitLossPct = h.profit_loss_pct ?? 0;
                        const currentPrice = h.current_price ?? 0;
                        const avgBuyPrice = h.avg_buy_price ?? 0;
                        const currentValue = h.current_value ?? 0;
                        const shares = h.shares ?? 0;
                        
                        const pos = profitLoss >= 0;
                        const plAbsPct = Math.abs(profitLossPct);
                        return (
                            <TouchableOpacity
                                key={h.stock_symbol}
                                style={s.holdingCard}
                                onPress={() => openDetail(h)}
                                activeOpacity={0.72}
                            >
                                {/* Left */}
                                <View style={s.holdingLeft}>
                                    <View style={s.holdingBadge}>
                                        <Text style={s.holdingSymbol}>{h.stock_symbol.slice(0, 4)}</Text>
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <Text style={s.holdingName}>{h.stock_name}</Text>
                                        <Text style={s.holdingShares}>{shares.toFixed(6)} shares</Text>
                                        <View style={s.livePriceRow}>
                                            <View style={[s.liveDot, { backgroundColor: "#22C55E" }]} />
                                            <Text style={s.livePriceText}>₹{currentPrice.toFixed(2)} live</Text>
                                            <Text style={s.avgPriceText}>· avg ₹{avgBuyPrice.toFixed(2)}</Text>
                                        </View>
                                    </View>
                                </View>

                                {/* Right */}
                                <View style={s.holdingRight}>
                                    <Text style={s.holdingValue}>₹{currentValue.toFixed(2)}</Text>
                                    <View style={[s.plPill, { backgroundColor: pos ? `${theme.green}20` : `${theme.red}20` }]}>
                                        <Ionicons name={pos ? "arrow-up" : "arrow-down"} size={10}
                                            color={pos ? theme.green : theme.red} />
                                        <Text style={[s.holdingPL, { color: pos ? theme.green : theme.red }]}>
                                            {pos ? "+" : "-"}{plAbsPct.toFixed(2)}%
                                        </Text>
                                    </View>
                                    <Text style={[s.holdingPLAbs, { color: pos ? theme.green : theme.red }]}>
                                        {pos ? "+" : ""}₹{profitLoss.toFixed(2)}
                                    </Text>
                                </View>

                                {/* Tap hint chevron */}
                                <Ionicons name="chevron-forward" size={14} color={theme.muted} style={{ marginLeft: 4 }} />
                            </TouchableOpacity>
                        );
                    })
                )}
                <View style={{ height: 40 }} />
            </ScrollView>

            {/* ── Stock Detail Sheet ── */}
            <StockDetailSheet
                holding={detailHolding}
                visible={detailVisible}
                onClose={closeDetail}
                theme={theme}
                onInvestMore={openInvestFor}
                onSell={openSellFor}
            />

            {/* ── Invest Modal ── */}
            <Modal visible={investModal} transparent animationType="slide">
                <View style={s.overlay}>
                    <View style={s.modalCard}>
                        <View style={s.modalHeader}>
                            <Text style={s.modalTitle}>
                                {selectedStock ? `Invest in ${selectedStock.symbol}` : "Choose a Stock"}
                            </Text>
                            <TouchableOpacity onPress={() => { setInvestModal(false); setSelectedStock(null); setInvestAmount(""); }}>
                                <Ionicons name="close" size={22} color={theme.muted} />
                            </TouchableOpacity>
                        </View>

                        <Text style={s.walletNote}>
                            Wallet Balance: <Text style={{ color: theme.accent }}>₹{balance.toFixed(2)}</Text>
                        </Text>

                        {!selectedStock ? (
                            <FlatList
                                data={stocks}
                                keyExtractor={(s) => s.symbol}
                                style={{ maxHeight: 340 }}
                                renderItem={({ item }) => (
                                    <TouchableOpacity style={s.stockRow} onPress={() => setSelectedStock(item)}>
                                        <View style={s.stockBadge}>
                                            <Text style={s.stockSym}>{item.symbol.slice(0, 4)}</Text>
                                        </View>
                                        <View style={{ flex: 1 }}>
                                            <Text style={s.stockName}>{item.name}</Text>
                                            <Text style={s.stockPrice}>₹{item.price.toFixed(2)}</Text>
                                        </View>
                                        <Ionicons name="chevron-forward" size={16} color={theme.muted} />
                                    </TouchableOpacity>
                                )}
                            />
                        ) : (
                            <>
                                <TouchableOpacity onPress={() => setSelectedStock(null)} style={s.changeStock}>
                                    <Ionicons name="arrow-back" size={14} color={theme.accent} />
                                    <Text style={s.changeText}>Change stock</Text>
                                </TouchableOpacity>
                                <Text style={s.label}>Amount to Invest (₹)</Text>
                                <TextInput
                                    style={s.input}
                                    placeholder="e.g. 5.00"
                                    placeholderTextColor={theme.muted}
                                    value={investAmount}
                                    onChangeText={setInvestAmount}
                                    keyboardType="decimal-pad"
                                />
                                {investAmount ? (
                                    <Text style={s.sharesPreview}>
                                        ≈ {(parseFloat(investAmount) / selectedStock.price).toFixed(6)} fractional shares @ ₹{selectedStock.price}
                                    </Text>
                                ) : null}
                                <TouchableOpacity style={s.modalBtn} onPress={handleInvest} disabled={investing}>
                                    {investing
                                        ? <ActivityIndicator color="#fff" />
                                        : <Text style={s.modalBtnText}>Confirm Investment</Text>}
                                </TouchableOpacity>
                            </>
                        )}
                    </View>
                </View>
            </Modal>

            {/* ── Sell Modal ── */}
            <Modal visible={sellModal} transparent animationType="slide">
                <View style={s.overlay}>
                    <View style={s.modalCard}>
                        <View style={s.modalHeader}>
                            <Text style={s.modalTitle}>
                                Sell {sellHolding?.stock_symbol}
                            </Text>
                            <TouchableOpacity onPress={() => { setSellModal(false); setSellHolding(null); setSellShares(""); }}>
                                <Ionicons name="close" size={22} color={theme.muted} />
                            </TouchableOpacity>
                        </View>

                        {sellHolding && (
                            <>
                                <View style={[s.summaryCard, { marginBottom: 16, padding: 16 }]}>
                                    <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 8 }}>
                                        <Text style={s.label}>Available Shares</Text>
                                        <Text style={[s.stockName, { color: theme.text }]}>{(sellHolding.shares ?? 0).toFixed(6)}</Text>
                                    </View>
                                    <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 8 }}>
                                        <Text style={s.label}>Current Price</Text>
                                        <Text style={[s.stockName, { color: theme.green }]}>₹{(sellHolding.current_price ?? 0).toFixed(2)}</Text>
                                    </View>
                                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                                        <Text style={s.label}>Avg Buy Price</Text>
                                        <Text style={[s.stockName, { color: theme.muted }]}>₹{(sellHolding.avg_buy_price ?? 0).toFixed(2)}</Text>
                                    </View>
                                </View>

                                <Text style={s.label}>Number of Shares to Sell</Text>
                                <TextInput
                                    style={s.input}
                                    placeholder="e.g. 0.5"
                                    placeholderTextColor={theme.muted}
                                    value={sellShares}
                                    onChangeText={setSellShares}
                                    keyboardType="decimal-pad"
                                />
                                
                                <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
                                    <TouchableOpacity 
                                        style={[s.quickBtn, { backgroundColor: `${theme.purple}15` }]}
                                        onPress={() => setSellShares(((sellHolding.shares ?? 0) * 0.25).toFixed(6))}
                                    >
                                        <Text style={[s.quickBtnText, { color: theme.purple }]}>25%</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity 
                                        style={[s.quickBtn, { backgroundColor: `${theme.purple}15` }]}
                                        onPress={() => setSellShares(((sellHolding.shares ?? 0) * 0.5).toFixed(6))}
                                    >
                                        <Text style={[s.quickBtnText, { color: theme.purple }]}>50%</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity 
                                        style={[s.quickBtn, { backgroundColor: `${theme.purple}15` }]}
                                        onPress={() => setSellShares(((sellHolding.shares ?? 0) * 0.75).toFixed(6))}
                                    >
                                        <Text style={[s.quickBtnText, { color: theme.purple }]}>75%</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity 
                                        style={[s.quickBtn, { backgroundColor: `${theme.red}15` }]}
                                        onPress={() => setSellShares((sellHolding.shares ?? 0).toFixed(6))}
                                    >
                                        <Text style={[s.quickBtnText, { color: theme.red }]}>All</Text>
                                    </TouchableOpacity>
                                </View>

                                {sellShares ? (
                                    <View style={[s.summaryCard, { marginBottom: 16, padding: 16, backgroundColor: `${theme.red}10` }]}>
                                        <Text style={[s.label, { marginBottom: 8 }]}>Sale Preview</Text>
                                        <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
                                            <Text style={s.stockPrice}>Sale Amount</Text>
                                            <Text style={[s.stockName, { color: theme.text }]}>
                                                ₹{(parseFloat(sellShares) * (sellHolding.current_price ?? 0)).toFixed(2)}
                                            </Text>
                                        </View>
                                        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                                            <Text style={s.stockPrice}>Est. P&L</Text>
                                            <Text style={[s.stockName, { 
                                                color: (parseFloat(sellShares) * ((sellHolding.current_price ?? 0) - (sellHolding.avg_buy_price ?? 0))) >= 0 
                                                    ? theme.green : theme.red 
                                            }]}>
                                                {(parseFloat(sellShares) * ((sellHolding.current_price ?? 0) - (sellHolding.avg_buy_price ?? 0))) >= 0 ? '+' : ''}
                                                ₹{(parseFloat(sellShares) * ((sellHolding.current_price ?? 0) - (sellHolding.avg_buy_price ?? 0))).toFixed(2)}
                                            </Text>
                                        </View>
                                    </View>
                                ) : null}

                                <TouchableOpacity 
                                    style={[s.modalBtn, { backgroundColor: theme.red }]} 
                                    onPress={handleSell} 
                                    disabled={selling}
                                >
                                    {selling
                                        ? <ActivityIndicator color="#fff" />
                                        : <Text style={s.modalBtnText}>Confirm Sale</Text>}
                                </TouchableOpacity>
                            </>
                        )}
                    </View>
                </View>
            </Modal>
        </View>
    );
}

function makeStyles(t: ReturnType<typeof import("../../context/ThemeContext").useTheme>["theme"]) {
    return StyleSheet.create({
        container: { flex: 1, backgroundColor: t.bg },
        header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", padding: 24, paddingTop: 56 },
        title: { color: t.text, fontSize: 24, fontWeight: "700" },
        liveRow: { flexDirection: "row", alignItems: "center", marginTop: 4, gap: 5 },
        liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#22C55E" },
        liveText: { color: "#22C55E", fontSize: 10, fontWeight: "600" },
        investBtn: { flexDirection: "row", alignItems: "center", backgroundColor: t.purple, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, gap: 6 },
        investBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },

        summaryCard: { margin: 20, marginTop: 0, backgroundColor: t.card, borderRadius: 20, padding: 22, borderWidth: 1, borderColor: t.border },
        summaryRow: { flexDirection: "row", marginBottom: 16 },
        summaryItem: { flex: 1 },
        summaryLabel: { color: t.muted, fontSize: 11, marginBottom: 4 },
        summaryValue: { color: t.text, fontSize: 20, fontWeight: "700" },
        plBadge: { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 12, gap: 10 },
        plText: { fontWeight: "700", fontSize: 15 },
        plSubtext: { color: t.muted, fontSize: 10, marginTop: 1 },

        sectionTitle: { color: t.subtext, fontSize: 11, fontWeight: "700", letterSpacing: 1, paddingHorizontal: 20, marginBottom: 12 },
        emptyCard: { alignItems: "center", padding: 40 },
        emptyText: { color: t.muted, fontSize: 15, fontWeight: "600", marginTop: 12 },
        emptySub: { color: t.muted, fontSize: 12, marginTop: 4, opacity: 0.6 },

        holdingCard: {
            flexDirection: "row", alignItems: "center",
            paddingHorizontal: 20, paddingVertical: 16,
            borderBottomWidth: 1, borderBottomColor: t.divider,
        },
        holdingLeft: { flexDirection: "row", alignItems: "flex-start", gap: 14, flex: 1 },
        holdingBadge: { width: 42, height: 42, borderRadius: 12, backgroundColor: `${t.purple}25`, justifyContent: "center", alignItems: "center" },
        holdingSymbol: { color: t.purple, fontSize: 10, fontWeight: "700" },
        holdingName: { color: t.text, fontSize: 13, fontWeight: "600" },
        holdingShares: { color: t.muted, fontSize: 11, marginTop: 2 },
        livePriceRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
        livePriceText: { color: "#22C55E", fontSize: 10, fontWeight: "700" },
        avgPriceText: { color: t.muted, fontSize: 10 },
        holdingRight: { alignItems: "flex-end", gap: 4 },
        holdingValue: { color: t.text, fontSize: 14, fontWeight: "700" },
        plPill: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
        holdingPL: { fontSize: 11, fontWeight: "700" },
        holdingPLAbs: { fontSize: 11, fontWeight: "600" },

        overlay: { flex: 1, backgroundColor: t.overlayBg, justifyContent: "flex-end" },
        modalCard: { backgroundColor: t.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, borderTopWidth: 1, borderColor: t.border, maxHeight: "85%" },
        modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
        modalTitle: { color: t.text, fontSize: 18, fontWeight: "700" },
        walletNote: { color: t.muted, fontSize: 12, marginBottom: 16 },
        stockRow: { flexDirection: "row", alignItems: "center", padding: 14, borderBottomWidth: 1, borderBottomColor: t.divider, gap: 14 },
        stockBadge: { width: 38, height: 38, borderRadius: 10, backgroundColor: `${t.purple}25`, justifyContent: "center", alignItems: "center" },
        stockSym: { color: t.purple, fontSize: 9, fontWeight: "700" },
        stockName: { color: t.text, fontSize: 13, fontWeight: "600" },
        stockPrice: { color: t.muted, fontSize: 11 },
        changeStock: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 16 },
        changeText: { color: t.accent, fontSize: 13 },
        label: { color: t.subtext, fontSize: 12, fontWeight: "600", marginBottom: 6 },
        input: { backgroundColor: t.inputBg, borderRadius: 12, borderWidth: 1, borderColor: t.border, color: t.text, paddingHorizontal: 14, height: 50, fontSize: 14, marginBottom: 10 },
        sharesPreview: { color: t.muted, fontSize: 12, marginBottom: 16 },
        modalBtn: { backgroundColor: t.purple, borderRadius: 12, height: 52, justifyContent: "center", alignItems: "center", marginTop: 8 },
        modalBtnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
        quickBtn: { flex: 1, borderRadius: 8, paddingVertical: 8, alignItems: "center", justifyContent: "center" },
        quickBtnText: { fontSize: 12, fontWeight: "700" },

        green: { color: "#22C55E" },
        red:   { color: "#EF4444" },
    });
}
