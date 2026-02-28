import React, { useState } from "react";
import {
    View, Text, TextInput, TouchableOpacity, StyleSheet,
    KeyboardAvoidingView, Platform, ActivityIndicator, Alert, ScrollView,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../context/AuthContext";

export default function RegisterScreen() {
    const { register } = useAuth();
    const [email, setEmail] = useState("");
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [showPass, setShowPass] = useState(false);

    const handleRegister = async () => {
        if (!email || !username || !password) return Alert.alert("Error", "Please fill in all fields.");
        if (password.length < 6) return Alert.alert("Error", "Password must be at least 6 characters.");
        setLoading(true);
        try {
            await register(email.trim(), username.trim(), password);
            router.replace("/(tabs)");
        } catch (e: any) {
            Alert.alert("Registration Failed", e?.response?.data?.detail ?? "Please try again.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

                <View style={styles.header}>
                    <View style={styles.logoCircle}>
                        <Ionicons name="trending-up" size={36} color="#00D4FF" />
                    </View>
                    <Text style={styles.brand}>SmartChange</Text>
                    <Text style={styles.tagline}>Start investing with spare change</Text>
                </View>

                <View style={styles.card}>
                    <Text style={styles.title}>Create account 🚀</Text>
                    <Text style={styles.subtitle}>Join thousands of student investors</Text>

                    {[
                        { label: "Email", icon: "mail-outline", value: email, setter: setEmail, keyboard: "email-address", secure: false },
                        { label: "Username", icon: "person-outline", value: username, setter: setUsername, keyboard: "default", secure: false },
                    ].map(({ label, icon, value, setter, keyboard }) => (
                        <View style={styles.inputGroup} key={label}>
                            <Text style={styles.label}>{label}</Text>
                            <View style={styles.inputWrapper}>
                                <Ionicons name={icon as any} size={18} color="#4A5568" style={styles.inputIcon} />
                                <TextInput
                                    style={styles.input}
                                    placeholder={label}
                                    placeholderTextColor="#4A5568"
                                    value={value}
                                    onChangeText={setter}
                                    keyboardType={keyboard as any}
                                    autoCapitalize="none"
                                />
                            </View>
                        </View>
                    ))}

                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Password</Text>
                        <View style={styles.inputWrapper}>
                            <Ionicons name="lock-closed-outline" size={18} color="#4A5568" style={styles.inputIcon} />
                            <TextInput
                                style={styles.input}
                                placeholder="Min. 6 characters"
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

                    <TouchableOpacity style={styles.btn} onPress={handleRegister} disabled={loading}>
                        {loading ? <ActivityIndicator color="#000" /> : <Text style={styles.btnText}>Create Account</Text>}
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.linkRow} onPress={() => router.push("/auth/login")}>
                        <Text style={styles.linkText}>Already have an account? </Text>
                        <Text style={[styles.linkText, styles.linkHighlight]}>Sign In</Text>
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
