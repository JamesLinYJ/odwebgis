module.exports = {
  content: [
    './templates/**/*.html',
    './static/js/**/*.jsx',
    './static/js/**/*.js'
  ],
  theme: {
    extend: {
      boxShadow: {
        soft: '0 10px 30px rgba(31, 103, 245, 0.14)',
      },
      colors: {
        brand: {
          50: '#eef7ff',
          100: '#d9ecff',
          200: '#b9dbff',
          300: '#8cc2ff',
          400: '#58a2ff',
          500: '#2e7dff',
          600: '#1f67f5',
          700: '#1b54e2',
        },
        admin: {
          50: '#eff8ff',
          100: '#dff0ff',
          200: '#bfe0ff',
          300: '#8fc8ff',
          400: '#54a8ff',
          500: '#2f83ff',
          600: '#2268ef',
        },
      },
    },
  },
  plugins: [],
};
