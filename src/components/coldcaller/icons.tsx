import { forwardRef } from "react";
import * as Glyph from "lucide-react";
import type { LucideIcon, LucideProps } from "lucide-react";
import "./icons.css";

/** Clean library glyphs matching the approved clear-icon / graphite direction. */
function lineIcon(Shape: LucideIcon, name: string) {
  const Icon = forwardRef<SVGSVGElement, LucideProps>(function ClearIcon(
    { size = 24, className = "", strokeWidth = 1.8, ...props },
    ref,
  ) {
    return (
      <Shape
        ref={ref}
        size={size}
        strokeWidth={strokeWidth}
        aria-hidden="true"
        focusable="false"
        {...props}
        className={`cc-icon cc-size-preserved ${className}`}
        data-cc-icon={name}
      />
    );
  });
  Icon.displayName = `Clear${name}`;
  return Icon;
}

// Navigation: one unique silhouette per destination, including appointments vs callbacks.
export const LayoutDashboard = lineIcon(Glyph.PanelsTopLeft, "dashboard");
export const Phone = lineIcon(Glyph.Phone, "call");
export const Users = lineIcon(Glyph.UsersRound, "leads");
export const CalendarClock = lineIcon(Glyph.History, "callbacks");
export const CalendarCheck = lineIcon(Glyph.CalendarDays, "appointments");
export const CircleCheck = lineIcon(Glyph.CircleCheck, "completed");
export const FileText = lineIcon(Glyph.Handshake, "customers");
export const FilePen = lineIcon(Glyph.FilePenLine, "offers");
export const ChartNoAxesColumn = lineIcon(Glyph.ChartNoAxesColumn, "statistics");
export const CalendarDays = lineIcon(Glyph.Sun, "daily-statistics");
export const ClipboardList = lineIcon(Glyph.ChartPie, "evaluation");
export const Upload = lineIcon(Glyph.Upload, "upload");
export const Crown = lineIcon(Glyph.Crown, "accounts");
export const Settings = lineIcon(Glyph.Settings, "settings");
export const LogOut = lineIcon(Glyph.LogOut, "logout");
// Contextual actions and feedback follow the same material and lighting family.
export const Building2 = lineIcon(Glyph.Building2, "company");
export const FolderOpen = lineIcon(Glyph.FolderOpen, "batch");
export const Lightbulb = lineIcon(Glyph.Lightbulb, "suggestion");
export const PhoneMissed = lineIcon(Glyph.PhoneMissed, "not-reached");
export const Send = lineIcon(Glyph.Rocket, "production");
export const Trophy = lineIcon(Glyph.Trophy, "achievement");
export const Target = lineIcon(Glyph.Target, "target");
export const Shield = lineIcon(Glyph.Shield, "permissions");
export const ShieldCheck = lineIcon(Glyph.ShieldCheck, "security");
export const CircleAlert = lineIcon(Glyph.CircleAlert, "alert");
export const Clock3 = lineIcon(Glyph.Hourglass, "waiting");
export const HelpCircle = lineIcon(Glyph.MessageCircleQuestion, "help");
export const Mail = lineIcon(Glyph.Mail, "email");
export const ImageIcon = lineIcon(Glyph.Image, "image");
export const Box = lineIcon(Glyph.Box, "box");
export const Pencil = lineIcon(Glyph.Pencil, "edit");
export const MapPin = lineIcon(Glyph.MapPin, "location");
export const Search = lineIcon(Glyph.Search, "search");
export const Trash2 = lineIcon(Glyph.Trash2, "delete");
export const Eye = lineIcon(Glyph.Eye, "view");
export const KeyRound = lineIcon(Glyph.KeyRound, "password");
export const Power = lineIcon(Glyph.Power, "activation");
export const ArrowRight = lineIcon(Glyph.ArrowRight, "continue");
export const ChevronRight = lineIcon(Glyph.ChevronRight, "expand");
export const ExternalLink = lineIcon(Glyph.ExternalLink, "external-link");
export const Check = lineIcon(Glyph.Check, "confirm");
export const X = lineIcon(Glyph.X, "close");
export const LoaderCircle = lineIcon(Glyph.LoaderCircle, "loading");
export const PanelLeft = lineIcon(Glyph.PanelLeft, "navigation-toggle");
export const ChevronDown = lineIcon(Glyph.ChevronDown, "open-options");
export const ChevronUp = lineIcon(Glyph.ChevronUp, "collapse-options");
export const ChevronLeft = lineIcon(Glyph.ChevronLeft, "previous");
export const ArrowLeft = lineIcon(Glyph.ArrowLeft, "back");
export const MoreHorizontal = lineIcon(Glyph.MoreHorizontal, "more-actions");
export const ChevronDownIcon = ChevronDown;
export const ChevronLeftIcon = ChevronLeft;
export const ChevronRightIcon = ChevronRight;
