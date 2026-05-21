import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity,
    RefreshControl, ActivityIndicator, TextInput, Modal,
    Dimensions, StatusBar, SafeAreaView, Animated, Platform,
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


// ── Animated Stat Card ─────────────────────────────────────────────────────────
function AnimatedStatCard({ 
    icon, 
    value, 
    label, 
    color, 
    delay = 0,
    theme 
}: { 
    icon: string; 
    value: string; 
    label: string; 
    color: string; 
    delay?: number;
    theme: any;
}) {
    const scaleAnim = useRef(new Animated.Value(0)).current;
    const fadeAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.parallel([
            Animated.spring(scaleAnim, {
                toValue: 1,
                delay,
                tension: 50,
                friction: 7,
                useNativeDriver: true,
            }),
            Animated.timing(fadeAnim, {
                toValue: 1,
                delay,
                duration: 400,
                useNativeDriver: true,
            }),
        ]).start();
    }, []);

    return (
        <Animated.View
            style={[
                {
                    flex: 1,
                    backgroundColor: theme.card,
                    borderRadius: 18,
                    padding: 16,
                    borderWidth: 1,
                    borderColor: theme.border,
                    alignItems: 'center',
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.05,
                    shadowRadius: 8,
                    elevation: 2,
                },
                {
                    transform: [{ scale: scaleAnim }],
                    opacity: fadeAnim,
                },
            ]}
        >
            <View style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                justifyContent: 'center',
                alignItems: 'center',
                marginBottom: 10,
                backgroundColor: `${color}15`,
            }}>
                <Ionicons name={icon as any} size={24} color={color} />
            </View>
            <Text style={{ color: theme.text, fontSize: 18, fontWeight: '800', marginBottom: 4 }}>{value}</Text>
            <Text style={{ color: theme.muted, fontSize: 11, fontWeight: '600' }}>{label}</Text>
        </Animated.View>
    );
}

// ── Animated Action Button ─────────────────────────────────────────────────────
function AnimatedActionButton({
    icon,
    label,
    color,
    route,
    delay = 0,
    theme,
}: {
    icon: string;
    label: string;
    color: string;
    route: string;
    delay?: number;
    theme: any;
}) {
    const scaleAnim = useRef(new Animated.Value(0)).current;
    const [pressed, setPressed] = useState(false);

    useEffect(() => {
        Animated.spring(scaleAnim, {
            toValue: 1,
            delay,
            tension: 50,
            friction: 7,
            useNativeDriver: true,
        }).start();
    }, []);

    const handlePressIn = () => {
        setPressed(true);
        Animated.spring(scaleAnim, {
            toValue: 0.92,
            useNativeDriver: true,
        }).start();
    };

    const handlePressOut = () => {
        setPressed(false);
        Animated.spring(scaleAnim, {
            toValue: 1,
            tension: 50,
            friction: 7,
            useNativeDriver: true,
        }).start();
    };

    return (
        <TouchableOpacity
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            onPress={() => router.push(route as any)}
            activeOpacity={1}
        >
            <Animated.View
                style={[
                    {
                        flexDirection: 'row',
                        alignItems: 'center',
                        padding: 18,
                        borderRadius: 18,
                        borderWidth: 1,
                        backgroundColor: theme.card,
                        borderColor: theme.border,
                        shadowColor: '#000',
                        shadowOffset: { width: 0, height: 2 },
                        shadowOpacity: 0.05,
                        shadowRadius: 8,
                        elevation: 2,
                    },
                    {
                        transform: [{ scale: scaleAnim }],
                    },
                ]}
            >
                <View style={{
                    width: 48,
                    height: 48,
                    borderRadius: 14,
                    justifyContent: 'center',
                    alignItems: 'center',
                    marginRight: 14,
                    backgroundColor: `${color}18`,
                }}>
                    <Ionicons name={icon as any} size={26} color={color} />
                </View>
                <Text style={{ flex: 1, fontSize: 15, fontWeight: '700', color: theme.text }}>{label}</Text>
                <Ionicons name="arrow-forward" size={14} color={theme.muted} />
            </Animated.View>
        </TouchableOpacity>
    );
}

