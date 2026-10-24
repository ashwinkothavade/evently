import { createSystem, defaultConfig, defineConfig } from '@chakra-ui/react';

/**
 * Evently design system. Every component uses colorPalette="brand" (or a
 * semantic status palette), so the UI stays visually consistent and colours
 * are changed in one place.
 */
const config = defineConfig({
  globalCss: {
    'html, body': { bg: 'bg.subtle', color: 'fg' },
  },
  theme: {
    tokens: {
      fonts: {
        heading: { value: `'Inter', system-ui, sans-serif` },
        body: { value: `'Inter', system-ui, sans-serif` },
      },
      colors: {
        brand: {
          50: { value: '#f1efff' },
          100: { value: '#e2ddff' },
          200: { value: '#c6bdff' },
          300: { value: '#a596fb' },
          400: { value: '#8670f2' },
          500: { value: '#6c55e6' },
          600: { value: '#5b4bdb' },
          700: { value: '#4a3bb8' },
          800: { value: '#3a2f8f' },
          900: { value: '#2b2369' },
          950: { value: '#1a1540' },
        },
      },
      radii: {
        card: { value: '1rem' },
      },
    },
    semanticTokens: {
      colors: {
        brand: {
          solid: { value: { _light: '{colors.brand.600}', _dark: '{colors.brand.500}' } },
          contrast: { value: 'white' },
          fg: { value: { _light: '{colors.brand.700}', _dark: '{colors.brand.300}' } },
          muted: { value: { _light: '{colors.brand.100}', _dark: '{colors.brand.900}' } },
          subtle: { value: { _light: '{colors.brand.50}', _dark: '{colors.brand.950}' } },
          emphasized: { value: { _light: '{colors.brand.200}', _dark: '{colors.brand.800}' } },
          focusRing: { value: '{colors.brand.500}' },
        },
        // Data-viz palette: validated for CVD separation and contrast in both modes
        // (dataviz validator, surfaces #ffffff / #111111). Series 1 = bookings, 2 = cancellations.
        chart: {
          series1: { value: { _light: '#2a78d6', _dark: '#3987e5' } },
          series2: { value: { _light: '#eb6834', _dark: '#d95926' } },
          grid: { value: { _light: '#e1e0d9', _dark: '#2c2c2a' } },
          axis: { value: { _light: '#c3c2b7', _dark: '#383835' } },
          muted: { value: '#898781' },
        },
      },
    },
    layerStyles: {
      card: {
        value: {
          bg: 'bg.panel',
          borderWidth: '1px',
          borderColor: 'border.muted',
          borderRadius: 'card',
          boxShadow: 'xs',
        },
      },
    },
  },
});

export const system = createSystem(defaultConfig, config);
