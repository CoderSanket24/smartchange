import React, { useEffect, useState } from "react";
import { View, Text, ActivityIndicator } from "react-native";
import { API } from "../services/api";

export default function App() {

  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    API.get("/")
      .then(response => {
        setMessage(response.data.message);
      })
      .catch(error => {
        setMessage("Error connecting to backend");
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  return (
    <View style={{
      flex: 1,
      justifyContent: "center",
      alignItems: "center"
    }}>
      {loading ? (
        <ActivityIndicator size="large" />
      ) : (
        <Text style={{ fontSize: 20 }}>
          {message}
        </Text>
      )}
    </View>
  );
}