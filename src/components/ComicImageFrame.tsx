import { ImagePlus } from "lucide-react";
import { ReactNode } from "react";
import { ExportRatio } from "../types";
import { cn } from "../lib/utils";

const ratioClass: Record<ExportRatio, string> = {
  "3:4": "aspect-[3/4]",
  "4:5": "aspect-[4/5]",
  "1:1": "aspect-square"
};

export function ComicImageFrame({
  src,
  alt,
  ratio = "3:4",
  fit = "cover",
  className,
  imageClassName,
  fallback
}: {
  src?: string;
  alt: string;
  ratio?: ExportRatio;
  fit?: "cover" | "contain";
  className?: string;
  imageClassName?: string;
  fallback?: ReactNode;
}) {
  return (
    <div className={cn("relative overflow-hidden bg-[#f7f3ea]", ratioClass[ratio], className)}>
      {src ? (
        <img src={src} alt={alt} className={cn("absolute inset-0 h-full w-full", fit === "contain" ? "object-contain" : "object-cover", imageClassName)} />
      ) : (
        fallback ?? (
          <div className="absolute inset-0 flex items-center justify-center text-zinc-400">
            <ImagePlus className="h-5 w-5" />
          </div>
        )
      )}
    </div>
  );
}
