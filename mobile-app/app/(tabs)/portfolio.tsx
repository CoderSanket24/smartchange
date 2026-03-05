import React, { useEffect, useState, useCallback } from "react";
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity,
    RefreshControl, Alert, ActivityIndicator, Modal, TextInput, FlatList,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../context/ThemeContext";
import { portfolioApi, walletApi } from "../../services/api";

interface Stock { symbol: string; name: string; price: number; }
interface HoldingPerf {
    stock_symbol: string; stock_name: string; shares: number;
    invested_amount: number; current_value: number;
    profit_loss: number; profit_loss_pct: number; current_price: number;
}

export default function PortfolioScreen() {
    const { theme } = useTheme();
    const [perf, setPerf] = useState<any>(null);
    const [stocks, setStocks] = useState<Stock[]>([]);
    const [balance, setBalance] = useState(0);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [modalVisible, setModalVisible] = useState(false);
    const [selectedStock, setSelectedStock] = useState<Stock | null>(null);
    const [investAmount, setInvestAmount] = useState("");
    const [investing, setInvesting] = useState(false);

    const fetchData = useCallback(async () => {
        try {
            const [perfRes, stocksRes, walRes] = await Promise.all([
                portfolioApi.performance(),
                portfolioApi.stocks(),
                walletApi.balance(),
            ]);
            setPerf(perfRes.data);
            setStocks(stocksRes.data);
            setBalance(walRes.data.balance);
        } catch { /* ignore */ }
        finally { setLoading(false); setRefreshing(false); }
    }, []);

    useEffect(() => { fetchData(); }, []);
    const onRefresh = () => { setRefreshing(true); fetchData(); };

    const handleInvest = async () => {
        const amt = parseFloat(investAmount);
        if (!selectedStock || !amt || amt <= 0) return Alert.alert("Invalid", "Enter a valid amount.");
        if (amt > balance) return Alert.alert("Insufficient Balance", `Wallet balance: ₹${balance.toFixed(2)}.`);
        setInvesting(true);
        try {
            await portfolioApi.invest(selectedStock.symbol, amt);
            setModalVisible(false); setInvestAmount("");
            fetchData();
            Alert.alert("✅ Invested!", `₹${amt.toFixed(2)} invested in ${selectedStock.symbol}.`);
        } catch (e: any) {
            Alert.alert("Error", e?.response?.data?.detail ?? "Investment failed.");
        } finally { setInvesting(false); }
    };

    const s = makeStyles(theme);
    if (loading) return <View style={s.center}><ActivityIndicator size="large" color={theme.purple} /></View>;

    const plPositive = (perf?.total_profit_loss ?? 0) >= 0;

    return (
        <View style={s.container}>
            <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.purple} />}>
                {/* Header */}
                <View style={s.header}>
                    <Text style={s.title}>Portfolio</Text>
                    <TouchableOpacity style={s.investBtn} onPress={() => setModalVisible(true)}>
                        <Ionicons name="add" size={18} color="#fff" />
                        <Text style={s.investBtnText}>Invest</Text>
                    </TouchableOpacity>
                </View>

                {/* Summary Card */}
                <View style={s.summaryCard}>
                    <View style={s.summaryRow}>
                        <View style={s.summaryItem}>
                            <Text style={s.summaryLabel}>Current Value</Text>
                            <Text style={s.summaryValue}>₹{perf?.current_value?.toFixed(2) ?? "0.00"}</Text>
                        </View>
                        <View style={s.summaryItem}>
                            <Text style={s.summaryLabel}>Total Invested</Text>
                            <Text style={s.summaryValue}>₹{perf?.total_invested?.toFixed(2) ?? "0.00"}</Text>
                        </View>
                    </View>
                    <View style={[s.plBadge, {
                        backgroundColor: plPositive ? `${theme.green}20` : `${theme.red}20`
                    }]}>
                        <Ionicons name={plPositive ? "trending-up" : "trending-down"} size={16}
                            color={plPositive ? theme.green : theme.red} />
                        <Text style={[s.plText, { color: plPositive ? theme.green : theme.red }]}>
                            {plPositive ? "+" : ""}₹{perf?.total_profit_loss?.toFixed(2) ?? "0.00"}
                            {" "}({perf?.total_profit_loss_pct?.toFixed(2) ?? "0.00"}%)
                        </Text>
                    </View>
                </View>

                {/* Holdings */}
                <Text style={s.sectionTitle}>HOLDINGS</Text>
                {(!perf?.holdings || perf.holdings.length === 0) ? (
                    <View style={s.emptyCard}>
                        <Ionicons name="bar-chart-outline" size={40} color={theme.border} />
                        <Text style={s.emptyText}>No holdings yet</Text>
                        <Text style={s.emptySub}>Tap "Invest" to buy your first stock</Text>
                    </View>
                ) : (
                    perf.holdings.map((h: HoldingPerf) => {
                        const pos = h.profit_loss >= 0;
                        return (
                            <View key={h.stock_symbol} style={s.holdingCard}>
                                <View style={s.holdingLeft}>
                                    <View style={s.holdingBadge}>
                                        <Text style={s.holdingSymbol}>{h.stock_symbol.slice(0, 4)}</Text>
                                    </View>
                                    <View>
                                        <Text style={s.holdingName}>{h.stock_name}</Text>
                                        <Text style={s.holdingShares}>
                                            {h.shares.toFixed(6)} shares · ₹{h.current_price.toFixed(2)}
                                        </Text>
                                    </View>
                                </View>
                                <View style={s.holdingRight}>
                                    <Text style={s.holdingValue}>₹{h.current_value.toFixed(2)}</Text>
                                    <Text style={[s.holdingPL, { color: pos ? theme.green : theme.red }]}>
                                        {pos ? "+" : ""}{h.profit_loss_pct.toFixed(2)}%
                                    </Text>
                                </View>
                            </View>
                        );
                    })
                )}
                <View style={{ height: 40 }} />
            </ScrollView>

            {/* Invest Modal */}
            <Modal visible={modalVisible} transparent animationType="slide">
                <View style={s.overlay}>
                    <View style={s.modalCard}>
                        <View style={s.modalHeader}>
                            <Text style={s.modalTitle}>
                                {selectedStock ? `Invest in ${selectedStock.symbol}` : "Choose a Stock"}
                            </Text>
                            <TouchableOpacity onPress={() => { setModalVisible(false); setSelectedStock(null); setInvestAmount(""); }}>
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
        </View>
    );
}

