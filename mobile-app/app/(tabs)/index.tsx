import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity,
    RefreshControl, ActivityIndicator, TextInput, Modal,
    Dimensions, StatusBar, SafeAreaView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { WebView } from "react-native-webview";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import { walletApi, portfolioApi } from "../../services/api";
import { router } from "expo-router";

// ── Stock chart — Lightweight Charts + backend yfinance endpoint ──────────────
function buildChartHtml(symbol: string, height: number, scrollEnabled: boolean) {
    const clean = symbol
        .replace(/^(NSE:|BSE:)/i, "")
        .replace(/\.(NS|BO)$/i, "")
        .trim()
        .toUpperCase();
    const apiUrl = `http://172.168.3.112:8000/portfolio/stocks/${clean}/history`;
    const scroll = scrollEnabled ? "true" : "false";

    return `<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body, html { background:#111827; overflow:hidden; font-family:sans-serif; }
  #chart { width:100%; height:${height}px; }
  .overlay { position:absolute; inset:0; display:flex; flex-direction:column;
             align-items:center; justify-content:center; background:#111827; }
  .msg { color:#9CA3AF; font-size:12px; margin-top:8px; }
  .dot { width:8px; height:8px; border-radius:50%; background:#F59E0B;
          animation:pulse 1s infinite alternate; }
  @keyframes pulse { from{opacity:0.3} to{opacity:1} }
  .sym { color:#F59E0B; font-size:13px; font-weight:700; margin-bottom:4px; }
  .err { color:#EF4444; font-size:11px; text-align:center; padding:8px; }
</style>
</head><body>
<div id="wrapper" style="position:relative;width:100%;height:${height}px">
  <div id="chart"></div>
  <div class="overlay" id="overlay">
    <div class="sym">${clean}</div>
    <div class="dot"></div>
    <div class="msg">Loading chart…</div>
  </div>
</div>
<script src="https://unpkg.com/lightweight-charts@4.1.1/dist/lightweight-charts.standalone.production.js"><\/script>
<script>
(function() {
  var h = ${height};
  var enableScroll = ${scroll};
  fetch('${apiUrl}')
    .then(function(r){ return r.json(); })
    .then(function(data) {
      var candles = data.candles;
      if (!candles || candles.length === 0) throw new Error('empty');
      candles.sort(function(a,b){ return a.time - b.time; });
      document.getElementById('overlay').style.display = 'none';
      var chart = LightweightCharts.createChart(document.getElementById('chart'), {
        width: window.innerWidth,
        height: h,
        layout: { background:{color:'#111827'}, textColor:'#9CA3AF' },
        grid: { vertLines:{color:'#1F2937'}, horzLines:{color:'#1F2937'} },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
        rightPriceScale: { borderColor:'#374151' },
        timeScale: { borderColor:'#374151', timeVisible:true },
        handleScroll: enableScroll, handleScale: enableScroll,
      });
      var series = chart.addCandlestickSeries({
        upColor:'#22C55E', downColor:'#EF4444',
        borderVisible:false,
        wickUpColor:'#22C55E', wickDownColor:'#EF4444',
      });
      series.setData(candles);
      chart.timeScale().fitContent();
    })
    .catch(function(e) {
      document.getElementById('overlay').innerHTML =
        '<div class="err">Could not load chart.<br>Make sure the backend is running.</div>';
    });
})();
<\/script>
</body></html>`;
}

function StockChart({ symbol, height = 260, onFullscreen }: { symbol: string; height?: number; onFullscreen?: () => void }) {
    const html = useMemo(() => buildChartHtml(symbol, height, false), [symbol, height]);

    return (
        <View style={{ height, borderRadius: 14, overflow: "hidden", marginTop: 12 }}>
            <WebView
                source={{ html }}
                style={{ flex: 1, backgroundColor: "#111827" }}
                scrollEnabled={false}
                javaScriptEnabled
                domStorageEnabled
                originWhitelist={["*"]}
                mixedContentMode="always"
            />
            {onFullscreen && (
                <TouchableOpacity
                    style={fsStyles.expandBtn}
                    onPress={onFullscreen}
                    activeOpacity={0.8}
                >
                    <Ionicons name="expand-outline" size={16} color="#fff" />
                </TouchableOpacity>
            )}
        </View>
    );
}

