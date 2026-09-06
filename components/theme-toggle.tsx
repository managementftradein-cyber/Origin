"use client";

import { useEffect, useState } from "react";

export default function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("nestegg-theme", next ? "dark" : "light");
  }

  return (
    <button
      onClick={toggle}
      aria-label="Toggle dark mode"
      className="flex items-center justify-between w-full px-4 py-3.5"
    >
      <span className="text-sm font-semibold text-ink">Dark mode</span>
      <span
        className={`w-10 h-6 rounded-full flex items-center px-0.5 transition-colors ${
          isDark ? "bg-blue-deep justify-end" : "bg-line justify-start"
        }`}
      >
        <span className="w-5 h-5 rounded-full bg-surface shadow" />
      </span>
    </button>
  );
}
