/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require('@opensea/satellite-ui/tailwind-preset')],
  content: [
    './src/renderer/**/*.{html,ts,tsx}',
    './node_modules/@opensea/satellite-ui/dist/**/*.{js,mjs}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
