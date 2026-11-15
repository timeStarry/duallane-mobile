import { useId } from "react";

export type BrandLogoSize = "xs" | "sm" | "md" | "lg" | number;

const SIZE_MAP: Record<Exclude<BrandLogoSize, number>, number> = {
  xs: 16,
  sm: 24,
  md: 36,
  lg: 48,
};

export function BrandLogo({
  size = "md",
  withTile = false,
  monochrome = false,
  label,
  className = "",
}: {
  size?: BrandLogoSize;
  withTile?: boolean;
  monochrome?: boolean;
  label?: string;
  className?: string;
}) {
  const rawId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const pixelSize = typeof size === "number" ? size : SIZE_MAP[size];
  const innerSvgSize = withTile ? Math.max(14, Math.round(pixelSize * 0.78)) : pixelSize;
  const isSmallOptical = innerSvgSize <= 20;

  const amberGradId = `dl-pane-amber-${rawId}`;
  const blueGradId = `dl-pane-blue-${rawId}`;
  const lensGradId = `dl-pane-lens-${rawId}`;
  const specGradId = `dl-pane-spec-${rawId}`;
  const clipBlueId = `dl-pane-clip-${rawId}`;

  const fillBlue = monochrome ? "currentColor" : `url(#${blueGradId})`;
  const fillAmber = monochrome ? "currentColor" : `url(#${amberGradId})`;
  const fillLens = monochrome ? "currentColor" : `url(#${lensGradId})`;
  const strokeSpec = monochrome || isSmallOptical ? "none" : `url(#${specGradId})`;
  const strokeWidth = monochrome || isSmallOptical ? 0 : 2;

  const bluePaneTransform = "rotate(-12 101 134)";
  const amberPaneTransform = "rotate(12 155 122)";

  const svgElement = (
    <svg
      viewBox="0 0 256 256"
      width={innerSvgSize}
      height={innerSvgSize}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      data-brand-mark="vibrancy-panes"
      aria-hidden={withTile || !label ? true : undefined}
      role={!withTile && label ? "img" : undefined}
      aria-label={!withTile && label ? label : undefined}
      className={`shrink-0 select-none ${!withTile ? className : ""}`}
    >
      <defs>
        <clipPath id={clipBlueId}>
          <rect x="44" y="64" width="114" height="140" rx="34" transform={bluePaneTransform} />
        </clipPath>
        {!monochrome && (
          <>
            <linearGradient id={blueGradId} x1="0%" y1="12%" x2="95%" y2="88%">
              <stop offset="0%" stopColor="#BAE6FD" />
              <stop offset="45%" stopColor="#0EA5E9" />
              <stop offset="100%" stopColor="#0369A1" />
            </linearGradient>
            <linearGradient id={amberGradId} x1="0%" y1="12%" x2="95%" y2="88%">
              <stop offset="0%" stopColor="#FDE68A" />
              <stop offset="45%" stopColor="#F97316" />
              <stop offset="100%" stopColor="#C2410C" />
            </linearGradient>
            <linearGradient id={lensGradId} x1="20%" y1="10%" x2="80%" y2="90%">
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.95" />
              <stop offset="55%" stopColor="#E0F2FE" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#FED7AA" stopOpacity="0.76" />
            </linearGradient>
            <linearGradient id={specGradId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.72" />
              <stop offset="50%" stopColor="#FFFFFF" stopOpacity="0.16" />
              <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
            </linearGradient>
          </>
        )}
      </defs>
      <rect
        x="44"
        y="64"
        width="114"
        height="140"
        rx="34"
        transform={bluePaneTransform}
        fill={fillBlue}
        fillOpacity={monochrome ? 0.56 : undefined}
        stroke={strokeSpec}
        strokeWidth={strokeWidth}
      />
      <rect
        x="98"
        y="52"
        width="114"
        height="140"
        rx="34"
        transform={amberPaneTransform}
        fill={fillAmber}
        fillOpacity={monochrome ? 0.78 : 0.9}
        stroke={strokeSpec}
        strokeWidth={strokeWidth}
      />
      <g clipPath={`url(#${clipBlueId})`}>
        <rect
          x="98"
          y="52"
          width="114"
          height="140"
          rx="34"
          transform={amberPaneTransform}
          fill={fillLens}
          stroke={monochrome || isSmallOptical ? "none" : "#FFFFFF"}
          strokeOpacity={monochrome || isSmallOptical ? undefined : 0.7}
          strokeWidth={monochrome || isSmallOptical ? 0 : 1.5}
        />
      </g>
    </svg>
  );

  if (!withTile) return svgElement;

  const tileRadius = Math.max(6, Math.round(pixelSize * 0.28));
  return (
    <div
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      style={{
        width: pixelSize,
        height: pixelSize,
        borderRadius: tileRadius,
        background: "radial-gradient(120% 120% at 22% 15%, #1E2D45 0%, #0B111B 62%, #060A11 100%)",
        boxShadow:
          "inset 0 1px 1px rgba(255, 255, 255, 0.2), 0 8px 18px -6px rgba(6, 10, 17, 0.42)",
      }}
      className={`inline-flex shrink-0 items-center justify-center select-none text-slate-100 ${className}`}
    >
      {svgElement}
    </div>
  );
}
