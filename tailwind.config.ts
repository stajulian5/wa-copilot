import type { Config } from 'tailwindcss'

export default {
  content: [
    './src/app/**/*.{ts,tsx,html}',
    './src/app/index.html'
  ],
  theme: {
    extend: {
      colors: {
        'wa': {
          green: '#25D366',
          teal: '#128C7E',
          light: '#DCF8C6',
          bubble: '#E9F5FE'
        }
      }
    }
  },
  plugins: []
} satisfies Config
