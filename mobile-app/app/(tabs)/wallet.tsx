import React, { useEffect, useState, useCallback, useRef } from "react";
import {
    View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
    RefreshControl, Alert, ActivityIndicator, Modal, Animated,
    Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../context/ThemeContext";
import { walletApi } from "../../services/api";
import { useFocusEffect } from "expo-router";

const { height: SCREEN_H } = Dimensions.get("window");

interface Transaction {
    id: number;
    original_amount: number;
    rounded_amount: number;
    round_up_amount: number;
    transaction_type: string;
    credited: number;  // 0 = pending, 1 = credited
    description: string;
    created_at: string;
}

// ── Quick-amount chip ──────────────────────────────────────────────────────────
const QUICK_AMOUNTS = [100, 500, 1000, 5000];

function QuickChip({ val, selected, onPress, theme }: {
    val: number; selected: boolean; onPress: () => void; theme: any;
}) {
    return (
        <TouchableOpacity
            onPress={onPress}
            style={{
                flex: 1, height: 44, borderRadius: 12, justifyContent: "center", alignItems: "center",
                backgroundColor: selected ? theme.accent : `${theme.accent}18`,
                borderWidth: 1.5,
                borderColor: selected ? theme.accent : `${theme.accent}35`,
            }}
        >
            <Text style={{ color: selected ? (theme.mode === "dark" ? "#000" : "#fff") : theme.accent, fontWeight: "700", fontSize: 14 }}>
                ₹{val}
            </Text>
        </TouchableOpacity>
    );
}

// ── Add Money Bottom Sheet ─────────────────────────────────────────────────────
function AddMoneySheet({ visible, onClose, onSuccess, theme }: {
    visible: boolean; onClose: () => void; onSuccess: () => void; theme: any;
}) {
    const slideAnim = useRef(new Animated.Value(SCREEN_H)).current;
    const [customAmt, setCustomAmt] = useState("");
    const [selectedQuick, setSelectedQuick] = useState<number | null>(null);
    const [note, setNote] = useState("");
    const [adding, setAdding] = useState(false);

    useEffect(() => {
        if (visible) {
            Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, damping: 20, stiffness: 180 }).start();
        } else {
            Animated.timing(slideAnim, { toValue: SCREEN_H, duration: 260, useNativeDriver: true }).start();
            // reset state after close
            setTimeout(() => { setCustomAmt(""); setSelectedQuick(null); setNote(""); }, 300);
        }
    }, [visible]);

    const finalAmount = selectedQuick ?? (parseFloat(customAmt) || 0);

    const handleAdd = async () => {
        if (!finalAmount || finalAmount <= 0)
            return Alert.alert("Invalid", "Please select or enter an amount.");
        setAdding(true);
        try {
            await walletApi.addMoney(finalAmount, note || undefined);
            onClose();
            onSuccess();
            Alert.alert("✅ Money Added!", `₹${finalAmount.toFixed(2)} added to your wallet.`);
        } catch (e: any) {
            Alert.alert("Error", e?.response?.data?.detail ?? "Failed to add money.");
        } finally { setAdding(false); }
    };

    const btnTextColor = theme.mode === "dark" ? "#000" : "#fff";

    return (
        <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
            <TouchableOpacity activeOpacity={1} style={styles.scrim} onPress={onClose} />
            <Animated.View style={[styles.sheet, { backgroundColor: theme.surface, transform: [{ translateY: slideAnim }] }]}>
                {/* Handle */}
                <View style={styles.sheetHandle} />

                {/* Header */}
                <View style={styles.sheetHeader}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                        <View style={[styles.sheetIconBox, { backgroundColor: `${theme.accent}20` }]}>
                            <Ionicons name="wallet-outline" size={20} color={theme.accent} />
                        </View>
                        <View>
                            <Text style={[styles.sheetTitle, { color: theme.text }]}>Add Money</Text>
                            <Text style={{ color: theme.muted, fontSize: 11, marginTop: 1 }}>Credit directly to your wallet</Text>
                        </View>
                    </View>
                    <TouchableOpacity onPress={onClose} style={[styles.closeBtn, { backgroundColor: `${theme.border}` }]}>
                        <Ionicons name="close" size={18} color={theme.muted} />
                    </TouchableOpacity>
                </View>

                {/* Quick amounts */}
                <Text style={[styles.fieldLabel, { color: theme.subtext }]}>Quick Select</Text>
                <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
                    {QUICK_AMOUNTS.map(v => (
                        <QuickChip key={v} val={v} theme={theme}
                            selected={selectedQuick === v}
                            onPress={() => { setSelectedQuick(v); setCustomAmt(""); }} />
                    ))}
                </View>

                {/* Divider */}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 16 }}>
                    <View style={{ flex: 1, height: 1, backgroundColor: theme.border }} />
                    <Text style={{ color: theme.muted, fontSize: 11 }}>or enter custom</Text>
                    <View style={{ flex: 1, height: 1, backgroundColor: theme.border }} />
                </View>

                {/* Custom amount */}
                <Text style={[styles.fieldLabel, { color: theme.subtext }]}>Custom Amount (₹)</Text>
                <TextInput
                    style={[styles.input, { backgroundColor: theme.inputBg, borderColor: customAmt ? theme.accent : theme.border, color: theme.text }]}
                    placeholder="e.g. 2500.00"
                    placeholderTextColor={theme.muted}
                    value={customAmt}
                    onChangeText={v => { setCustomAmt(v); setSelectedQuick(null); }}
                    keyboardType="decimal-pad"
                />

                {/* Note */}
                <Text style={[styles.fieldLabel, { color: theme.subtext }]}>Note (optional)</Text>
                <TextInput
                    style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
                    placeholder="e.g. Monthly savings"
                    placeholderTextColor={theme.muted}
                    value={note}
                    onChangeText={setNote}
                />

                {/* Preview */}
                {finalAmount > 0 && (
                    <View style={[styles.previewBox, { backgroundColor: `${theme.accent}12`, borderColor: `${theme.accent}30` }]}>
                        <Ionicons name="checkmark-circle" size={16} color={theme.accent} />
                        <Text style={{ color: theme.accent, fontSize: 13, fontWeight: "700" }}>
                            ₹{finalAmount.toFixed(2)} will be added to your wallet
                        </Text>
                    </View>
                )}

                {/* Add Button */}
                <TouchableOpacity
                    style={[styles.addBtn, { backgroundColor: theme.accent, opacity: finalAmount > 0 ? 1 : 0.5 }]}
                    onPress={handleAdd}
                    disabled={adding || finalAmount <= 0}
                >
                    {adding
                        ? <ActivityIndicator color={btnTextColor} />
                        : <>
                            <Ionicons name="add-circle-outline" size={20} color={btnTextColor} />
                            <Text style={[styles.addBtnText, { color: btnTextColor }]}>
                                Add ₹{finalAmount > 0 ? finalAmount.toFixed(2) : "—"} to Wallet
                            </Text>
                          </>
                    }
                </TouchableOpacity>
            </Animated.View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    scrim: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.55)" },
    sheet: {
        position: "absolute", bottom: 0, left: 0, right: 0,
        borderTopLeftRadius: 28, borderTopRightRadius: 28,
        padding: 20, paddingBottom: 36,
        shadowColor: "#000", shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.3, shadowRadius: 20, elevation: 30,
    },
    sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.2)", alignSelf: "center", marginBottom: 20 },
    sheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 },
    sheetIconBox: { width: 44, height: 44, borderRadius: 14, justifyContent: "center", alignItems: "center" },
    sheetTitle: { fontSize: 18, fontWeight: "800" },
    closeBtn: { width: 32, height: 32, borderRadius: 10, justifyContent: "center", alignItems: "center" },
    fieldLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5, marginBottom: 8 },
    input: { borderRadius: 12, borderWidth: 1.5, paddingHorizontal: 14, height: 50, fontSize: 15, marginBottom: 14 },
    previewBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 14 },
    addBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 16, height: 54 },
    addBtnText: { fontWeight: "800", fontSize: 16 },
});

