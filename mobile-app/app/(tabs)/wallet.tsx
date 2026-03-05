import React, { useEffect, useState, useCallback } from "react";
import {
    View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
    RefreshControl, Alert, ActivityIndicator, Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../context/ThemeContext";
import { walletApi } from "../../services/api";

interface Transaction {
    id: number;
    original_amount: number;
    rounded_amount: number;
    round_up_amount: number;
    transaction_type: string;
    description: string;
    created_at: string;
}

export default function WalletScreen() {
    const { theme } = useTheme();
    const [summary, setSummary] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [modalVisible, setModalVisible] = useState(false);
    const [amount, setAmount] = useState("");
    const [description, setDescription] = useState("");
    const [adding, setAdding] = useState(false);

    const fetchSummary = useCallback(async () => {
        try {
            const res = await walletApi.summary();
            setSummary(res.data);
        } catch { /* ignore */ }
        finally { setLoading(false); setRefreshing(false); }
    }, []);

    useEffect(() => { fetchSummary(); }, []);
    const onRefresh = () => { setRefreshing(true); fetchSummary(); };

    const handleAdd = async () => {
        const val = parseFloat(amount);
        if (!val || val <= 0) return Alert.alert("Invalid", "Enter a valid amount.");
        setAdding(true);
        try {
            await walletApi.addTransaction(val, description || "Purchase");
            setModalVisible(false);
            setAmount(""); setDescription("");
            fetchSummary();
        } catch (e: any) {
            Alert.alert("Error", e?.response?.data?.detail ?? "Failed to add transaction.");
        } finally { setAdding(false); }
    };

    const roundUp = (val: string) => {
        const n = parseFloat(val);
        if (!n) return "—";
        const rounded = Math.ceil(n);
        const spare = (rounded === n ? rounded + 1 : rounded) - n;
        return `₹${spare.toFixed(2)}`;
    };

    const s = makeStyles(theme);

    if (loading) return <View style={s.center}><ActivityIndicator size="large" color={theme.accent} /></View>;

    return (
        <View style={s.container}>
            <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />}>

                {/* Header */}
                <View style={s.header}>
                    <Text style={s.title}>Wallet</Text>
                    <TouchableOpacity style={s.addBtn} onPress={() => setModalVisible(true)}>
                        <Ionicons name="add" size={20} color={theme.mode === "dark" ? "#000" : "#fff"} />
                        <Text style={s.addBtnText}>Add Spend</Text>
                    </TouchableOpacity>
                </View>

                {/* Balance Card */}
                <View style={s.balanceCard}>
                    <Text style={s.balLabel}>Investment Balance</Text>
                    <Text style={s.balAmount}>₹{summary?.balance?.toFixed(2) ?? "0.00"}</Text>
                    <View style={s.balRow}>
                        <View style={s.balStat}>
                            <Text style={s.balStatVal}>₹{summary?.total_invested?.toFixed(2) ?? "0.00"}</Text>
                            <Text style={s.balStatLabel}>Total Round-Ups</Text>
                        </View>
                        <View style={s.balDivider} />
                        <View style={s.balStat}>
                            <Text style={s.balStatVal}>{summary?.transaction_count ?? 0}</Text>
                            <Text style={s.balStatLabel}>Transactions</Text>
                        </View>
                    </View>
                </View>

                {/* Info Banner */}
                <View style={s.infoCard}>
                    <Ionicons name="information-circle-outline" size={16} color={theme.accent} />
                    <Text style={s.infoText}>
                        Every purchase is rounded up to the next ₹. The spare change goes to your investment wallet!
                    </Text>
                </View>

                {/* Transaction History */}
                <Text style={s.sectionTitle}>RECENT TRANSACTIONS</Text>
                {(!summary?.transactions || summary.transactions.length === 0) ? (
                    <View style={s.emptyCard}>
                        <Ionicons name="receipt-outline" size={40} color={theme.border} />
                        <Text style={s.emptyText}>No transactions yet</Text>
                        <Text style={s.emptySubText}>Tap "Add Spend" to log your first purchase</Text>
                    </View>
                ) : (
                    summary.transactions.map((txn: Transaction) => (
                        <View key={txn.id} style={s.txnCard}>
                            <View style={s.txnIcon}>
                                <Ionicons name="cart-outline" size={20} color={theme.accent} />
                            </View>
                            <View style={s.txnInfo}>
                                <Text style={s.txnDesc}>{txn.description || "Purchase"}</Text>
                                <Text style={s.txnDate}>
                                    {new Date(txn.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                                </Text>
                            </View>
                            <View style={s.txnAmounts}>
                                <Text style={s.txnOriginal}>₹{txn.original_amount.toFixed(2)}</Text>
                                <Text style={s.txnRoundup}>+₹{txn.round_up_amount.toFixed(2)} saved</Text>
                            </View>
                        </View>
                    ))
                )}
                <View style={{ height: 40 }} />
            </ScrollView>

            {/* Add Transaction Modal */}
            <Modal visible={modalVisible} transparent animationType="slide">
                <View style={s.modalOverlay}>
                    <View style={s.modalCard}>
                        <View style={s.modalHeader}>
                            <Text style={s.modalTitle}>Log a Purchase</Text>
                            <TouchableOpacity onPress={() => setModalVisible(false)}>
                                <Ionicons name="close" size={22} color={theme.muted} />
                            </TouchableOpacity>
                        </View>

                        <Text style={s.label}>Amount Spent (₹)</Text>
                        <TextInput
                            style={s.input}
                            placeholder="e.g. 47.30"
                            placeholderTextColor={theme.muted}
                            value={amount}
                            onChangeText={setAmount}
                            keyboardType="decimal-pad"
                        />

                        {amount ? (
                            <View style={s.previewRow}>
                                <Ionicons name="sparkles-outline" size={14} color={theme.accent} />
                                <Text style={s.previewText}>
                                    Round-up credited: <Text style={s.previewAmount}>{roundUp(amount)}</Text>
                                </Text>
                            </View>
                        ) : null}

                        <Text style={s.label}>Description (optional)</Text>
                        <TextInput
                            style={s.input}
                            placeholder="e.g. Coffee at Cafe"
                            placeholderTextColor={theme.muted}
                            value={description}
                            onChangeText={setDescription}
                        />

                        <TouchableOpacity style={s.modalBtn} onPress={handleAdd} disabled={adding}>
                            {adding
                                ? <ActivityIndicator color={theme.mode === "dark" ? "#000" : "#fff"} />
                                : <Text style={s.modalBtnText}>Add Transaction</Text>}
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

function makeStyles(t: ReturnType<typeof import("../../context/ThemeContext").useTheme>["theme"]) {
    const btnText = t.mode === "dark" ? "#000" : "#fff";
    return StyleSheet.create({
        container: { flex: 1, backgroundColor: t.bg },
        center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: t.bg },
        header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 24, paddingTop: 56 },
        title: { color: t.text, fontSize: 24, fontWeight: "700" },
        iconBtn: { padding: 8, backgroundColor: t.surface, borderRadius: 10, borderWidth: 1, borderColor: t.border },
        addBtn: { flexDirection: "row", alignItems: "center", backgroundColor: t.accent, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, gap: 6 },
        addBtnText: { color: btnText, fontWeight: "700", fontSize: 13 },
        balanceCard: { margin: 20, marginTop: 0, backgroundColor: t.card, borderRadius: 20, padding: 24, borderWidth: 1, borderColor: t.border, alignItems: "center" },
        balLabel: { color: t.muted, fontSize: 12, marginBottom: 8 },
        balAmount: { color: t.accent, fontSize: 40, fontWeight: "800" },
        balRow: { flexDirection: "row", marginTop: 20, width: "100%" },
        balStat: { flex: 1, alignItems: "center" },
        balStatVal: { color: t.text, fontSize: 16, fontWeight: "700" },
        balStatLabel: { color: t.muted, fontSize: 11, marginTop: 2 },
        balDivider: { width: 1, backgroundColor: t.divider },
        infoCard: { flexDirection: "row", marginHorizontal: 20, marginBottom: 20, backgroundColor: t.accentDim, borderRadius: 12, padding: 14, gap: 10, borderWidth: 1, borderColor: t.accentBorder, alignItems: "flex-start" },
        infoText: { color: t.subtext, fontSize: 12, flex: 1, lineHeight: 18 },
        sectionTitle: { color: t.subtext, fontSize: 11, fontWeight: "700", letterSpacing: 1, paddingHorizontal: 20, marginBottom: 12 },
        emptyCard: { alignItems: "center", padding: 40 },
        emptyText: { color: t.muted, fontSize: 15, fontWeight: "600", marginTop: 12 },
        emptySubText: { color: t.muted, fontSize: 12, marginTop: 4, opacity: 0.6 },
        txnCard: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: t.divider },
        txnIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: t.accentDim, justifyContent: "center", alignItems: "center", marginRight: 14 },
        txnInfo: { flex: 1 },
        txnDesc: { color: t.text, fontSize: 14, fontWeight: "600" },
        txnDate: { color: t.muted, fontSize: 11, marginTop: 2 },
        txnAmounts: { alignItems: "flex-end" },
        txnOriginal: { color: t.text, fontSize: 14, fontWeight: "600" },
        txnRoundup: { color: t.green, fontSize: 11, marginTop: 2 },
        modalOverlay: { flex: 1, backgroundColor: t.overlayBg, justifyContent: "flex-end" },
        modalCard: { backgroundColor: t.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, borderTopWidth: 1, borderColor: t.border },
        modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 24 },
        modalTitle: { color: t.text, fontSize: 18, fontWeight: "700" },
        label: { color: t.subtext, fontSize: 12, fontWeight: "600", marginBottom: 6, letterSpacing: 0.5 },
        input: { backgroundColor: t.inputBg, borderRadius: 12, borderWidth: 1, borderColor: t.border, color: t.text, paddingHorizontal: 14, height: 50, fontSize: 14, marginBottom: 16 },
        previewRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 16, backgroundColor: t.accentDim, padding: 10, borderRadius: 10 },
        previewText: { color: t.subtext, fontSize: 12, flex: 1 },
        previewAmount: { color: t.accent, fontWeight: "700" },
        modalBtn: { backgroundColor: t.accent, borderRadius: 12, height: 52, justifyContent: "center", alignItems: "center", marginTop: 8 },
        modalBtnText: { color: btnText, fontWeight: "700", fontSize: 16 },
    });
}