const fsStyles = StyleSheet.create({
    expandBtn: {
        position: "absolute",
        top: 20,
        right: 10,
        backgroundColor: "rgba(0,0,0,0.55)",
        borderRadius: 8,
        padding: 6,
        zIndex: 10,
    },
    modalContainer: {
        flex: 1,
        backgroundColor: "#111827",
    },
    modalHeader: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingVertical: 10,
        backgroundColor: "#111827",
        borderBottomWidth: 1,
        borderBottomColor: "#1F2937",
    },
    modalTitle: {
        color: "#F59E0B",
        fontSize: 15,
        fontWeight: "700",
        letterSpacing: 0.5,
    },
    modalCloseBtn: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        backgroundColor: "rgba(239,68,68,0.15)",
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderWidth: 1,
        borderColor: "rgba(239,68,68,0.3)",
    },
    modalCloseText: {
        color: "#EF4444",
        fontSize: 12,
        fontWeight: "700",
    },
});

function FullscreenChartModal({
    visible,
    symbol,
    onClose,
}: {
    visible: boolean;
    symbol: string;
    onClose: () => void;
}) {
    const { width, height } = Dimensions.get("window");
    // Subtract header height (~56px) from chart height
    const chartHeight = height - 56 - (StatusBar.currentHeight ?? 44);
    const html = useMemo(
        () => buildChartHtml(symbol, chartHeight, true),
        [symbol, chartHeight]
    );

    const clean = symbol
        .replace(/^(NSE:|BSE:)/i, "")
        .replace(/\.(NS|BO)$/i, "")
        .trim()
        .toUpperCase();

    return (
        <Modal
            visible={visible}
            animationType="slide"
            statusBarTranslucent
            onRequestClose={onClose}
        >
            <SafeAreaView style={fsStyles.modalContainer}>
                <View style={fsStyles.modalHeader}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <Ionicons name="bar-chart" size={16} color="#F59E0B" />
                        <Text style={fsStyles.modalTitle}>NSE:{clean}</Text>
                    </View>
                    <TouchableOpacity style={fsStyles.modalCloseBtn} onPress={onClose}>
                        <Ionicons name="contract-outline" size={14} color="#EF4444" />
                        <Text style={fsStyles.modalCloseText}>Close</Text>
                    </TouchableOpacity>
                </View>
                <WebView
                    source={{ html }}
                    style={{ flex: 1, backgroundColor: "#111827" }}
                    scrollEnabled={false}
                    javaScriptEnabled
                    domStorageEnabled
                    originWhitelist={["*"]}
                    mixedContentMode="always"
                />
            </SafeAreaView>
        </Modal>
    );
}


