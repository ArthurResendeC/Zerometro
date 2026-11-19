import { useState } from "react";
import { cn } from "@/lib/utils";

interface UserAvatarProps {
  user: { name: string; email: string; image?: string | null };
  className?: string;
}

/** Foto da conta Google, ou a inicial do nome se não houver (ou não carregar). */
export function UserAvatar({ user, className }: UserAvatarProps) {
  const [broken, setBroken] = useState(false);
  const initial = (user.name || user.email).trim().charAt(0).toUpperCase();

  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center overflow-hidden bg-muted font-pixel text-[12px] shadow-[0_0_0_2px_var(--border)]",
        className,
      )}
    >
      {user.image && !broken ? (
        <img
          src={user.image}
          alt=""
          referrerPolicy="no-referrer"
          className="size-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        initial
      )}
      <span className="sr-only">{user.name}</span>
    </span>
  );
}
