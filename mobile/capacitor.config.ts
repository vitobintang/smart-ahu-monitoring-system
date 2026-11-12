import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.smartahu.monitoring",
  appName: "Smart AHU Monitoring",
  webDir: "dist",
  server: {
    url: "https://smart-ahu-monitoring-system.vercel.app",
    cleartext: false,
    androidScheme: "https",
  },
  ios: {
    contentInset: "automatic",
  },
};

export default config;