// ── Stock Chart Explorer ───────────────────────────────────────────────────────
function StockChartExplorer({ theme }: { theme: any }) {
    const [input, setInput] = useState("");
    const [activeSymbol, setActiveSymbol] = useState<string | null>(null);
    const [chartKey, setChartKey] = useState(0);
    const [fullscreenSymbol, setFullscreenSymbol] = useState<string | null>(null);

    const popularStocks = [
        "RELIANCE", "TCS", "INFY", "HDFCBANK", "WIPRO",
        "ICICIBANK", "SBIN", "BAJFINANCE", "ADANIENT", "TATAMOTORS",
    ];

    const handleSearch = () => {
        const sym = input.trim().toUpperCase();
        if (!sym) return;
        setActiveSymbol(sym);
        setChartKey(k => k + 1);
    };

    const handleQuickPick = (sym: string) => {
        setInput(sym);
        setActiveSymbol(sym);
        setChartKey(k => k + 1);
    };

    return (
        <View style={[s2.card, { borderColor: theme.border, backgroundColor: theme.card }]}>
            {/* Section header */}
            <View style={s2.sectionHeader}>
                <View style={[s2.iconWrap, { backgroundColor: `${theme.amber}20` }]}>
                    <Ionicons name="search-outline" size={16} color={theme.amber} />
                </View>
                <View>
                    <Text style={[s2.cardTitle, { color: theme.text }]}>Stock Chart Explorer</Text>
                    <Text style={[s2.cardSub, { color: theme.muted }]}>Search any NSE listed stock</Text>
                </View>
            </View>

            {/* Search bar */}
            <View style={s2.searchRow}>
                <TextInput
                    style={[s2.searchInput, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
                    placeholder="e.g. RELIANCE, TCS, HDFCBANK…"
                    placeholderTextColor={theme.muted}
                    value={input}
                    onChangeText={setInput}
                    autoCapitalize="characters"
                    returnKeyType="search"
                    onSubmitEditing={handleSearch}
                />
                <TouchableOpacity
                    style={[s2.searchBtn, { backgroundColor: theme.amber }]}
                    onPress={handleSearch}
                >
                    <Ionicons name="bar-chart-outline" size={18} color="#000" />
                </TouchableOpacity>
            </View>

            {/* Quick picks */}
            <Text style={[s2.hintText, { color: theme.muted }]}>Popular stocks — tap to view chart</Text>
            <View style={s2.pillsRow}>
                {popularStocks.map(sym => (
                    <TouchableOpacity
                        key={sym}
                        style={[
                            s2.pill,
                            { backgroundColor: theme.inputBg, borderColor: theme.border },
                            activeSymbol === sym && { backgroundColor: `${theme.amber}25`, borderColor: `${theme.amber}60` },
                        ]}
                        onPress={() => handleQuickPick(sym)}
                    >
                        <Text style={[
                            s2.pillText,
                            { color: theme.subtext },
                            activeSymbol === sym && { color: theme.amber },
                        ]}>{sym}</Text>
                    </TouchableOpacity>
                ))}
            </View>

            {/* Stock chart */}
            {activeSymbol && (
                <>
                    <View style={s2.chartHeader}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                            <View style={[s2.liveDot, { backgroundColor: "#22C55E" }]} />
                            <Text style={[s2.chartSymbolText, { color: theme.text }]}>NSE:{activeSymbol}</Text>
                        </View>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                            <TouchableOpacity
                                style={s2.fullscreenBtn}
                                onPress={() => setFullscreenSymbol(activeSymbol)}
                            >
                                <Ionicons name="expand-outline" size={14} color={theme.amber} />
                                <Text style={[s2.fullscreenText, { color: theme.amber }]}>Fullscreen</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={s2.clearBtn}
                                onPress={() => { setActiveSymbol(null); setInput(""); }}
                            >
                                <Ionicons name="close-circle-outline" size={15} color={theme.muted} />
                                <Text style={[s2.clearText, { color: theme.muted }]}>Clear</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                    <StockChart
                        key={`home-explorer-${chartKey}-${activeSymbol}`}
                        symbol={activeSymbol}
                        height={280}
                        onFullscreen={() => setFullscreenSymbol(activeSymbol)}
                    />
                </>
            )}

            {/* Fullscreen Modal */}
            {fullscreenSymbol && (
                <FullscreenChartModal
                    visible={true}
                    symbol={fullscreenSymbol}
                    onClose={() => setFullscreenSymbol(null)}
                />
            )}
        </View>
    );
}

const s2 = StyleSheet.create({
    card: { margin: 20, marginTop: 0, borderRadius: 18, padding: 18, borderWidth: 1 },
    sectionHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 },
    iconWrap: { width: 36, height: 36, borderRadius: 10, justifyContent: "center", alignItems: "center" },
    cardTitle: { fontSize: 15, fontWeight: "700" },
    cardSub: { fontSize: 11, marginTop: 1 },
    searchRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
    searchInput: {
        flex: 1, borderRadius: 12, borderWidth: 1,
        paddingHorizontal: 14, height: 46, fontSize: 14,
    },
    searchBtn: {
        width: 46, height: 46, borderRadius: 12,
        justifyContent: "center", alignItems: "center",
    },
    hintText: { fontSize: 11, marginBottom: 10 },
    pillsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 4 },
    pill: { borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1 },
    pillText: { fontSize: 11, fontWeight: "600" },
    chartHeader: {
        flexDirection: "row", alignItems: "center",
        justifyContent: "space-between", marginTop: 14, marginBottom: 2,
    },
    liveDot: { width: 6, height: 6, borderRadius: 3 },
    chartSymbolText: { fontSize: 13, fontWeight: "700" },
    clearBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
    clearText: { fontSize: 11 },
    fullscreenBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
    fullscreenText: { fontSize: 11, fontWeight: "600" },
});

// ── Home Screen ────────────────────────────────────────────────────────────────
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

    useEffect(() => { fetchData(); }, [fetchData]);
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

            {/* Stock Chart Explorer */}
            <Text style={s.sectionTitle}>EXPLORE STOCK CHARTS</Text>
            <StockChartExplorer theme={theme} />

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
