import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function NotificationBell() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let unreadCount = 0;
  if (user) {
    const { count } = await supabase
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("read_at", null);
    unreadCount = count ?? 0;
  }

  return (
    <Link
      href="/dashboard/notifications"
      className="w-9 h-9 rounded-full bg-sky flex items-center justify-center relative flex-shrink-0"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0B2E5C" strokeWidth="2">
        <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.7 21a2 2 0 01-3.4 0" />
      </svg>
      {unreadCount > 0 && (
        <span className="absolute top-1.5 right-1.5 w-[7px] h-[7px] rounded-full bg-amber border-[1.5px] border-white" />
      )}
    </Link>
  );
}
