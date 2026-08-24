import { cn } from "../lib/utils";

interface VoiceLabIconProps {
  source: string;
  className?: string;
}

/** Renders a VoiceLab SVG asset with the current theme's foreground color. */
export default function VoiceLabIcon({ source, className }: VoiceLabIconProps) {
  return (
    <span
      aria-hidden="true"
      className={cn("block shrink-0 bg-current", className)}
      style={{
        maskImage: `url("${source}")`,
        maskPosition: "center",
        maskRepeat: "no-repeat",
        maskSize: "contain",
        WebkitMaskImage: `url("${source}")`,
        WebkitMaskPosition: "center",
        WebkitMaskRepeat: "no-repeat",
        WebkitMaskSize: "contain",
      }}
    />
  );
}
