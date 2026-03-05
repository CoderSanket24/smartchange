import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { TouchableOpacity, View } from "react-native";
import { useTheme } from "../../context/ThemeContext";

export default function TabLayout() {
    const { theme, isDark, toggle } = useTheme();

    return (
        <Tabs
            screenOptions={({ route }) => ({
                headerShown: false,
                tabBarStyle: {
                    backgroundColor: theme.tabBar,
                    borderTopColor: theme.tabBorder,
                    borderTopWidth: 1,
                    height: 65,
                    paddingBottom: 8,
                    paddingTop: 8,
                },
                tabBarActiveTintColor: theme.accent,
                tabBarInactiveTintColor: theme.muted,
                tabBarLabelStyle: { fontSize: 11, fontWeight: "600", letterSpacing: 0.3 },
                tabBarIcon: ({ color, size, focused }) => {
                    const icons: Record<string, keyof typeof Ionicons.glyphMap> = {
                        index: focused ? "home" : "home-outline",
                        wallet: focused ? "wallet" : "wallet-outline",
                        portfolio: focused ? "bar-chart" : "bar-chart-outline",
                        ai: focused ? "sparkles" : "sparkles-outline",
                    };
                    return (
                        <View style={{
                            padding: 4, borderRadius: 10,
                            backgroundColor: focused ? `${theme.accent}20` : "transparent",
                        }}>
                            <Ionicons name={icons[route.name] ?? "ellipse"} size={size} color={color} />
                        </View>
                    );
                },
            })}
        >
            <Tabs.Screen name="index" options={{ title: "Home" }} />
            <Tabs.Screen name="wallet" options={{ title: "Wallet" }} />
            <Tabs.Screen name="portfolio" options={{ title: "Portfolio" }} />
            <Tabs.Screen name="ai" options={{ title: "AI" }} />
        </Tabs>
    );
}
