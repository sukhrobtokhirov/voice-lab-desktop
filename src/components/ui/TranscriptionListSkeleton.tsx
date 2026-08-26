import { Skeleton } from "./skeleton";

const ROW_WIDTHS = ["w-[42%]", "w-[64%]", "w-[51%]", "w-[72%]"];

/** Mirrors the final history layout so loading never reflows the page. */
export default function TranscriptionListSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading transcriptions">
      <div className="-mx-4 flex items-center justify-between bg-background px-5 pb-2 pt-2">
        <Skeleton className="h-3 w-12" />
        <div className="flex items-center gap-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-14" />
        </div>
      </div>

      <div className="space-y-1.5">
        {ROW_WIDTHS.map((width, index) => (
          <div key={width}>
            <div className="rounded-sm bg-white/[0.035] p-3 backdrop-blur-xl">
              <Skeleton className={`h-5 ${width}`} />
            </div>
            <div className="mt-1.5 flex justify-end pr-0.5">
              <Skeleton className={`h-3 ${index % 2 === 0 ? "w-12" : "w-14"}`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
