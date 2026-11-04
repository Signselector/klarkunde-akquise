import type { ReactNode } from "react";
import { useCountry } from "@/lib/country";
import { telHref } from "@/lib/phone";

/** Click-to-call: opens the system phone handler (CloudTalk) with the number in E.164; invalid numbers stay plain text. */
export function PhoneLink({
  phone,
  country,
  className,
  children,
}: {
  phone: string | null | undefined;
  country?: string | null;
  className?: string;
  children?: ReactNode;
}) {
  const active = useCountry();
  const href = telHref(phone, country ?? active);
  if (!phone) return null;
  if (!href) return <span className={className}>{children ?? phone}</span>;
  return (
    <a href={href} className={className} title={`Anrufen: ${href.slice(4)}`}>
      {children ?? phone}
    </a>
  );
}