// ── Pulsing Dot ────────────────────────────────────────────────────────────────
function PulsingDot({ color }: { color: string }) {
    const pulseAnim = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        Animated.loop(
            Animated.sequence([
                Animated.timing(pulseAnim, {
                    toValue: 1.3,
                    duration: 1000,
                    useNativeDriver: true,
                }),
                Animated.timing(pulseAnim, {
                    toValue: 1,
                    duration: 1000,
                    useNativeDriver: true,
                }),
            ])
        ).start();
    }, []);

    return (
        <Animated.View
            style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: color,
                transform: [{ scale: pulseAnim }],
            }}
        />
    );
}
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
    card: { marginTop: 0, marginBottom: 0, borderRadius: 18, padding: 18, borderWidth: 1 },
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
    const [totalInvested, setTotalInvested] = useState<number>(0);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const headerFadeAnim = useRef(new Animated.Value(0)).current;
    const heroScaleAnim = useRef(new Animated.Value(0.9)).current;

    const fetchData = useCallback(async () => {
        try {
            const [walletRes, perfRes] = await Promise.all([
                walletApi.summary(),
                portfolioApi.performance(),
            ]);
            setBalance(walletRes.data.balance);
            setPortfolioValue(perfRes.data.current_value ?? 0);
            setTotalPL(perfRes.data.total_profit_loss ?? 0);
            setTotalInvested(perfRes.data.total_invested ?? 0);
        } catch { /* silently fail */ }
        finally { setLoading(false); setRefreshing(false); }
    }, []);

    useEffect(() => { 
        fetchData();
        // Animate header on mount
        Animated.parallel([
            Animated.timing(headerFadeAnim, {
                toValue: 1,
                duration: 600,
                useNativeDriver: true,
            }),
            Animated.spring(heroScaleAnim, {
                toValue: 1,
                tension: 50,
                friction: 7,
                useNativeDriver: true,
            }),
        ]).start();
    }, [fetchData]);

    const onRefresh = () => { setRefreshing(true); fetchData(); };
    const plPositive = totalPL >= 0;
    const plPercentage = totalInvested > 0 ? ((totalPL / totalInvested) * 100).toFixed(2) : "0.00";

    const s = makeStyles(theme);

    const getGreeting = () => {
        const hour = new Date().getHours();
        if (hour < 12) return "Good morning";
        if (hour < 17) return "Good afternoon";
        return "Good evening";
    };

    if (loading) {
        return (
            <View style={s.center}>
                <ActivityIndicator size="large" color={theme.accent} />
                <Text style={[s.loadingText, { color: theme.muted }]}>Loading your portfolio...</Text>
            </View>
        );
    }

    return (
        <ScrollView 
            style={s.container}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />}
        >
            {/* Animated Header */}
            <Animated.View style={[s.header, { opacity: headerFadeAnim }]}>
                <View>
                    <Text style={s.greeting}>{getGreeting()} 👋</Text>
                    <Text style={s.username}>{user?.username}</Text>
                </View>
                <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
                    <TouchableOpacity onPress={toggle} style={s.iconBtn}>
                        <Ionicons name={isDark ? "sunny" : "moon"} size={20} color={theme.accent} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={logout} style={[s.iconBtn, { backgroundColor: `${theme.red}15`, borderColor: `${theme.red}30` }]}>
                        <Ionicons name="log-out-outline" size={20} color={theme.red} />
                    </TouchableOpacity>
                </View>
            </Animated.View>

            {/* Hero Balance Card with Gradient */}
            <Animated.View style={{ transform: [{ scale: heroScaleAnim }] }}>
                <View style={[s.heroCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
                    <View style={s.heroTop}>
                        <View>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
                                <PulsingDot color={theme.green} />
                                <Text style={[s.heroLabel, { color: theme.muted }]}>Investment Wallet</Text>
                            </View>
                            <Text style={[s.heroAmount, { color: theme.accent }]}>₹{balance.toFixed(2)}</Text>
                        </View>
                        <View style={[s.heroBadge, { backgroundColor: `${theme.accent}15`, borderColor: `${theme.accent}30` }]}>
                            <Ionicons name="shield-checkmark" size={16} color={theme.accent} />
                        </View>
                    </View>
                    
                    <View style={[s.heroStats, { backgroundColor: theme.inputBg, borderColor: theme.border }]}>
                        <View style={s.heroStatItem}>
                            <Text style={[s.heroStatLabel, { color: theme.muted }]}>Portfolio</Text>
                            <Text style={[s.heroStatValue, { color: theme.text }]}>₹{portfolioValue.toFixed(2)}</Text>
                        </View>
                        <View style={[s.heroStatDivider, { backgroundColor: theme.border }]} />
                        <View style={s.heroStatItem}>
                            <Text style={[s.heroStatLabel, { color: theme.muted }]}>Returns</Text>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                                <Ionicons 
                                    name={plPositive ? "trending-up" : "trending-down"} 
                                    size={14} 
                                    color={plPositive ? theme.green : theme.red} 
                                />
                                <Text style={[s.heroStatValue, { color: plPositive ? theme.green : theme.red }]}>
                                    {plPositive ? "+" : ""}{plPercentage}%
                                </Text>
                            </View>
                        </View>
                    </View>
                </View>
            </Animated.View>

            {/* Stats Grid */}
            <View style={s.statsGrid}>
                <AnimatedStatCard
                    icon="wallet"
                    value={`₹${balance.toFixed(0)}`}
                    label="Available"
                    color={theme.accent}
                    delay={100}
                    theme={theme}
                />
                <AnimatedStatCard
                    icon="bar-chart"
                    value={`₹${portfolioValue.toFixed(0)}`}
                    label="Invested"
                    color={theme.purple}
                    delay={200}
                    theme={theme}
                />
                <AnimatedStatCard
                    icon={plPositive ? "trending-up" : "trending-down"}
                    value={`${plPositive ? "+" : ""}₹${Math.abs(totalPL).toFixed(0)}`}
                    label="P&L"
                    color={plPositive ? theme.green : theme.red}
                    delay={300}
                    theme={theme}
                />
            </View>

            {/* Quick Actions */}
            <View style={s.section}>
                <View style={s.sectionHeader}>
                    <Text style={[s.sectionTitle, { color: theme.text }]}>Quick Actions</Text>
                    <View style={[s.sectionBadge, { backgroundColor: `${theme.accent}15` }]}>
                        <Text style={[s.sectionBadgeText, { color: theme.accent }]}>3</Text>
                    </View>
                </View>
                
                <View style={s.actionsGrid}>
                    <AnimatedActionButton
                        icon="add-circle"
                        label="Log Spend"
                        color={theme.accent}
                        route="/(tabs)/wallet"
                        delay={100}
                        theme={theme}
                    />
                    <AnimatedActionButton
                        icon="briefcase"
                        label="Portfolio"
                        color={theme.purple}
                        route="/(tabs)/portfolio"
                        delay={200}
                        theme={theme}
                    />
                    <AnimatedActionButton
                        icon="sparkles"
                        label="AI Picks"
                        color={theme.amber}
                        route="/(tabs)/ai"
                        delay={300}
                        theme={theme}
                    />
                </View>
            </View>

            {/* Stock Chart Explorer */}
            <View style={s.section}>
                <View style={s.sectionHeader}>
                    <Text style={[s.sectionTitle, { color: theme.text }]}>Explore Markets</Text>
                    <Ionicons name="search" size={18} color={theme.muted} />
                </View>
                <StockChartExplorer theme={theme} />
            </View>

            {/* How it Works */}
            <View style={s.section}>
                <View style={s.sectionHeader}>
                    <Text style={[s.sectionTitle, { color: theme.text }]}>How It Works</Text>
                    <Ionicons name="information-circle" size={18} color={theme.muted} />
                </View>
                <View style={[s.howCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
                    {[
                        { n: "1", t: "Log Your Spending", d: "Track purchases like coffee, groceries, or shopping", icon: "cart" },
                        { n: "2", t: "Auto Round-Up", d: "We round to next ₹ + add ₹1 extra automatically", icon: "calculator" },
                        { n: "3", t: "AI Invests for You", d: "Smart algorithm picks best stocks for your spare change", icon: "sparkles" },
                    ].map(({ n, t, d, icon }, idx) => (
                        <View key={n} style={s.howRow}>
                            <View style={[s.howIconWrap, { backgroundColor: `${theme.accent}15`, borderColor: `${theme.accent}30` }]}>
                                <Ionicons name={icon as any} size={20} color={theme.accent} />
                            </View>
                            <View style={{ flex: 1 }}>
                                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                                    <View style={[s.howNum, { backgroundColor: `${theme.accent}20`, borderColor: `${theme.accent}40` }]}>
                                        <Text style={[s.howNumText, { color: theme.accent }]}>{n}</Text>
                                    </View>
                                    <Text style={[s.howTitle, { color: theme.text }]}>{t}</Text>
                                </View>
                                <Text style={[s.howDesc, { color: theme.muted }]}>{d}</Text>
                            </View>
                        </View>
                    ))}
                </View>
            </View>

            {/* Footer Spacing */}
            <View style={{ height: 40 }} />
        </ScrollView>
    );
}

function makeStyles(t: ReturnType<typeof import("../../context/ThemeContext").useTheme>["theme"]) {
    return StyleSheet.create({
        container: { flex: 1, backgroundColor: t.bg },
        center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: t.bg },
        loadingText: { marginTop: 12, fontSize: 13 },
        header: { 
            flexDirection: "row", 
            justifyContent: "space-between", 
            alignItems: "center", 
            padding: 24, 
            paddingTop: 56 
        },
        greeting: { color: t.muted, fontSize: 14, marginBottom: 4 },
        username: { color: t.text, fontSize: 24, fontWeight: "800", letterSpacing: -0.5 },
        iconBtn: { 
            padding: 10, 
            backgroundColor: t.surface, 
            borderRadius: 12, 
            borderWidth: 1, 
            borderColor: t.border 
        },
        
        // Hero Card
        heroCard: { 
            margin: 20, 
            marginTop: 4, 
            padding: 24, 
            borderRadius: 24, 
            borderWidth: 1,
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.1,
            shadowRadius: 12,
            elevation: 5,
        },
        heroTop: { 
            flexDirection: "row", 
            justifyContent: "space-between", 
            alignItems: "flex-start",
            marginBottom: 20,
        },
        heroLabel: { fontSize: 13, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
        heroAmount: { fontSize: 48, fontWeight: "900", letterSpacing: -1, marginTop: 4 },
        heroBadge: { 
            width: 48, 
            height: 48, 
            borderRadius: 14, 
            justifyContent: "center", 
            alignItems: "center",
            borderWidth: 1,
        },
        heroStats: {
            flexDirection: "row",
            borderRadius: 16,
            padding: 16,
            borderWidth: 1,
        },
        heroStatItem: { flex: 1, alignItems: "center" },
        heroStatLabel: { fontSize: 11, marginBottom: 6, fontWeight: "600" },
        heroStatValue: { fontSize: 16, fontWeight: "700" },
        heroStatDivider: { width: 1, marginHorizontal: 12 },
        
        // Stats Grid
        statsGrid: { 
            flexDirection: "row", 
            paddingHorizontal: 20, 
            gap: 12, 
            marginBottom: 32 
        },
        statCard: { 
            flex: 1, 
            backgroundColor: t.card, 
            borderRadius: 18, 
            padding: 16, 
            borderWidth: 1, 
            borderColor: t.border,
            alignItems: "center",
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.05,
            shadowRadius: 8,
            elevation: 2,
        },
        statIconWrap: {
            width: 44,
            height: 44,
            borderRadius: 12,
            justifyContent: "center",
            alignItems: "center",
            marginBottom: 10,
        },
        statValue: { fontSize: 18, fontWeight: "800", marginBottom: 4 },
        statLabel: { fontSize: 11, fontWeight: "600" },
        
        // Section
        section: { paddingHorizontal: 20, marginBottom: 32 },
        sectionHeader: { 
            flexDirection: "row", 
            justifyContent: "space-between", 
            alignItems: "center", 
            marginBottom: 16 
        },
        sectionTitle: { fontSize: 18, fontWeight: "800", letterSpacing: -0.3 },
        sectionBadge: { 
            paddingHorizontal: 10, 
            paddingVertical: 4, 
            borderRadius: 12 
        },
        sectionBadgeText: { fontSize: 12, fontWeight: "700" },
        
        // Actions
        actionsGrid: { gap: 12 },
        actionBtn: { 
            flexDirection: "row", 
            alignItems: "center", 
            padding: 18, 
            borderRadius: 18, 
            borderWidth: 1,
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.05,
            shadowRadius: 8,
            elevation: 2,
        },
        actionIconWrap: { 
            width: 48, 
            height: 48, 
            borderRadius: 14, 
            justifyContent: "center", 
            alignItems: "center", 
            marginRight: 14 
        },
        actionLabel: { flex: 1, fontSize: 15, fontWeight: "700" },
        
        // How It Works
        howCard: { 
            borderRadius: 20, 
            padding: 20, 
            borderWidth: 1, 
            gap: 20,
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.05,
            shadowRadius: 8,
            elevation: 2,
        },
        howRow: { flexDirection: "row", gap: 16, alignItems: "flex-start" },
        howIconWrap: { 
            width: 48, 
            height: 48, 
            borderRadius: 14, 
            justifyContent: "center", 
            alignItems: "center",
            borderWidth: 1,
        },
        howNum: { 
            width: 24, 
            height: 24, 
            borderRadius: 12, 
            justifyContent: "center", 
            alignItems: "center",
            borderWidth: 1,
        },
        howNumText: { fontSize: 11, fontWeight: "800" },
        howTitle: { fontSize: 15, fontWeight: "700", marginBottom: 4 },
        howDesc: { fontSize: 13, lineHeight: 19 },
    });
}
