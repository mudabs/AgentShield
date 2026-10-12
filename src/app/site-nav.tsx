"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/agent", label: "Owner setup" },
  { href: "/pay", label: "Agent console" },
  { href: "/book", label: "Address book" },
  { href: "/mandates", label: "Mandates" },
  { href: "/arena", label: "Break the agent" },
];

export function SiteNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap items-center gap-1">
      {links.map((link) => {
        const active = pathname === link.href;
        return (
          <Link
            className={`rounded-full px-3 py-1.5 text-xs transition ${
              active ? "bg-white/10 font-semibold text-white" : "text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200"
            }`}
            href={link.href}
            key={link.href}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
