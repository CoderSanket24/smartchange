import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { View, StyleSheet } from "react-native";

export default function TabLayout() {
    return (
        <Tabs
            screenOptions={({ route }) => ({
                headerShown: false,
                tabBarStyle: styles.tabBar,
                tabBarActiveTintColor: "#00D4FF",
                tabBarInactiveTintColor: "#4A5568",
                tabBarLabelStyle: styles.label,
                tabBarIcon: ({ color, size, focused }) => {
                    const icons: Record<string, keyof typeof Ionicons.glyphMap> = {
                        index: focused ? "home" : "home-outline",
                        wallet: focused ? "wallet" : "wallet-outline",
                        portfolio: focused ? "bar-chart" : "bar-chart-outline",
                        ai: focused ? "sparkles" : "sparkles-outline",
                    };
                    return (
                        <View style={[styles.iconWrapper, focused && styles.iconActive]}>
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

const styles = StyleSheet.create({
    tabBar: {
        backgroundColor: "#0D1117",
        borderTopColor: "#1A2332",
        borderTopWidth: 1,
        height: 65,
        paddingBottom: 8,
        paddingTop: 8,
    },
    label: {
        fontSize: 11,
        fontWeight: "600",
        letterSpacing: 0.3,
    },
    iconWrapper: {
        padding: 4,
        borderRadius: 10,
    },
    iconActive: {
        backgroundColor: "rgba(0, 212, 255, 0.12)",
    },
});
