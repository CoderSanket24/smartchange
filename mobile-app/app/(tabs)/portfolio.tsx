import React, { useEffect, useState, useCallback } from "react";
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity,
    RefreshControl, Alert, ActivityIndicator, Modal, TextInput, FlatList,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { portfolioApi, walletApi } from "../../services/api";

interface Stock { symbol: string; name: string; price: number; }
interface HoldingPerf {
    stock_symbol: string; stock_name: string; shares: number;
    invested_amount: number; current_value: number;
    profit_loss: number; profit_loss_pct: number; current_price: number;
}

export default function PortfolioScreen() {
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
        if (amt > balance) return Alert.alert("Insufficient Balance", `Your wallet balance is ₹${balance.toFixed(2)}.`);
        setInvesting(true);
        try {
            await portfolioApi.invest(selectedStock.symbol, amt);
            setModalVisible(false);
            setInvestAmount("");
            fetchData();
            Alert.alert("✅ Invested!", `₹${amt.toFixed(2)} invested in ${selectedStock.symbol}.`);
        } catch (e: any) {
            Alert.alert("Error", e?.response?.data?.detail ?? "Investment failed.");
        } finally { setInvesting(false); }
    };

    if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#A855F7" /></View>;

    const plPositive = (perf?.total_profit_loss ?? 0) >= 0;

    return (
        <View style={styles.container}>
            <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#A855F7" />}>
                {/* Header */}
                <View style={styles.header}>
                    <Text style={styles.title}>Portfolio</Text>
                    <TouchableOpacity style={styles.investBtn} onPress={() => setModalVisible(true)}>
                        <Ionicons name="add" size={18} color="#000" />
                        <Text style={styles.investBtnText}>Invest</Text>
                    </TouchableOpacity>
                </View>

                {/* Summary Card */}
                <View style={styles.summaryCard}>
                    <View style={styles.summaryRow}>
                        <View style={styles.summaryItem}>
                            <Text style={styles.summaryLabel}>Current Value</Text>
                            <Text style={styles.summaryValue}>₹{perf?.current_value?.toFixed(2) ?? "0.00"}</Text>
                        </View>
                        <View style={styles.summaryItem}>
                            <Text style={styles.summaryLabel}>Total Invested</Text>
                            <Text style={styles.summaryValue}>₹{perf?.total_invested?.toFixed(2) ?? "0.00"}</Text>
                        </View>
                    </View>
                    <View style={[styles.plBadge, { backgroundColor: plPositive ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)" }]}>
                        <Ionicons name={plPositive ? "trending-up" : "trending-down"} size={16} color={plPositive ? "#22C55E" : "#EF4444"} />
                        <Text style={[styles.plText, { color: plPositive ? "#22C55E" : "#EF4444" }]}>
                            {plPositive ? "+" : ""}₹{perf?.total_profit_loss?.toFixed(2) ?? "0.00"} ({perf?.total_profit_loss_pct?.toFixed(2) ?? "0.00"}%)
                        </Text>
                    </View>
                </View>

                {/* Holdings */}
                <Text style={styles.sectionTitle}>Holdings</Text>
                {(!perf?.holdings || perf.holdings.length === 0) ? (
                    <View style={styles.emptyCard}>
                        <Ionicons name="bar-chart-outline" size={40} color="#1A2332" />
                        <Text style={styles.emptyText}>No holdings yet</Text>
                        <Text style={styles.emptySub}>Tap "Invest" to buy your first stock</Text>
                    </View>
                ) : (
                    perf.holdings.map((h: HoldingPerf) => {
                        const pos = h.profit_loss >= 0;
                        return (
                            <View key={h.stock_symbol} style={styles.holdingCard}>
                                <View style={styles.holdingLeft}>
                                    <View style={styles.holdingBadge}><Text style={styles.holdingSymbol}>{h.stock_symbol.slice(0, 4)}</Text></View>
                                    <View>
                                        <Text style={styles.holdingName}>{h.stock_name}</Text>
                                        <Text style={styles.holdingShares}>{h.shares.toFixed(6)} shares · ₹{h.current_price.toFixed(2)}</Text>
                                    </View>
                                </View>
                                <View style={styles.holdingRight}>
                                    <Text style={styles.holdingValue}>₹{h.current_value.toFixed(2)}</Text>
                                    <Text style={[styles.holdingPL, { color: pos ? "#22C55E" : "#EF4444" }]}>
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
                <View style={styles.overlay}>
                    <View style={styles.modalCard}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>{selectedStock ? `Invest in ${selectedStock.symbol}` : "Choose a Stock"}</Text>
                            <TouchableOpacity onPress={() => { setModalVisible(false); setSelectedStock(null); setInvestAmount(""); }}>
                                <Ionicons name="close" size={22} color="#4A5568" />
                            </TouchableOpacity>
                        </View>

                        <Text style={styles.walletNote}>Wallet Balance: <Text style={{ color: "#00D4FF" }}>₹{balance.toFixed(2)}</Text></Text>

                        {!selectedStock ? (
                            <FlatList
                                data={stocks}
                                keyExtractor={(s) => s.symbol}
                                style={{ maxHeight: 340 }}
                                renderItem={({ item }) => (
                                    <TouchableOpacity style={styles.stockRow} onPress={() => setSelectedStock(item)}>
                                        <View style={styles.stockBadge}><Text style={styles.stockSym}>{item.symbol.slice(0, 4)}</Text></View>
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.stockName}>{item.name}</Text>
                                            <Text style={styles.stockPrice}>₹{item.price.toFixed(2)}</Text>
                                        </View>
                                        <Ionicons name="chevron-forward" size={16} color="#4A5568" />
                                    </TouchableOpacity>
                                )}
                            />
                        ) : (
                            <>
                                <TouchableOpacity onPress={() => setSelectedStock(null)} style={styles.changStock}>
                                    <Ionicons name="arrow-back" size={14} color="#00D4FF" />
                                    <Text style={styles.changeText}>Change stock</Text>
                                </TouchableOpacity>
                                <Text style={styles.label}>Amount to Invest (₹)</Text>
                                <TextInput
                                    style={styles.input}
                                    placeholder="e.g. 5.00"
                                    placeholderTextColor="#4A5568"
                                    value={investAmount}
                                    onChangeText={setInvestAmount}
                                    keyboardType="decimal-pad"
                                />
                                {investAmount ? (
                                    <Text style={styles.sharesPreview}>
                                        ≈ {(parseFloat(investAmount) / selectedStock.price).toFixed(6)} fractional shares @ ₹{selectedStock.price}
                                    </Text>
                                ) : null}
                                <TouchableOpacity style={styles.modalBtn} onPress={handleInvest} disabled={investing}>
                                    {investing ? <ActivityIndicator color="#000" /> : <Text style={styles.modalBtnText}>Confirm Investment</Text>}
                                </TouchableOpacity>
                            </>
                        )}
                    </View>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: "#0A0E1A" },
    center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#0A0E1A" },
    header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 24, paddingTop: 56 },
    title: { color: "#FFFFFF", fontSize: 24, fontWeight: "700" },
    investBtn: { flexDirection: "row", alignItems: "center", backgroundColor: "#A855F7", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, gap: 6 },
    investBtnText: { color: "#000", fontWeight: "700", fontSize: 13 },
    summaryCard: { margin: 20, marginTop: 0, backgroundColor: "#0D1117", borderRadius: 20, padding: 22, borderWidth: 1, borderColor: "#1A2332" },
    summaryRow: { flexDirection: "row", marginBottom: 16 },
    summaryItem: { flex: 1 },
    summaryLabel: { color: "#4A5568", fontSize: 11, marginBottom: 4 },
    summaryValue: { color: "#FFFFFF", fontSize: 20, fontWeight: "700" },
    plBadge: { flexDirection: "row", alignItems: "center", padding: 10, borderRadius: 10, gap: 8 },
    plText: { fontWeight: "700", fontSize: 14 },
    sectionTitle: { color: "#8B9BB4", fontSize: 12, fontWeight: "600", letterSpacing: 0.8, paddingHorizontal: 20, marginBottom: 12 },
    emptyCard: { alignItems: "center", padding: 40 },
    emptyText: { color: "#4A5568", fontSize: 15, fontWeight: "600", marginTop: 12 },
    emptySub: { color: "#2D3748", fontSize: 12, marginTop: 4 },
    holdingCard: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: "#0D1117" },
    holdingLeft: { flexDirection: "row", alignItems: "center", gap: 14, flex: 1 },
    holdingBadge: { width: 42, height: 42, borderRadius: 12, backgroundColor: "rgba(168,85,247,0.15)", justifyContent: "center", alignItems: "center" },
    holdingSymbol: { color: "#A855F7", fontSize: 10, fontWeight: "700" },
    holdingName: { color: "#FFFFFF", fontSize: 13, fontWeight: "600" },
    holdingShares: { color: "#4A5568", fontSize: 11, marginTop: 2 },
    holdingRight: { alignItems: "flex-end" },
    holdingValue: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
    holdingPL: { fontSize: 12, fontWeight: "600", marginTop: 2 },
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
    modalCard: { backgroundColor: "#0D1117", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, borderTopWidth: 1, borderColor: "#1A2332", maxHeight: "85%" },
    modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
    modalTitle: { color: "#FFFFFF", fontSize: 18, fontWeight: "700" },
    walletNote: { color: "#4A5568", fontSize: 12, marginBottom: 16 },
    stockRow: { flexDirection: "row", alignItems: "center", padding: 14, borderBottomWidth: 1, borderBottomColor: "#0A0E1A", gap: 14 },
    stockBadge: { width: 38, height: 38, borderRadius: 10, backgroundColor: "rgba(168,85,247,0.15)", justifyContent: "center", alignItems: "center" },
    stockSym: { color: "#A855F7", fontSize: 9, fontWeight: "700" },
    stockName: { color: "#FFFFFF", fontSize: 13, fontWeight: "600" },
    stockPrice: { color: "#4A5568", fontSize: 11 },
    changStock: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 16 },
    changeText: { color: "#00D4FF", fontSize: 13 },
    label: { color: "#8B9BB4", fontSize: 12, fontWeight: "600", marginBottom: 6 },
    input: { backgroundColor: "#0A0E1A", borderRadius: 12, borderWidth: 1, borderColor: "#1A2332", color: "#FFFFFF", paddingHorizontal: 14, height: 50, fontSize: 14, marginBottom: 10 },
    sharesPreview: { color: "#4A5568", fontSize: 12, marginBottom: 16 },
    modalBtn: { backgroundColor: "#A855F7", borderRadius: 12, height: 52, justifyContent: "center", alignItems: "center", marginTop: 8 },
    modalBtnText: { color: "#FFFFFF", fontWeight: "700", fontSize: 16 },
});
