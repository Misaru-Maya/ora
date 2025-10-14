/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Space Grotesk"', 'sans-serif'],
      },
      colors: {
        brand: {
          green: '#3A8518',
          'light-green': '#A5CF8E',
          'pale-green': '#DAEBD1',
          gray: '#717F90',
          'light-gray': '#B2BBC6',
          'pale-gray': '#E5E8EC',
          yellow: '#E7CB38',
          'light-yellow': '#F1E088',
          'pale-yellow': '#FAF5D7',
        },
      },
    },
  },
  plugins: [],
}
