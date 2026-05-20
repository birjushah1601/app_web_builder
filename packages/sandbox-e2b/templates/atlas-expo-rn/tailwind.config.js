/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}"
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        atlas: {
          primary: "hsl(222.2 47.4% 11.2%)",
          background: "hsl(0 0% 100%)",
          muted: "hsl(210 40% 96.1%)",
          accent: "hsl(210 40% 96.1%)"
        }
      }
    }
  },
  plugins: []
};
