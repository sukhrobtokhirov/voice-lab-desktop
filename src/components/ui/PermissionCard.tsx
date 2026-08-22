import { Button } from "./button";
import { Check, LucideIcon } from "lucide-react";
import { cn } from "../lib/utils";

interface PermissionCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  granted: boolean;
  onRequest: () => void;
  buttonText?: string;
  badge?: string;
  hint?: string;
}

export default function PermissionCard({
  icon: Icon,
  title,
  description,
  granted,
  onRequest,
  buttonText = "Grant Access",
  badge,
  hint,
}: PermissionCardProps) {
  return (
    <div
      className={cn(
        "group relative rounded-md p-3 transition-colors duration-150",
        "border",
        granted
          ? "bg-success/5 border-success/20 dark:bg-success/5 dark:border-success/15"
          : "bg-surface-1 border-border hover:bg-surface-2 hover:border-border-hover"
      )}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "w-8 h-8 rounded-md flex items-center justify-center shrink-0 transition-colors duration-150",
            granted
              ? "bg-success/10 dark:bg-success/15"
              : "bg-primary/10 dark:bg-primary/15 group-hover:bg-primary/15"
          )}
        >
          {granted ? (
            <Check className="w-4 h-4 text-success" strokeWidth={2.5} />
          ) : (
            <Icon className="w-4 h-4 text-primary" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium leading-5 text-foreground">
            {title}
            {badge && (
              <span className="ml-1.5 inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-xs font-medium leading-4 text-muted-foreground">
                {badge}
              </span>
            )}
          </h3>
          <p className="mt-0.5 text-sm leading-5 text-muted-foreground">{description}</p>
        </div>

        {!granted && (
          <Button onClick={onRequest} size="sm" className="h-7 px-3 text-xs shrink-0">
            {buttonText}
          </Button>
        )}
      </div>

      {hint && !granted && (
        <p className="mt-2 pl-11 text-xs leading-5 text-warning/80">{hint}</p>
      )}
    </div>
  );
}
