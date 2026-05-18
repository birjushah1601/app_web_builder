import { Text, View } from "react-native";

export default function Index() {
  return (
    <View className="flex-1 items-center justify-center bg-white p-6">
      <Text className="text-3xl font-bold text-atlas-primary">
        Atlas Expo Sandbox is live
      </Text>
      <Text className="mt-2 text-base text-gray-600">
        atlas-expo-rn sandbox - Expo SDK 52 + NativeWind 4
      </Text>
    </View>
  );
}
