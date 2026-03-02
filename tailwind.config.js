/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
    './contexts/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        brand: {
          green:        '#3D7A50',
          'green-soft': '#E4F2EA',
          'green-dark': '#2A5538',
        },
      },
      fontFamily: {
        rubik:          ['Rubik_400Regular'],
        'rubik-medium': ['Rubik_500Medium'],
        'rubik-semi':   ['Rubik_600SemiBold'],
        'rubik-bold':   ['Rubik_700Bold'],
      },
    },
  },
  plugins: [],
};
