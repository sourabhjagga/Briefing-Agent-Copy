import * as React from "react";
import { XCircle, CheckCircle, AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

interface ToastProps {
  message: string;
  type?: "success" | "error" | "warning" | "info";
  onClose?: () => void;
}

const Toast = React.forwardRef<HTMLDivElement, ToastProps>(
  ({ message, type = "success", onClose, ...props }, ref) => {
    const icons = {
      success: <CheckCircle className="h-4 w-4" />,
      error: <XCircle className="h-4 w-4" />,
      warning: <AlertTriangle className="h-4 w-4" />,
      info: <Info className="h-4 w-4" />,
    };

    const styles = {
      success: "bg-green-50 border-green-200 text-green-800",
      error: "bg-red-50 border-red-200 text-red-800",
      warning: "bg-yellow-50 border-yellow-200 text-yellow-800",
      info: "bg-blue-50 border-blue-200 text-blue-800",
    };

    return (
      <div
        ref={ref}
        className={cn(
          "fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-md border p-4 shadow-lg transition-all duration-300",
          styles[type]
        )}
        {...props}
      >
        {icons[type]}
        <span className="text-sm font-medium">{message}</span>
        <button
          onClick={onClose}
          className="ml-2 text-gray-500 hover:text-gray-700"
        >
          ×
        </button>
      </div>
    );
  }
);
Toast.displayName = "Toast";

export { Toast };
