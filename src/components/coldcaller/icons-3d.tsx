import { forwardRef, useId } from "react";
import * as Glyph from "lucide-react";
import type { LucideIcon, LucideProps } from "lucide-react";
import "./icons-3d.css";

type Material = readonly [string, string, string];
const ruby: Material = ["#ffb8a3", "#da403c", "#671421"];
const gold: Material = ["#fff1ab", "#eba936", "#83500f"];
const jade: Material = ["#b7f6db", "#32b89e", "#115c57"];
const blue: Material = ["#c8e9ff", "#549bdf", "#254a89"];
const violet: Material = ["#e6d8ff", "#a080db", "#543886"];

/** Shared lighting and real SVG depth layers; each semantic action keeps its own silhouette. */
function sculpt(Shape: LucideIcon, name: string, material: Material, utility = false) {
  const Icon = forwardRef<SVGSVGElement, LucideProps>(function SculptedIcon(
    { size = 24, className = "", strokeWidth: _stroke, color: _color, children, ...props },
    ref,
  ) {
    const uid = useId().replace(/:/g, "");
    const face = `${uid}-face`,
      edge = `${uid}-edge`,
      ink = `${uid}-ink`;
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 40 40"
        fill="none"
        aria-hidden="true"
        focusable="false"
        {...props}
        className={`cc-icon3d cc-size-preserved ${utility ? "cc-icon3d--utility" : ""} ${className}`}
        data-cc-icon={name}
      >
        <defs>
          <linearGradient id={face} x1="6" y1="3" x2="32" y2="34" gradientUnits="userSpaceOnUse">
            <stop stopColor={material[0]} />
            <stop offset=".42" stopColor={material[1]} />
            <stop offset="1" stopColor={material[2]} />
          </linearGradient>
          <linearGradient id={edge} x1="9" y1="28" x2="33" y2="36" gradientUnits="userSpaceOnUse">
            <stop stopColor={material[2]} />
            <stop offset=".6" stopColor={material[1]} />
            <stop offset="1" stopColor={material[2]} />
          </linearGradient>
          <linearGradient id={ink} x1="10" y1="8" x2="28" y2="29" gradientUnits="userSpaceOnUse">
            <stop stopColor="#fff" />
            <stop offset="1" stopColor={utility ? material[1] : material[0]} />
          </linearGradient>
        </defs>
        {!utility && (
          <g className="cc-icon3d__body">
            <ellipse cx="21" cy="36" rx="13" ry="2" fill="#000" opacity=".22" />
            <rect x="5" y="7" width="30" height="29" rx="9" fill={`url(#${edge})`} />
            <rect x="4" y="3" width="30" height="29" rx="9" fill={`url(#${face})`} />
            <rect
              x="4.6"
              y="3.6"
              width="28.8"
              height="27.8"
              rx="8.4"
              stroke="#fff"
              strokeOpacity=".36"
              strokeWidth="1.2"
            />
            <path
              d="M9 12Q9 7 15 7H24"
              stroke="#fff"
              strokeOpacity=".32"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </g>
        )}
        <g className="cc-icon3d__glyph" strokeLinecap="round" strokeLinejoin="round">
          <Shape
            className="cc-size-preserved"
            x={utility ? "5" : "9"}
            y={utility ? "7" : "10"}
            width={utility ? "30" : "22"}
            height={utility ? "30" : "22"}
            stroke={material[2]}
            strokeWidth="3.6"
            opacity=".9"
          />
          <Shape
            className="cc-size-preserved"
            x={utility ? "4" : "8"}
            y={utility ? "4" : "7"}
            width={utility ? "30" : "22"}
            height={utility ? "30" : "22"}
            stroke={`url(#${ink})`}
            strokeWidth={utility ? 2.8 : 2.5}
          />
        </g>
        {children}
      </svg>
    );
  });
  Icon.displayName = `Sculpted${name}`;
  return Icon;
}

