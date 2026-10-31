import { Calendar, Clock } from "lucide-react";
import { Box, ImageIcon, Mail, Phone, PhoneMissed, X } from "@/components/coldcaller/icons";

/** Icon of every call result; shared by the result buttons of the lead list and of the customer file. */
export const ACTION_ICON: Record<string, typeof Mail> = {
  low_q: ImageIcon,
  high_q: Box,
  waiting_3d: Clock as never,
  no_interest: X,
  on_hold: Calendar as never,
  callback: Phone,
  reference_mail: Mail,
  not_reached: PhoneMissed,
};
