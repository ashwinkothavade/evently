import { IconButton } from '@chakra-ui/react';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { LuMoon, LuSun } from 'react-icons/lu';

type Mode = 'light' | 'dark';
const STORAGE_KEY = 'theme';

const initialMode = (): Mode => {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

const ColorModeContext = createContext<{ mode: Mode; toggle: () => void }>({ mode: 'light', toggle: () => undefined });

/** Chakra switches palettes on the `dark` class of <html>; this keeps it in sync with the user's choice. */
export function ColorModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>(initialMode);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', mode === 'dark');
    root.classList.toggle('light', mode === 'light');
    root.style.colorScheme = mode;
  }, [mode]);

  const toggle = useCallback(() => {
    setMode((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  }, []);

  return <ColorModeContext.Provider value={{ mode, toggle }}>{children}</ColorModeContext.Provider>;
}

export function ColorModeButton() {
  const { mode, toggle } = useContext(ColorModeContext);
  const dark = mode === 'dark';
  return (
    <IconButton aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} variant="ghost" size="sm" onClick={toggle}>
      {dark ? <LuSun /> : <LuMoon />}
    </IconButton>
  );
}
