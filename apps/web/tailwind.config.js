/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        nhs: {
          blue: '#005eb8',
          darkblue: '#003087',
          brightblue: '#0072ce',
          green: '#009639',
          red: '#d5281b',
          yellow: '#ffb81c',
        },
      },
      fontFamily: {
        sans: ['Frutiger', 'Inter', 'system-ui', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
