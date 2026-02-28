import React, { useEffect, useState, useCallback } from "react";
import {
    View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
    RefreshControl, Alert, ActivityIndicator, Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
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

    if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#00D4FF" /></View>;

    return (
        <View style={styles.container}>
            <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00D4FF" />}>

                {/* Header */}
                <View style={styles.header}>
                    <Text style={styles.title}>Wallet</Text>
                    <TouchableOpacity style={styles.addBtn} onPress={() => setModalVisible(true)}>
                        <Ionicons name="add" size={20} color="#000" />
                        <Text style={styles.addBtnText}>Add Spend</Text>
                    </TouchableOpacity>
                </View>

                {/* Balance Card */}
                <View style={styles.balanceCard}>
                    <Text style={styles.balLabel}>Investment Balance</Text>
                    <Text style={styles.balAmount}>₹{summary?.balance?.toFixed(2) ?? "0.00"}</Text>
                    <View style={styles.balRow}>
                        <View style={styles.balStat}>
                            <Text style={styles.balStatVal}>₹{summary?.total_invested?.toFixed(2) ?? "0.00"}</Text>
                            <Text style={styles.balStatLabel}>Total Round-Ups</Text>
                        </View>
                        <View style={styles.balDivider} />
                        <View style={styles.balStat}>
                            <Text style={styles.balStatVal}>{summary?.transaction_count ?? 0}</Text>
                            <Text style={styles.balStatLabel}>Transactions</Text>
                        </View>
                    </View>
                </View>

                {/* How round-up works */}
                <View style={styles.infoCard}>
                    <Ionicons name="information-circle-outline" size={16} color="#00D4FF" />
                    <Text style={styles.infoText}>
                        Every purchase is rounded up to the next ₹. The spare change goes to your investment wallet!
                    </Text>
                </View>

                {/* Transaction History */}
                <Text style={styles.sectionTitle}>Recent Transactions</Text>
                {(!summary?.transactions || summary.transactions.length === 0) ? (
                    <View style={styles.emptyCard}>
                        <Ionicons name="receipt-outline" size={40} color="#1A2332" />
                        <Text style={styles.emptyText}>No transactions yet</Text>
                        <Text style={styles.emptySubText}>Tap "Add Spend" to log your first purchase</Text>
                    </View>
                ) : (
                    summary.transactions.map((txn: Transaction) => (
                        <View key={txn.id} style={styles.txnCard}>
                            <View style={styles.txnIcon}>
                                <Ionicons name="cart-outline" size={20} color="#00D4FF" />
                            </View>
                            <View style={styles.txnInfo}>
                                <Text style={styles.txnDesc}>{txn.description || "Purchase"}</Text>
                                <Text style={styles.txnDate}>{new Date(txn.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</Text>
                            </View>
                            <View style={styles.txnAmounts}>
                                <Text style={styles.txnOriginal}>₹{txn.original_amount.toFixed(2)}</Text>
                                <Text style={styles.txnRoundup}>+₹{txn.round_up_amount.toFixed(2)} saved</Text>
                            </View>
                        </View>
                    ))
                )}
                <View style={{ height: 40 }} />
            </ScrollView>

            {/* Add Transaction Modal */}
            <Modal visible={modalVisible} transparent animationType="slide">
                <View style={styles.modalOverlay}>
                    <View style={styles.modalCard}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>Log a Purchase</Text>
                            <TouchableOpacity onPress={() => setModalVisible(false)}>
                                <Ionicons name="close" size={22} color="#4A5568" />
                            </TouchableOpacity>
                        </View>

                        <Text style={styles.label}>Amount Spent (₹)</Text>
                        <TextInput
                            style={styles.input}
                            placeholder="e.g. 47.30"
                            placeholderTextColor="#4A5568"
                            value={amount}
                            onChangeText={setAmount}
                            keyboardType="decimal-pad"
                        />

                        {amount ? (
                            <View style={styles.previewRow}>
                                <Ionicons name="sparkles-outline" size={14} color="#00D4FF" />
                                <Text style={styles.previewText}>Round-up amount credited to wallet: <Text style={styles.previewAmount}>{roundUp(amount)}</Text></Text>
                            </View>
                        ) : null}

                        <Text style={styles.label}>Description (optional)</Text>
                        <TextInput
                            style={styles.input}
                            placeholder="e.g. Coffee at Cafe"
                            placeholderTextColor="#4A5568"
                            value={description}
                            onChangeText={setDescription}
                        />

                        <TouchableOpacity style={styles.modalBtn} onPress={handleAdd} disabled={adding}>
                            {adding ? <ActivityIndicator color="#000" /> : <Text style={styles.modalBtnText}>Add Transaction</Text>}
                        </TouchableOpacity>
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
    addBtn: { flexDirection: "row", alignItems: "center", backgroundColor: "#00D4FF", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, gap: 6 },
    addBtnText: { color: "#000", fontWeight: "700", fontSize: 13 },
    balanceCard: { margin: 20, marginTop: 0, backgroundColor: "#0D1117", borderRadius: 20, padding: 24, borderWidth: 1, borderColor: "#1A2332", alignItems: "center" },
    balLabel: { color: "#4A5568", fontSize: 12, marginBottom: 8 },
    balAmount: { color: "#00D4FF", fontSize: 40, fontWeight: "800" },
    balRow: { flexDirection: "row", marginTop: 20, width: "100%" },
    balStat: { flex: 1, alignItems: "center" },
    balStatVal: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
    balStatLabel: { color: "#4A5568", fontSize: 11, marginTop: 2 },
    balDivider: { width: 1, backgroundColor: "#1A2332" },
    infoCard: { flexDirection: "row", marginHorizontal: 20, marginBottom: 20, backgroundColor: "rgba(0,212,255,0.06)", borderRadius: 12, padding: 14, gap: 10, borderWidth: 1, borderColor: "rgba(0,212,255,0.15)", alignItems: "flex-start" },
    infoText: { color: "#8B9BB4", fontSize: 12, flex: 1, lineHeight: 18 },
    sectionTitle: { color: "#8B9BB4", fontSize: 12, fontWeight: "600", letterSpacing: 0.8, paddingHorizontal: 20, marginBottom: 12 },
    emptyCard: { alignItems: "center", padding: 40 },
    emptyText: { color: "#4A5568", fontSize: 15, fontWeight: "600", marginTop: 12 },
    emptySubText: { color: "#2D3748", fontSize: 12, marginTop: 4 },
    txnCard: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#0D1117" },
    txnIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: "rgba(0,212,255,0.1)", justifyContent: "center", alignItems: "center", marginRight: 14 },
    txnInfo: { flex: 1 },
    txnDesc: { color: "#FFFFFF", fontSize: 14, fontWeight: "600" },
    txnDate: { color: "#4A5568", fontSize: 11, marginTop: 2 },
    txnAmounts: { alignItems: "flex-end" },
    txnOriginal: { color: "#FFFFFF", fontSize: 14, fontWeight: "600" },
    txnRoundup: { color: "#22C55E", fontSize: 11, marginTop: 2 },
    // Modal
    modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
    modalCard: { backgroundColor: "#0D1117", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, borderTopWidth: 1, borderColor: "#1A2332" },
    modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 24 },
    modalTitle: { color: "#FFFFFF", fontSize: 18, fontWeight: "700" },
    label: { color: "#8B9BB4", fontSize: 12, fontWeight: "600", marginBottom: 6, letterSpacing: 0.5 },
    input: { backgroundColor: "#0A0E1A", borderRadius: 12, borderWidth: 1, borderColor: "#1A2332", color: "#FFFFFF", paddingHorizontal: 14, height: 50, fontSize: 14, marginBottom: 16 },
    previewRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 16, backgroundColor: "rgba(0,212,255,0.06)", padding: 10, borderRadius: 10 },
    previewText: { color: "#8B9BB4", fontSize: 12, flex: 1 },
    previewAmount: { color: "#00D4FF", fontWeight: "700" },
    modalBtn: { backgroundColor: "#00D4FF", borderRadius: 12, height: 52, justifyContent: "center", alignItems: "center", marginTop: 8 },
    modalBtnText: { color: "#000", fontWeight: "700", fontSize: 16 },
});
