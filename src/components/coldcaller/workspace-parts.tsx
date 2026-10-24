import { Building2, ExternalLink, Mail, MapPin, Phone } from "lucide-react";
import type { ReactNode } from "react";

export function PageHeading({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="cc-page-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action && <div className="cc-page-actions">{action}</div>}
    </header>
  );
}

/** Render imported contact values without treating arbitrary URLs as executable links. */
export function LeadContact({
  phone,
  email,
  city,
  extra = {},
}: {
  phone: string | null;
  email: string | null;
  city: string | null;
  extra?: Record<string, unknown>;
}) {
  const entries = Object.entries(extra).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string" && !!entry[1].trim(),
  );
  const website = entries.find(([key]) =>
    ["website", "webseite", "web", "url"].includes(key.toLowerCase().trim()),
  );
  const address = entries.find(([key]) =>
    ["adresse", "address", "anschrift"].includes(key.toLowerCase().trim()),
  );
  let websiteUrl: string | null = null;
  if (website) {
    try {
      const value = website[1].trim();
      const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`);
      if (["https:", "http:"].includes(url.protocol)) websiteUrl = url.href;
    } catch {
      /* Invalid imported values remain plain text. */
    }
  }
  return (
    <div className="cc-contact-grid">
      <div>
        <Phone aria-hidden="true" />
        <span>
          <small>Telefon</small>
          {phone ? (
            <a className="cc-phone-number" href={`tel:${phone}`}>
              {phone}
            </a>
          ) : (
            <span>Nicht hinterlegt</span>
          )}
        </span>
      </div>
      <div>
        <MapPin aria-hidden="true" />
        <span>
          <small>Adresse / Ort</small>
          {address ? (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([address[1], city].filter(Boolean).join(", "))}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {[address[1], city].filter(Boolean).join(", ")}
              <ExternalLink size={13} />
            </a>
          ) : (
            <span>{city || "Nicht hinterlegt"}</span>
          )}
        </span>
      </div>
      {email && (
        <div>
          <Mail aria-hidden="true" />
          <span>
            <small>E-Mail</small>
            <a href={`mailto:${email}`}>{email}</a>
          </span>
        </div>
      )}
      {website && (
        <div>
          <Building2 aria-hidden="true" />
          <span>
            <small>Website</small>
            {websiteUrl ? (
              <a href={websiteUrl} target="_blank" rel="noopener noreferrer">
                {website[1]}
                <ExternalLink size={13} />
              </a>
            ) : (
              <span>{website[1]}</span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