// ── Transaction type config ────────────────────────────────────────────────────
function txnConfig(type: string, theme: any) {
    switch (type) {
        case "topup":
            return { icon: "arrow-down-circle", color: "#22C55E", bg: "#22C55E18", label: "Top-Up" };
        case "purchase":
        default:
            return { icon: "cart-outline", color: theme.accent, bg: `${theme.accent}18`, label: "Round-Up" };
    }
}

// ── Main Screen ────────────────────────────────────────────────────────────────
export default function WalletScreen() {
    const { theme } = useTheme();
    const [summary, setSummary] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    // Spend modal
    const [spendModal, setSpendModal] = useState(false);
    const [spendAmt, setSpendAmt] = useState("");
    const [spendDesc, setSpendDesc] = useState("");
    const [addingSpend, setAddingSpend] = useState(false);

    // Add money sheet
    const [addMoneyVisible, setAddMoneyVisible] = useState(false);

    const fetchSummary = useCallback(async () => {
        try {
            const res = await walletApi.summary();
            setSummary(res.data);
        } catch { /* ignore */ }
        finally { setLoading(false); setRefreshing(false); }
    }, []);

    useFocusEffect(useCallback(() => { fetchSummary(); }, [fetchSummary]));
    const onRefresh = () => { setRefreshing(true); fetchSummary(); };

    const handleAddSpend = async () => {
        const val = parseFloat(spendAmt);
        if (!val || val <= 0) return Alert.alert("Invalid", "Enter a valid amount.");
        setAddingSpend(true);
        try {
            const res = await walletApi.addTransaction(val, spendDesc || "Purchase");
            const txn = res.data;
            setSpendModal(false); setSpendAmt(""); setSpendDesc("");
            fetchSummary();
            
            // Show suggestion to add round-up to wallet
            Alert.alert(
                "✅ Purchase Logged!",
                `Round-up of ₹${txn.round_up_amount.toFixed(2)} is ready to be added to your wallet.\n\nCheck your transactions to add it.`,
                [{ text: "Got it", style: "default" }]
            );
        } catch (e: any) {
            Alert.alert("Error", e?.response?.data?.detail ?? "Failed to add transaction.");
        } finally { setAddingSpend(false); }
    };

    const handleCreditTransaction = async (txn: Transaction) => {
        Alert.alert(
            "Add to Wallet?",
            `Add ₹${txn.round_up_amount.toFixed(2)} round-up from this purchase to your investment wallet?`,
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Add to Wallet",
                    style: "default",
                    onPress: async () => {
                        try {
                            await walletApi.creditTransaction(txn.id);
                            fetchSummary();
                            Alert.alert("✅ Added!", `₹${txn.round_up_amount.toFixed(2)} added to your wallet.`);
                        } catch (e: any) {
                            Alert.alert("Error", e?.response?.data?.detail ?? "Failed to credit transaction.");
                        }
                    }
                }
            ]
        );
    };

    const roundUp = (val: string) => {
        const n = parseFloat(val);
        if (!n) return "—";
        // Round to next whole rupee
        const rounded = Math.ceil(n);
        const spare = rounded - n;
        // Add ₹1 to the spare change
        const total = spare + 1.0;
        return `₹${total.toFixed(2)}`;
    };

    const btnTextColor = theme.mode === "dark" ? "#000" : "#fff";
    const totalTopUps = summary?.transactions?.filter((t: Transaction) => t.transaction_type === "topup")
        .reduce((s: number, t: Transaction) => s + t.round_up_amount, 0) ?? 0;
    const totalRoundUps = summary?.transactions?.filter((t: Transaction) => t.transaction_type !== "topup" && t.credited === 1)
        .reduce((s: number, t: Transaction) => s + t.round_up_amount, 0) ?? 0;
    const pendingTransactions = summary?.transactions?.filter((t: Transaction) => t.credited === 0 && t.transaction_type !== "topup") ?? [];
    const totalPending = pendingTransactions.reduce((s: number, t: Transaction) => s + t.round_up_amount, 0);

    if (loading) {
        return <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: theme.bg }}>
            <ActivityIndicator size="large" color={theme.accent} />
        </View>;
    }

    return (
        <View style={{ flex: 1, backgroundColor: theme.bg }}>
            <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />}>

                {/* Header */}
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 24, paddingTop: 56 }}>
                    <Text style={{ color: theme.text, fontSize: 24, fontWeight: "700", flex: 1 }}>Wallet</Text>
                    <View style={{ flexDirection: "row", gap: 8, flexShrink: 0 }}>
                        {/* Add Money Button */}
                        <TouchableOpacity
                            style={{ flexDirection: "row", alignItems: "center", backgroundColor: "#22C55E", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, gap: 6 }}
                            onPress={() => setAddMoneyVisible(true)}
                        >
                            <Ionicons name="wallet-outline" size={16} color="#fff" />
                            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 12 }}>Add Money</Text>
                        </TouchableOpacity>
                        {/* Log Spend Button */}
                        <TouchableOpacity
                            style={{ flexDirection: "row", alignItems: "center", backgroundColor: theme.accent, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, gap: 6 }}
                            onPress={() => setSpendModal(true)}
                        >
                            <Ionicons name="add" size={16} color={btnTextColor} />
                            <Text style={{ color: btnTextColor, fontWeight: "700", fontSize: 12 }}>Log Spend</Text>
                        </TouchableOpacity>
                    </View>
                </View>

                {/* Balance Card */}
                <View style={{ margin: 20, marginTop: 0, backgroundColor: theme.card, borderRadius: 24, padding: 24, borderWidth: 1, borderColor: theme.border, alignItems: "center" }}>
                    <Text style={{ color: theme.muted, fontSize: 12, marginBottom: 6 }}>Investment Balance</Text>
                    <Text style={{ color: theme.accent, fontSize: 44, fontWeight: "800", letterSpacing: -1 }}>
                        ₹{summary?.balance?.toFixed(2) ?? "0.00"}
                    </Text>

                    {/* 3-stat row */}
                    <View style={{ flexDirection: "row", marginTop: 20, width: "100%" }}>
                        <View style={{ flex: 1, alignItems: "center" }}>
                            <Text style={{ color: "#22C55E", fontSize: 15, fontWeight: "700" }}>₹{totalTopUps.toFixed(2)}</Text>
                            <Text style={{ color: theme.muted, fontSize: 10, marginTop: 2 }}>Added Directly</Text>
                        </View>
                        <View style={{ width: 1, backgroundColor: theme.divider }} />
                        <View style={{ flex: 1, alignItems: "center" }}>
                            <Text style={{ color: theme.accent, fontSize: 15, fontWeight: "700" }}>₹{totalRoundUps.toFixed(2)}</Text>
                            <Text style={{ color: theme.muted, fontSize: 10, marginTop: 2 }}>Round-Ups</Text>
                        </View>
                        <View style={{ width: 1, backgroundColor: theme.divider }} />
                        <View style={{ flex: 1, alignItems: "center" }}>
                            <Text style={{ color: theme.text, fontSize: 15, fontWeight: "700" }}>{summary?.transaction_count ?? 0}</Text>
                            <Text style={{ color: theme.muted, fontSize: 10, marginTop: 2 }}>Transactions</Text>
                        </View>
                    </View>
                </View>

                {/* Quick Add Strips */}
                <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 20, marginBottom: 20 }}>
                    {[100, 500, 1000].map(v => (
                        <TouchableOpacity key={v}
                            style={{ flex: 1, height: 42, borderRadius: 10, justifyContent: "center", alignItems: "center", backgroundColor: "#22C55E18", borderWidth: 1, borderColor: "#22C55E35" }}
                            onPress={async () => {
                                try {
                                    await walletApi.addMoney(v);
                                    fetchSummary();
                                    Alert.alert("✅ Added!", `₹${v} added to wallet.`);
                                } catch { Alert.alert("Error", "Failed to add money."); }
                            }}
                        >
                            <Text style={{ color: "#22C55E", fontWeight: "700", fontSize: 13 }}>+ ₹{v}</Text>
                        </TouchableOpacity>
                    ))}
                </View>

                {/* Info Banner */}
                <View style={{ flexDirection: "row", marginHorizontal: 20, marginBottom: 20, backgroundColor: theme.accentDim, borderRadius: 12, padding: 14, gap: 10, borderWidth: 1, borderColor: theme.accentBorder, alignItems: "flex-start" }}>
                    <Ionicons name="information-circle-outline" size={16} color={theme.accent} />
                    <Text style={{ color: theme.subtext, fontSize: 12, flex: 1, lineHeight: 18 }}>
                        Log purchases to round up to next ₹ + add ₹1 extra (e.g., ₹47.30 → ₹1.70 saved), or add money directly.
                    </Text>
                </View>

                {/* Pending Transactions Banner */}
                {pendingTransactions.length > 0 && (
                    <View style={{ marginHorizontal: 20, marginBottom: 20, backgroundColor: "#FFA50015", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#FFA50030" }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 }}>
                            <Ionicons name="time-outline" size={18} color="#FFA500" />
                            <Text style={{ color: "#FFA500", fontSize: 14, fontWeight: "700", flex: 1 }}>
                                {pendingTransactions.length} Pending Round-Up{pendingTransactions.length > 1 ? "s" : ""}
                            </Text>
                            <Text style={{ color: "#FFA500", fontSize: 15, fontWeight: "800" }}>
                                ₹{totalPending.toFixed(2)}
                            </Text>
                        </View>
                        <Text style={{ color: theme.subtext, fontSize: 11, lineHeight: 16 }}>
                            Tap "Add to Wallet" on any transaction below to credit the round-up to your investment balance.
                        </Text>
                    </View>
                )}

                {/* Transaction History */}
                <Text style={{ color: theme.subtext, fontSize: 11, fontWeight: "700", letterSpacing: 1, paddingHorizontal: 20, marginBottom: 12 }}>
                    RECENT TRANSACTIONS
                </Text>

                {(!summary?.transactions || summary.transactions.length === 0) ? (
                    <View style={{ alignItems: "center", padding: 40 }}>
                        <Ionicons name="receipt-outline" size={40} color={theme.border} />
                        <Text style={{ color: theme.muted, fontSize: 15, fontWeight: "600", marginTop: 12 }}>No transactions yet</Text>
                        <Text style={{ color: theme.muted, fontSize: 12, marginTop: 4, opacity: 0.6 }}>Add money or log a purchase to get started</Text>
                    </View>
                ) : (
                    summary.transactions.map((txn: Transaction) => {
                        const cfg = txnConfig(txn.transaction_type, theme);
                        const isTopup = txn.transaction_type === "topup";
                        const isPending = txn.credited === 0 && !isTopup;
                        
                        return (
                            <View key={txn.id} style={{ paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.divider }}>
                                <View style={{ flexDirection: "row", alignItems: "center" }}>
                                    {/* Icon */}
                                    <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: cfg.bg, justifyContent: "center", alignItems: "center", marginRight: 14 }}>
                                        <Ionicons name={cfg.icon as any} size={22} color={cfg.color} />
                                    </View>
                                    {/* Info */}
                                    <View style={{ flex: 1 }}>
                                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                            <Text style={{ color: theme.text, fontSize: 14, fontWeight: "600" }}>
                                                {txn.description || (isTopup ? "Manual Top-Up" : "Purchase")}
                                            </Text>
                                            <View style={{ backgroundColor: cfg.bg, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 }}>
                                                <Text style={{ color: cfg.color, fontSize: 9, fontWeight: "700" }}>{cfg.label}</Text>
                                            </View>
                                            {isPending && (
                                                <View style={{ backgroundColor: "#FFA50020", borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 }}>
                                                    <Text style={{ color: "#FFA500", fontSize: 9, fontWeight: "700" }}>PENDING</Text>
                                                </View>
                                            )}
                                        </View>
                                        <Text style={{ color: theme.muted, fontSize: 11, marginTop: 2 }}>
                                            {new Date(txn.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                                        </Text>
                                    </View>
                                    {/* Amounts */}
                                    <View style={{ alignItems: "flex-end" }}>
                                        {isTopup ? (
                                            <Text style={{ color: "#22C55E", fontSize: 15, fontWeight: "700" }}>+₹{txn.round_up_amount.toFixed(2)}</Text>
                                        ) : (
                                            <>
                                                <Text style={{ color: theme.text, fontSize: 14, fontWeight: "600" }}>₹{txn.original_amount.toFixed(2)}</Text>
                                                <Text style={{ color: isPending ? "#FFA500" : theme.accent, fontSize: 11, marginTop: 2 }}>
                                                    {isPending ? "₹" : "+₹"}{txn.round_up_amount.toFixed(2)} {isPending ? "ready" : "saved"}
                                                </Text>
                                            </>
                                        )}
                                    </View>
                                </View>
                                
                                {/* Add to Wallet Button for Pending Transactions */}
                                {isPending && (
                                    <TouchableOpacity
                                        style={{
                                            marginTop: 10,
                                            backgroundColor: `${theme.accent}15`,
                                            borderRadius: 10,
                                            paddingVertical: 10,
                                            paddingHorizontal: 14,
                                            flexDirection: "row",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            gap: 6,
                                            borderWidth: 1,
                                            borderColor: `${theme.accent}30`,
                                        }}
                                        onPress={() => handleCreditTransaction(txn)}
                                    >
                                        <Ionicons name="add-circle" size={16} color={theme.accent} />
                                        <Text style={{ color: theme.accent, fontSize: 13, fontWeight: "700" }}>
                                            Add ₹{txn.round_up_amount.toFixed(2)} to Wallet
                                        </Text>
                                    </TouchableOpacity>
                                )}
                            </View>
                        );
                    })
                )}
                <View style={{ height: 40 }} />
            </ScrollView>

            {/* ── Add Money Sheet ── */}
            <AddMoneySheet
                visible={addMoneyVisible}
                onClose={() => setAddMoneyVisible(false)}
                onSuccess={fetchSummary}
                theme={theme}
            />

            {/* ── Log Spend Modal ── */}
            <Modal visible={spendModal} transparent animationType="slide">
                <View style={{ flex: 1, backgroundColor: theme.overlayBg, justifyContent: "flex-end" }}>
                    <View style={{ backgroundColor: theme.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, borderTopWidth: 1, borderColor: theme.border }}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                            <Text style={{ color: theme.text, fontSize: 18, fontWeight: "700" }}>Log a Purchase</Text>
                            <TouchableOpacity onPress={() => setSpendModal(false)}>
                                <Ionicons name="close" size={22} color={theme.muted} />
                            </TouchableOpacity>
                        </View>

                        <Text style={{ color: theme.subtext, fontSize: 11, fontWeight: "700", marginBottom: 6 }}>Amount Spent (₹)</Text>
                        <TextInput
                            style={{ backgroundColor: theme.inputBg, borderRadius: 12, borderWidth: 1, borderColor: theme.border, color: theme.text, paddingHorizontal: 14, height: 50, fontSize: 14, marginBottom: 10 }}
                            placeholder="e.g. 47.30"
                            placeholderTextColor={theme.muted}
                            value={spendAmt}
                            onChangeText={setSpendAmt}
                            keyboardType="decimal-pad"
                        />

                        {spendAmt ? (
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 14, backgroundColor: theme.accentDim, padding: 10, borderRadius: 10 }}>
                                <Ionicons name="sparkles-outline" size={14} color={theme.accent} />
                                <Text style={{ color: theme.subtext, fontSize: 12, flex: 1 }}>
                                    Round-up credited: <Text style={{ color: theme.accent, fontWeight: "700" }}>{roundUp(spendAmt)}</Text>
                                </Text>
                            </View>
                        ) : null}

                        <Text style={{ color: theme.subtext, fontSize: 11, fontWeight: "700", marginBottom: 6 }}>Description (optional)</Text>
                        <TextInput
                            style={{ backgroundColor: theme.inputBg, borderRadius: 12, borderWidth: 1, borderColor: theme.border, color: theme.text, paddingHorizontal: 14, height: 50, fontSize: 14, marginBottom: 16 }}
                            placeholder="e.g. Coffee at Cafe"
                            placeholderTextColor={theme.muted}
                            value={spendDesc}
                            onChangeText={setSpendDesc}
                        />

                        <TouchableOpacity
                            style={{ backgroundColor: theme.accent, borderRadius: 12, height: 52, justifyContent: "center", alignItems: "center" }}
                            onPress={handleAddSpend}
                            disabled={addingSpend}
                        >
                            {addingSpend
                                ? <ActivityIndicator color={btnTextColor} />
                                : <Text style={{ color: btnTextColor, fontWeight: "700", fontSize: 16 }}>Add Transaction</Text>}
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>
        </View>
    );
}
