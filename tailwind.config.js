/* 【中文注释】
 * 文件说明：tailwind.config.js 为前端自研脚本，负责页面交互或业务能力。
 * 维护约定：修改前请确认对应后端接口与页面行为。
 */

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

