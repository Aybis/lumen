import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva("focus-ring inline-flex items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-all disabled:pointer-events-none disabled:opacity-50", {
  variants: {
    variant: {
      default: "bg-[#101a2d] text-white hover:bg-[#24314a]",
      primary: "bg-[#2764ff] text-white hover:bg-[#1954e7]",
      outline: "border border-[#d9d6ce] bg-white text-[#101a2d] hover:border-[#a9afbc]",
      ghost: "text-[#657087] hover:bg-[#ebe8e0] hover:text-[#101a2d]",
    },
    size: { default: "h-10 px-4", sm: "h-8 px-3 text-xs", icon: "h-9 w-9" },
  },
  defaultVariants: { variant: "default", size: "default" },
});

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}
export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}
