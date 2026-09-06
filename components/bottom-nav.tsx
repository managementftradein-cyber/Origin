"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/dashboard", label: "Home", key: "home" },
  { href: "/dashboard/savings", label: "Savings", key: "savings" },
  { href: "/dashboard/wallet", label: "Wallet", key: "wallet" },
  { href: "/dashboard/community", label: "Community", key: "community" },
  { href: "/dashboard/profile", label: "Profile", key: "profile" },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-surface border-t border-line">
      <div className="max-w-sm mx-auto flex items-center justify-around h-[72px] pb-1">
        {TABS.map((tab) => {
          const active =
            tab.key === "home"
              ? pathname === "/dashboard"
              : pathname.startsWith(tab.href);

          return (
            <Link
              key={tab.key}
              href={tab.href}
              className={`flex flex-col items-center gap-1 text-[10.5px] font-semibold ${
                active ? "text-blue-deep" : "text-ink-soft"
              }`}
            >
              <span
                className={`w-5 h-5 rounded-full ${
                  active ? "bg-blue-deep" : "bg-current opacity-40"
                }`}
              />
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
