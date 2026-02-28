import React, { useState } from "react";
import {
    View, Text, TextInput, TouchableOpacity, StyleSheet,
    KeyboardAvoidingView, Platform, ActivityIndicator, Alert, ScrollView,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../context/AuthContext";

export default function LoginScreen() {
    const { login } = useAuth();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [showPass, setShowPass] = useState(false);

    const handleLogin = async () => {
        if (!email || !password) return Alert.alert("Error", "Please fill in all fields.");
        setLoading(true);
        try {
            await login(email.trim(), password);
            router.replace("/(tabs)");
        } catch (e: any) {
            Alert.alert("Login Failed", e?.response?.data?.detail ?? "Invalid credentials.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

                {/* Header */}
                <View style={styles.header}>
                    <View style={styles.logoCircle}>
                        <Ionicons name="trending-up" size={36} color="#00D4FF" />
                    </View>
                    <Text style={styles.brand}>SmartChange</Text>
                    <Text style={styles.tagline}>Invest spare change. Build wealth.</Text>
                </View>

                {/* Card */}
                <View style={styles.card}>
                    <Text style={styles.title}>Welcome back 👋</Text>
                    <Text style={styles.subtitle}>Sign in to continue investing</Text>

                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Email</Text>
                        <View style={styles.inputWrapper}>
                            <Ionicons name="mail-outline" size={18} color="#4A5568" style={styles.inputIcon} />
                            <TextInput
                                style={styles.input}
                                placeholder="you@example.com"
                                placeholderTextColor="#4A5568"
                                value={email}
                                onChangeText={setEmail}
                                keyboardType="email-address"
                                autoCapitalize="none"
                            />
                        </View>
                    </View>

                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Password</Text>
                        <View style={styles.inputWrapper}>
                            <Ionicons name="lock-closed-outline" size={18} color="#4A5568" style={styles.inputIcon} />
                            <TextInput
                                style={styles.input}
                                placeholder="Your password"
                                placeholderTextColor="#4A5568"
                                value={password}
                                onChangeText={setPassword}
                                secureTextEntry={!showPass}
                            />
                            <TouchableOpacity onPress={() => setShowPass(!showPass)}>
                                <Ionicons name={showPass ? "eye-off-outline" : "eye-outline"} size={18} color="#4A5568" />
                            </TouchableOpacity>
                        </View>
                    </View>

                    <TouchableOpacity style={styles.btn} onPress={handleLogin} disabled={loading}>
                        {loading ? <ActivityIndicator color="#000" /> : <Text style={styles.btnText}>Sign In</Text>}
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.linkRow} onPress={() => router.push("/auth/register")}>
                        <Text style={styles.linkText}>Don't have an account? </Text>
                        <Text style={[styles.linkText, styles.linkHighlight]}>Register</Text>
                    </TouchableOpacity>
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: "#0A0E1A" },
    scroll: { flexGrow: 1, justifyContent: "center", padding: 24 },
    header: { alignItems: "center", marginBottom: 36 },
    logoCircle: {
        width: 72, height: 72, borderRadius: 36,
        backgroundColor: "rgba(0,212,255,0.12)",
        justifyContent: "center", alignItems: "center", marginBottom: 12,
        borderWidth: 1, borderColor: "rgba(0,212,255,0.3)",
    },
    brand: { fontSize: 28, fontWeight: "800", color: "#FFFFFF", letterSpacing: 1 },
    tagline: { fontSize: 13, color: "#4A5568", marginTop: 4 },
    card: {
        backgroundColor: "#0D1117",
        borderRadius: 20, padding: 24,
        borderWidth: 1, borderColor: "#1A2332",
    },
    title: { fontSize: 22, fontWeight: "700", color: "#FFFFFF", marginBottom: 4 },
    subtitle: { fontSize: 13, color: "#4A5568", marginBottom: 24 },
    inputGroup: { marginBottom: 16 },
    label: { fontSize: 12, color: "#8B9BB4", fontWeight: "600", marginBottom: 6, letterSpacing: 0.5 },
    inputWrapper: {
        flexDirection: "row", alignItems: "center",
        backgroundColor: "#0A0E1A", borderRadius: 12,
        borderWidth: 1, borderColor: "#1A2332", paddingHorizontal: 14, height: 50,
    },
    inputIcon: { marginRight: 10 },
    input: { flex: 1, color: "#FFFFFF", fontSize: 14 },
    btn: {
        backgroundColor: "#00D4FF", borderRadius: 12,
        height: 52, justifyContent: "center", alignItems: "center",
        marginTop: 8, marginBottom: 20,
    },
    btnText: { color: "#000000", fontWeight: "700", fontSize: 16 },
    linkRow: { flexDirection: "row", justifyContent: "center" },
    linkText: { color: "#4A5568", fontSize: 13 },
    linkHighlight: { color: "#00D4FF", fontWeight: "600" },
});
