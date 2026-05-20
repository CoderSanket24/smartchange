import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity,
    RefreshControl, ActivityIndicator, TextInput,
    Animated, Modal, Dimensions, StatusBar, SafeAreaView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { WebView } from "react-native-webview";
import { useTheme } from "../../context/ThemeContext";
import { aiApi, walletApi, notificationsApi } from "../../services/api";
import { useFocusEffect } from "expo-router";

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
    reason?: string;
    explanation: {
        feature_scores?: Record<string, number>;
        shap_values?: Record<string, number>;
        top_factor?: string;
        method?: string;
        policy_weight?: number;
        note?: string;
    };
}

interface AppNotification { type: string; title: string; body: string; icon: string; }

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

function StockChart({ symbol, height = 220, onFullscreen }: { symbol: string; height?: number; onFullscreen?: () => void }) {
    const html = useMemo(() => buildChartHtml(symbol, height, false), [symbol, height]);

    return (
        <View style={{ height, borderRadius: 12, overflow: "hidden", marginTop: 12 }}>
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
    const { height } = Dimensions.get("window");
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


// ── Notification banner ────────────────────────────────────────────────────────
function NotificationBanner({ notifs, theme }: { notifs: AppNotification[]; theme: any }) {
    const [idx, setIdx] = useState(0);
    const [visible, setVisible] = useState(true);
    if (!visible || notifs.length === 0) return null;
    const n = notifs[idx % notifs.length];
    const colorMap: Record<string, string> = {
        wallet: "#F59E0B", portfolio: "#22C55E", ai: "#A78BFA",
    };
    const color = colorMap[n.type] ?? "#60A5FA";
    return (
        <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => setIdx(i => i + 1)}
            style={[{ backgroundColor: `${color}18`, borderColor: `${color}40`, borderWidth: 1,
                borderRadius: 14, marginHorizontal: 20, marginBottom: 16,
                padding: 12, flexDirection: "row", alignItems: "center", gap: 10 }]}
        >
            <Ionicons name={n.icon as any} size={18} color={color} />
            <View style={{ flex: 1 }}>
                <Text style={{ color: color, fontWeight: "700", fontSize: 12 }}>{n.title}</Text>
                <Text style={{ color: theme.subtext, fontSize: 11, marginTop: 1 }}>{n.body}</Text>
            </View>
            {notifs.length > 1 && (
                <Text style={{ color: color, fontSize: 10, fontWeight: "700" }}>
                    {(idx % notifs.length) + 1}/{notifs.length}
                </Text>
            )}
            <TouchableOpacity onPress={() => setVisible(false)}>
                <Ionicons name="close" size={14} color={theme.muted} />
            </TouchableOpacity>
        </TouchableOpacity>
    );
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

const FEATURE_COLORS: Record<string, string> = {
    momentum: "#00D4FF", low_volatility: "#22C55E", value: "#F59E0B", large_cap: "#A855F7",
};
const FEATURE_ICONS: Record<string, any> = {
    momentum: "trending-up-outline", low_volatility: "shield-outline",
    value: "pricetag-outline", large_cap: "business-outline",
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
    const [error, setError] = useState<string | null>(null);
    const [expanded, setExpanded] = useState<string | null>(null);
    const [chartVisible, setChartVisible] = useState<string | null>(null);
    const [fullscreenSymbol, setFullscreenSymbol] = useState<string | null>(null);
    const [notifs, setNotifs] = useState<AppNotification[]>([]);

    const fetchNotifs = useCallback(async () => {
        try {
            const res = await notificationsApi.getAll();
            setNotifs(res.data.notifications ?? []);
        } catch { /* silent */ }
    }, []);

    const fetchRecs = useCallback(async (isRetry = false) => {
        if (!isRetry) setLoading(true);
        setError(null);
        const MAX_RETRIES = 2;
        const RETRY_DELAY_MS = 2500;

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                const [aiRes, walRes] = await Promise.all([
                    aiApi.recommend(parseFloat(amount) || 100, parseInt(topN) || 4),
                    walletApi.balance(),
                ]);
                setMeta(aiRes.data);
                setRecs(aiRes.data.recommendations);
                setBalance(walRes.data.balance);
                setError(null);
                setLoading(false);
                setRefreshing(false);
                return;   // success — exit loop
            } catch (e: any) {
                if (attempt < MAX_RETRIES) {
                    // Wait and retry silently — backend may still be warming up
                    await new Promise(res => setTimeout(res, RETRY_DELAY_MS));
                } else {
                    // All retries exhausted — show inline error
                    const msg =
                        e?.response?.data?.detail ??
                        e?.message ??
                        "Could not reach the server. Make sure the backend is running.";
                    setError(msg);
                    setLoading(false);
                    setRefreshing(false);
                }
            }
        }
    }, [amount, topN]);

    // Fetch recs when screen gains focus
    useFocusEffect(useCallback(() => { fetchRecs(); }, [fetchRecs]));
    // Fetch notifications when screen gains focus (separate effect, stable dep)
    useFocusEffect(useCallback(() => { fetchNotifs(); }, [fetchNotifs]));

    const onRefresh = () => { setRefreshing(true); fetchRecs(); fetchNotifs(); };
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

            {/* Notification Banner */}
            <NotificationBanner notifs={notifs} theme={theme} />

            {/* Config Card */}
            <View style={s.configCard}>
                <Text style={s.configTitle}>Configure Recommendation</Text>
                <View style={s.configRow}>
                    <View style={s.configField}>
                        <Text style={s.label}>Amount (₹)</Text>
                        <TextInput
                            style={s.input} value={amount} onChangeText={setAmount}
                            keyboardType="decimal-pad" placeholderTextColor={theme.muted}
                        />
                    </View>
                    <View style={s.configField}>
                        <Text style={s.label}>Top N Stocks</Text>
                        <TextInput
                            style={s.input} value={topN} onChangeText={setTopN}
                            keyboardType="number-pad" placeholderTextColor={theme.muted}
                        />
                    </View>
                </View>
                <Text style={s.walletNote}>
                    Wallet: <Text style={{ color: theme.accent }}>₹{balance.toFixed(2)}</Text>
                </Text>
                <TouchableOpacity style={s.runBtn} onPress={() => fetchRecs()} disabled={loading}>
                    {loading
                        ? <ActivityIndicator color="#000" />
                        : <><Ionicons name="sparkles" size={16} color="#000" /><Text style={s.runBtnText}>Run AI Analysis</Text></>}
                </TouchableOpacity>
            </View>

            {/* Inline Error Banner */}
            {error && (
                <View style={s.errorBanner}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                        <Ionicons name="wifi-outline" size={18} color="#EF4444" />
                        <View style={{ flex: 1 }}>
                            <Text style={s.errorTitle}>Connection Error</Text>
                            <Text style={s.errorMsg} numberOfLines={2}>{error}</Text>
                        </View>
                    </View>
                    <TouchableOpacity
                        style={s.retryBtn}
                        onPress={() => fetchRecs()}
                        disabled={loading}
                    >
                        <Ionicons name="refresh-outline" size={13} color="#F59E0B" />
                        <Text style={s.retryText}>Retry</Text>
                    </TouchableOpacity>
                </View>
            )}

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
                <View style={s.loadingBox}>
                    {[1, 2, 3].map(k => (
                        <View key={k} style={[s.recCard, { gap: 12 }]}>
                            <View style={{ flexDirection: "row", gap: 12 }}>
                                <SkeletonBox width={32} height={32} style={{ borderRadius: 10 }} />
                                <View style={{ flex: 1, gap: 6 }}>
                                    <SkeletonBox width="50%" height={14} />
                                    <SkeletonBox width="70%" height={10} />
                                </View>
                                <View style={{ gap: 6, alignItems: "flex-end" }}>
                                    <SkeletonBox width={40} height={18} />
                                    <SkeletonBox width={60} height={10} />
                                </View>
                            </View>
                            <SkeletonBox width="100%" height={10} />
                            <SkeletonBox width="80%" height={10} />
                        </View>
                    ))}
                </View>
            ) : recs.map((rec) => {
                const isExpanded = expanded === rec.stock_symbol;
                const showChart = chartVisible === rec.stock_symbol;
                const topFactor = rec.explanation?.top_factor ?? null;
                const topColor = topFactor ? (FEATURE_COLORS[topFactor] ?? theme.accent) : theme.accent;
                const shapVals = rec.explanation?.shap_values ?? null;
                const maxShap = shapVals ? Math.max(...Object.values(shapVals)) : 0;
                const nseSymbol = rec.stock_symbol.replace(".NS", "");

                return (
                    <View key={rec.stock_symbol} style={s.recCard}>
                        {/* Rank + Stock Info */}
                        <View style={s.recHeader}>
                            <View style={s.rankBadge}><Text style={s.rankText}>#{rec.rank}</Text></View>
                            <View style={s.recInfo}>
                                <View style={s.recNameRow}>
                                    <Text style={s.recSymbol}>{nseSymbol}</Text>
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

                        {/* Top Factor Badge */}
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

                        {/* AI Reason — human-readable */}
                        {rec.reason && (
                            <View style={s.reasonBox}>
                                <Ionicons name="bulb-outline" size={13} color="#F59E0B" style={{ marginTop: 1 }} />
                                <Text style={s.reasonText}>{rec.reason}</Text>
                            </View>
                        )}

                        {/* Rationale */}
                        <Text style={s.rationale}>{rec.rationale}</Text>

                        {/* Action row: Chart toggle + SHAP */}
                        <View style={s.actionRow}>
                            <TouchableOpacity
                                style={s.chartBtn}
                                onPress={() => setChartVisible(showChart ? null : rec.stock_symbol)}
                            >
                                <Ionicons name={showChart ? "eye-off-outline" : "bar-chart-outline"} size={13} color={theme.amber} />
                                <Text style={s.expandText}>{showChart ? "Hide" : "View"} Chart</Text>
                            </TouchableOpacity>

                            {shapVals && (
                                <TouchableOpacity
                                    style={s.expandBtn}
                                    onPress={() => setExpanded(isExpanded ? null : rec.stock_symbol)}
                                >
                                    <Text style={s.expandText}>{isExpanded ? "Hide" : "View"} SHAP</Text>
                                    <Ionicons name={isExpanded ? "chevron-up" : "chevron-down"} size={14} color={theme.amber} />
                                </TouchableOpacity>
                            )}
                        </View>

                        {/* Stock Chart (Lightweight Charts + Yahoo Finance) */}
                        {showChart && (
                            <StockChart
                                key={`rec-${rec.stock_symbol}`}
                                symbol={nseSymbol}
                                onFullscreen={() => setFullscreenSymbol(nseSymbol)}
                            />
                        )}

                        {/* SHAP Explanation */}
                        {shapVals && isExpanded && (
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

                        {!shapVals && rec.explanation?.note && (
                            <Text style={s.shapNote}>{rec.explanation.note}</Text>
                        )}
                    </View>
                );
            })}
            {recs.length === 0 && !loading && (
                <Text style={{ color: theme.muted, textAlign: 'center', marginTop: 20 }}>Run AI Analysis to see recommendations.</Text>
            )}
            <View style={{ height: 40 }} />

            {/* Fullscreen Chart Modal */}
            {fullscreenSymbol && (
                <FullscreenChartModal
                    visible={true}
                    symbol={fullscreenSymbol}
                    onClose={() => setFullscreenSymbol(null)}
                />
            )}
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
        loadingBox: { paddingHorizontal: 20, gap: 14 },
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
        reasonBox: { flexDirection: "row", alignItems: "flex-start", gap: 6, backgroundColor: "#F59E0B18", borderRadius: 10, padding: 10, marginBottom: 10, borderWidth: 1, borderColor: "#F59E0B30" },
        reasonText: { color: t.subtext, fontSize: 12, lineHeight: 17, flex: 1 },
        rationale: { color: t.muted, fontSize: 11, lineHeight: 17, marginBottom: 12, opacity: 0.8 },
        actionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
        chartBtn: { flexDirection: "row", alignItems: "center", gap: 5 },
        expandBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
        expandText: { color: t.amber, fontSize: 12, fontWeight: "600" },
        shapBox: { marginTop: 14, backgroundColor: t.inputBg, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: t.border },
        shapTitle: { color: t.text, fontSize: 12, fontWeight: "700", marginBottom: 12 },
        shapRow: { flexDirection: "row", alignItems: "center", marginBottom: 10, gap: 8 },
        shapFeat: { color: t.subtext, fontSize: 11, width: 100 },
        shapBar: { flex: 1, height: 6, backgroundColor: t.border, borderRadius: 3, overflow: "hidden" },
        shapFill: { height: "100%" as any, borderRadius: 3 },
        shapVal: { fontSize: 11, fontWeight: "600", width: 46, textAlign: "right" },
        shapNote: { color: t.muted, fontSize: 10, marginTop: 8, opacity: 0.7 },
        errorBanner: {
            marginHorizontal: 20, marginBottom: 16,
            backgroundColor: "rgba(239,68,68,0.10)",
            borderWidth: 1, borderColor: "rgba(239,68,68,0.30)",
            borderRadius: 14, padding: 14,
            flexDirection: "row", alignItems: "center", gap: 10,
        },
        errorTitle: { color: "#EF4444", fontWeight: "700", fontSize: 13, marginBottom: 2 },
        errorMsg:   { color: t.subtext, fontSize: 11, lineHeight: 16 },
        retryBtn: {
            flexDirection: "row", alignItems: "center", gap: 4,
            backgroundColor: `${t.amber}20`, borderRadius: 8,
            paddingHorizontal: 10, paddingVertical: 7,
            borderWidth: 1, borderColor: `${t.amber}40`,
        },
        retryText: { color: t.amber, fontSize: 11, fontWeight: "700" },
    });
}
