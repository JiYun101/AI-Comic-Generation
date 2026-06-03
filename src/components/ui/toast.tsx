import * as ToastPrimitives from "@radix-ui/react-toast";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";

export const ToastProvider = ToastPrimitives.Provider;
export const ToastViewport = (props: ToastPrimitives.ToastViewportProps) => (
  <ToastPrimitives.Viewport
    className="fixed bottom-4 right-4 z-[100] flex max-h-screen w-[360px] max-w-[calc(100vw-32px)] flex-col gap-2 outline-none"
    {...props}
  />
);

export function Toast({ className, ...props }: ToastPrimitives.ToastProps) {
  return (
    <ToastPrimitives.Root
      className={cn("rounded-lg border bg-background p-4 text-sm shadow-lg data-[state=open]:animate-in", className)}
      {...props}
    />
  );
}

export function ToastTitle(props: ToastPrimitives.ToastTitleProps) {
  return <ToastPrimitives.Title className="font-semibold" {...props} />;
}

export function ToastDescription(props: ToastPrimitives.ToastDescriptionProps) {
  return <ToastPrimitives.Description className="mt-1 text-xs text-muted-foreground" {...props} />;
}

export function ToastClose(props: ToastPrimitives.ToastCloseProps) {
  return (
    <ToastPrimitives.Close className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground hover:bg-muted" {...props}>
      <X className="h-4 w-4" />
    </ToastPrimitives.Close>
  );
}
