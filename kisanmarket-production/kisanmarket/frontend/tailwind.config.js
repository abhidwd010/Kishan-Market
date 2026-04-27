/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,ts,jsx,tsx}', './components/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        kisan: {
          50:  '#EAF3DE',
          100: '#C0DD97',
          400: '#639922',
          600: '#3B6D11',
          900: '#173404',
        },
        soil: {
          50:  '#FAEEDA',
          400: '#BA7517',
          900: '#412402',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
