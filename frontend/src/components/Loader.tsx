import React from "react";

type LoaderSize = "xs" | "sm" | "md" | "lg";

interface LoaderProps {
  size?: LoaderSize;
  className?: string;
}

const SIZE_MAP: Record<
  LoaderSize,
  {
    outer: string;
    innerMargin: string;
    centerInset: string;
    border: string;
  }
> = {
  xs: {
    outer: "w-4 h-4",
    innerMargin: "m-[2px]",
    centerInset: "inset-[6px]",
    border: "border",
  },
  sm: {
    outer: "w-6 h-6",
    innerMargin: "m-[3px]",
    centerInset: "inset-[8px]",
    border: "border",
  },
  md: {
    outer: "w-12 h-12",
    innerMargin: "m-1",
    centerInset: "inset-3",
    border: "border-2",
  },
  lg: {
    outer: "w-16 h-16",
    innerMargin: "m-1.5",
    centerInset: "inset-4",
    border: "border-2",
  },
};

export const Loader: React.FC<LoaderProps> = ({
  size = "md",
  className = "",
}) => {
  const cfg = SIZE_MAP[size];

  return (
    <div className={`flex justify-center items-center ${className}`}>
      <div className={`relative ${cfg.outer}`}>
        {/* Outer gradient ring */}
        <div className="absolute inset-0 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 rounded-full animate-spin blur-sm opacity-75"></div>

        {/* Inner background */}
        <div
          className={`absolute inset-0 bg-white dark:bg-gray-900 rounded-full ${cfg.innerMargin}`}
        ></div>

        {/* Inner animated gradient border */}
        <div
          className={`absolute inset-1 rounded-full ${cfg.border} border-transparent bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 bg-clip-border animate-spin`}
          style={{
            WebkitMaskImage: "linear-gradient(transparent 30%, black 70%)",
            maskImage: "linear-gradient(transparent 30%, black 70%)",
          }}
        ></div>

        {/* Center circle */}
        <div
          className={`absolute ${cfg.centerInset} bg-white dark:bg-gray-900 rounded-full`}
        ></div>
      </div>
    </div>
  );
};
