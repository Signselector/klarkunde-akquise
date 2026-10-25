import { forwardRef, useId } from "react";
import * as Glyph from "lucide-react";
import type { LucideIcon, LucideProps } from "lucide-react";
import "./icons-3d.css";

/** Ruby-red glass surfaces with translucent edges and bright engraved glyphs. */
function sculpt(Shape: LucideIcon, name: string, utility = false) {
  const Icon = forwardRef<SVGSVGElement, LucideProps>(function SculptedIcon(
    { size = 24, className = "", strokeWidth: _stroke, color: _color, children, ...props },
    ref,
  ) {
    const uid = useId().replace(/:/g, "");
    const face = `${uid}-face`,
      edge = `${uid}-edge`,
      ink = `${uid}-ink`,
      clip = `${uid}-clip`,
      reflection = `${uid}-reflection`,
      rim = `${uid}-rim`;
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
            <stop stopColor="#ffb7bc" stopOpacity=".68" />
            <stop offset=".46" stopColor="#bb122b" stopOpacity=".58" />
            <stop offset="1" stopColor="#510715" stopOpacity=".8" />
          </linearGradient>
          <linearGradient id={edge} x1="9" y1="28" x2="33" y2="36" gradientUnits="userSpaceOnUse">
            <stop stopColor="#26030b" stopOpacity=".84" />
            <stop offset=".5" stopColor="#b74c5b" stopOpacity=".64" />
            <stop offset="1" stopColor="#4c0715" stopOpacity=".86" />
          </linearGradient>
          <linearGradient id={ink} x1="10" y1="8" x2="28" y2="29" gradientUnits="userSpaceOnUse">
            <stop stopColor={utility ? "currentColor" : "#fff7f8"} stopOpacity=".96" />
            <stop offset=".5" stopColor={utility ? "currentColor" : "#ffd1d7"} stopOpacity=".82" />
            <stop offset="1" stopColor={utility ? "currentColor" : "#ffffff"} stopOpacity=".98" />
          </linearGradient>
          <clipPath id={clip}>
            <rect x="4" y="3" width="30" height="29" rx="9" />
          </clipPath>
          <linearGradient id={reflection} x1="0" y1="0" x2="1" y2="0">
            <stop stopColor="#fff" stopOpacity="0" />
            <stop offset=".45" stopColor="#fff" stopOpacity=".08" />
            <stop offset=".55" stopColor="#fff" stopOpacity=".64" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={rim} x1="4" y1="3" x2="32" y2="32" gradientUnits="userSpaceOnUse">
            <stop stopColor="#ffe0e4" stopOpacity=".96" />
            <stop offset=".35" stopColor="#fff" stopOpacity=".18" />
            <stop offset=".72" stopColor="#fff" stopOpacity=".04" />
            <stop offset="1" stopColor="#fff" stopOpacity=".58" />
          </linearGradient>
        </defs>
        {!utility && (
          <g className="cc-icon3d__body">
            <ellipse cx="22" cy="37" rx="14" ry="2.4" fill="#000" opacity=".2" />
            <rect x="7" y="8" width="30" height="29" rx="9" fill={`url(#${edge})`} />
            <rect
              x="5.5"
              y="5.5"
              width="30"
              height="29"
              rx="9"
              stroke="#fff"
              strokeOpacity=".18"
              fill="none"
            />
            <rect x="4" y="3" width="30" height="29" rx="9" fill={`url(#${face})`} />
            <rect
              x="4.6"
              y="3.6"
              width="28.8"
              height="27.8"
              rx="8.4"
              stroke={`url(#${rim})`}
              strokeOpacity="1"
              strokeWidth="1.4"
            />
            <rect
              x="6.7"
              y="5.7"
              width="24.6"
              height="23.6"
              rx="6.5"
              stroke="#fff"
              strokeOpacity=".16"
              strokeWidth=".7"
            />
            <path
              d="M5 15C12 19 24 11 33 16V11C33 6 30 4 25 4H13C8 4 5 7 5 12Z"
              fill="#fff"
              opacity=".09"
            />
            <path
              d="M13 31H25Q33 31 33 23"
              stroke="#fff"
              strokeOpacity=".34"
              strokeWidth="1"
              strokeLinecap="round"
            />
            <g clipPath={`url(#${clip})`}>
              <g transform="rotate(-28 20 20)">
                <rect
                  className="cc-icon3d__shine"
                  x="-35"
                  y="-15"
                  width="32"
                  height="75"
                  fill={`url(#${reflection})`}
                />
              </g>
            </g>
            <path
              d="M9 12Q9 7 15 7H24"
              stroke="#fff"
              strokeOpacity=".42"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </g>
        )}
        <g className="cc-icon3d__glyph" strokeLinecap="round" strokeLinejoin="round">
          <Shape
            className="cc-size-preserved"
            x={utility ? "5" : "9"}
            y={utility ? "5.5" : "8.5"}
            width={utility ? "30" : "22"}
            height={utility ? "30" : "22"}
            stroke="currentColor"
            strokeWidth="3"
            opacity=".32"
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
export const LayoutDashboard = sculpt(Glyph.PanelsTopLeft, "dashboard");
export const Phone = sculpt(Glyph.Phone, "call");
export const Users = sculpt(Glyph.UsersRound, "leads");
export const CalendarClock = sculpt(Glyph.AlarmClock, "callbacks");
export const CalendarCheck = sculpt(Glyph.CalendarCheck2, "appointments");
export const CircleCheck = sculpt(Glyph.BadgeCheck, "completed");
export const FileText = sculpt(Glyph.Handshake, "customers");
export const FilePen = sculpt(Glyph.ReceiptText, "offers");
export const ChartNoAxesColumn = sculpt(Glyph.ChartNoAxesCombined, "statistics");
export const CalendarDays = sculpt(Glyph.Sun, "daily-statistics");
export const ClipboardList = sculpt(Glyph.ChartPie, "evaluation");
export const Upload = sculpt(Glyph.CloudUpload, "upload");
export const Crown = sculpt(Glyph.Crown, "accounts");
export const Settings = sculpt(Glyph.Settings2, "settings");
export const LogOut = sculpt(Glyph.LogOut, "logout", true);
// Contextual actions and feedback follow the same material and lighting family.
export const Building2 = sculpt(Glyph.Building2, "company");
export const FolderOpen = sculpt(Glyph.FolderOpen, "batch");
export const Lightbulb = sculpt(Glyph.Lightbulb, "suggestion");
export const PhoneMissed = sculpt(Glyph.PhoneMissed, "not-reached");
export const Send = sculpt(Glyph.Rocket, "production");
export const Trophy = sculpt(Glyph.Trophy, "achievement");
export const Target = sculpt(Glyph.Target, "target");
export const Shield = sculpt(Glyph.Shield, "permissions");
export const ShieldCheck = sculpt(Glyph.ShieldCheck, "security");
export const CircleAlert = sculpt(Glyph.CircleAlert, "alert");
export const Clock3 = sculpt(Glyph.Hourglass, "waiting");
export const HelpCircle = sculpt(Glyph.MessageCircleQuestion, "help", true);
export const Mail = sculpt(Glyph.Mail, "email", true);
export const MapPin = sculpt(Glyph.MapPin, "location", true);
export const Search = sculpt(Glyph.Search, "search", true);
export const Trash2 = sculpt(Glyph.Trash2, "delete", true);
export const Eye = sculpt(Glyph.Eye, "view", true);
export const KeyRound = sculpt(Glyph.KeyRound, "password", true);
export const Power = sculpt(Glyph.Power, "activation", true);
export const Wrench = sculpt(Glyph.Wrench, "fulfilment", true);
export const ArrowRight = sculpt(Glyph.ArrowRight, "continue", true);
export const ChevronRight = sculpt(Glyph.ChevronRight, "expand", true);
export const ExternalLink = sculpt(Glyph.ExternalLink, "external-link", true);
export const Check = sculpt(Glyph.Check, "confirm", true);
export const X = sculpt(Glyph.X, "close", true);
export const LoaderCircle = sculpt(Glyph.LoaderCircle, "loading", true);
export const PanelLeft = sculpt(Glyph.PanelLeft, "navigation-toggle", true);
export const ChevronDown = sculpt(Glyph.ChevronDown, "open-options", true);
export const ChevronUp = sculpt(Glyph.ChevronUp, "collapse-options", true);
export const ChevronLeft = sculpt(Glyph.ChevronLeft, "previous", true);
export const ArrowLeft = sculpt(Glyph.ArrowLeft, "back", true);
export const MoreHorizontal = sculpt(Glyph.MoreHorizontal, "more-actions", true);
export const ChevronDownIcon = ChevronDown;
export const ChevronLeftIcon = ChevronLeft;
export const ChevronRightIcon = ChevronRight;