function makeStyles(t: ReturnType<typeof import("../../context/ThemeContext").useTheme>["theme"]) {
    return StyleSheet.create({
        container: { flex: 1, backgroundColor: t.bg },
        center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: t.bg },
        header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 24, paddingTop: 56 },
        title: { color: t.text, fontSize: 24, fontWeight: "700" },
        investBtn: { flexDirection: "row", alignItems: "center", backgroundColor: t.purple, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, gap: 6 },
        investBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
        summaryCard: { margin: 20, marginTop: 0, backgroundColor: t.card, borderRadius: 20, padding: 22, borderWidth: 1, borderColor: t.border },
        summaryRow: { flexDirection: "row", marginBottom: 16 },
        summaryItem: { flex: 1 },
        summaryLabel: { color: t.muted, fontSize: 11, marginBottom: 4 },
        summaryValue: { color: t.text, fontSize: 20, fontWeight: "700" },
        plBadge: { flexDirection: "row", alignItems: "center", padding: 10, borderRadius: 10, gap: 8 },
        plText: { fontWeight: "700", fontSize: 14 },
        sectionTitle: { color: t.subtext, fontSize: 11, fontWeight: "700", letterSpacing: 1, paddingHorizontal: 20, marginBottom: 12 },
        emptyCard: { alignItems: "center", padding: 40 },
        emptyText: { color: t.muted, fontSize: 15, fontWeight: "600", marginTop: 12 },
        emptySub: { color: t.muted, fontSize: 12, marginTop: 4, opacity: 0.6 },
        holdingCard: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: t.divider },
        holdingLeft: { flexDirection: "row", alignItems: "center", gap: 14, flex: 1 },
        holdingBadge: { width: 42, height: 42, borderRadius: 12, backgroundColor: `${t.purple}25`, justifyContent: "center", alignItems: "center" },
        holdingSymbol: { color: t.purple, fontSize: 10, fontWeight: "700" },
        holdingName: { color: t.text, fontSize: 13, fontWeight: "600" },
        holdingShares: { color: t.muted, fontSize: 11, marginTop: 2 },
        holdingRight: { alignItems: "flex-end" },
        holdingValue: { color: t.text, fontSize: 14, fontWeight: "700" },
        holdingPL: { fontSize: 12, fontWeight: "600", marginTop: 2 },
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
    });
}