// Navigation: one unique silhouette per destination, including appointments vs callbacks.
export const LayoutDashboard = sculpt(Glyph.PanelsTopLeft, "dashboard", blue);
export const Phone = sculpt(Glyph.Phone, "call", jade);
export const Users = sculpt(Glyph.UsersRound, "leads", blue);
export const CalendarClock = sculpt(Glyph.AlarmClock, "callbacks", gold);
export const CalendarCheck = sculpt(Glyph.CalendarCheck2, "appointments", violet);
export const CircleCheck = sculpt(Glyph.BadgeCheck, "completed", jade);
export const FileText = sculpt(Glyph.Handshake, "customers", gold);
export const FilePen = sculpt(Glyph.ReceiptText, "offers", ruby);
export const ChartNoAxesColumn = sculpt(Glyph.ChartNoAxesCombined, "statistics", blue);
export const CalendarDays = sculpt(Glyph.Sun, "daily-statistics", gold);
export const ClipboardList = sculpt(Glyph.ChartPie, "evaluation", violet);
export const Upload = sculpt(Glyph.CloudUpload, "upload", jade);
export const Crown = sculpt(Glyph.Crown, "accounts", gold);
export const Settings = sculpt(Glyph.Settings2, "settings", blue);
export const LogOut = sculpt(Glyph.LogOut, "logout", ruby, true);
// Contextual actions and feedback follow the same material and lighting family.
export const Building2 = sculpt(Glyph.Building2, "company", blue);
export const FolderOpen = sculpt(Glyph.FolderOpen, "batch", gold);
export const Lightbulb = sculpt(Glyph.Lightbulb, "suggestion", gold);
export const PhoneMissed = sculpt(Glyph.PhoneMissed, "not-reached", ruby);
export const Send = sculpt(Glyph.Rocket, "production", violet);
export const Trophy = sculpt(Glyph.Trophy, "achievement", gold);
export const Target = sculpt(Glyph.Target, "target", ruby);
export const Shield = sculpt(Glyph.Shield, "permissions", blue);
export const ShieldCheck = sculpt(Glyph.ShieldCheck, "security", jade);
export const CircleAlert = sculpt(Glyph.CircleAlert, "alert", ruby);
export const Clock3 = sculpt(Glyph.Hourglass, "waiting", gold);
export const HelpCircle = sculpt(Glyph.MessageCircleQuestion, "help", blue, true);
export const Mail = sculpt(Glyph.Mail, "email", blue, true);
export const MapPin = sculpt(Glyph.MapPin, "location", ruby, true);
export const Search = sculpt(Glyph.Search, "search", blue, true);
export const Trash2 = sculpt(Glyph.Trash2, "delete", ruby, true);
export const Eye = sculpt(Glyph.Eye, "view", blue, true);
export const KeyRound = sculpt(Glyph.KeyRound, "password", gold, true);
export const Power = sculpt(Glyph.Power, "activation", jade, true);
export const Wrench = sculpt(Glyph.Wrench, "fulfilment", violet, true);
export const ArrowRight = sculpt(Glyph.ArrowRight, "continue", jade, true);
export const ChevronRight = sculpt(Glyph.ChevronRight, "expand", blue, true);
export const ExternalLink = sculpt(Glyph.ExternalLink, "external-link", blue, true);
export const Check = sculpt(Glyph.Check, "confirm", jade, true);
export const X = sculpt(Glyph.X, "close", ruby, true);
export const LoaderCircle = sculpt(Glyph.LoaderCircle, "loading", blue, true);
export const PanelLeft = sculpt(Glyph.PanelLeft, "navigation-toggle", blue, true);
export const ChevronDown = sculpt(Glyph.ChevronDown, "open-options", blue, true);
export const ChevronUp = sculpt(Glyph.ChevronUp, "collapse-options", blue, true);
export const ChevronLeft = sculpt(Glyph.ChevronLeft, "previous", blue, true);
export const ArrowLeft = sculpt(Glyph.ArrowLeft, "back", jade, true);
export const MoreHorizontal = sculpt(Glyph.MoreHorizontal, "more-actions", blue, true);
export const ChevronDownIcon = ChevronDown;
export const ChevronLeftIcon = ChevronLeft;
export const ChevronRightIcon = ChevronRight;
