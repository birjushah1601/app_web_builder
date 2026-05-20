import { Tabs } from "expo-router";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: "#0f172a",
        headerShown: false
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "Home" }}
      />
    </Tabs>
  );
}
