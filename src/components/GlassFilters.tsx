// LANX 2.15.0: the refraction lens for the glass panels (lib/glass.ts). An
// invisible SVG that holds the filter `backdrop-filter: url(#lanx-lens)`
// points at: the view behind a panel is bent outward near its edges, the
// red channel a touch more than green and blue (a faint prism fringe).
import { useMemo } from "react";
import { lensMapUrl } from "../lib/glass";

const RED = "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0";
const GREEN_BLUE = "0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0";

export function GlassFilters() {
  const map = useMemo(() => lensMapUrl(), []);
  if (!map) return null;
  return (
    <svg width="0" height="0" aria-hidden="true" style={{ position: "absolute", width: 0, height: 0 }} data-glass-filters>
      <filter id="lanx-lens" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
        <feImage href={map} x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="map" />
        <feDisplacementMap in="SourceGraphic" in2="map" scale="11" xChannelSelector="R" yChannelSelector="G" result="gb" />
        <feDisplacementMap in="SourceGraphic" in2="map" scale="13" xChannelSelector="R" yChannelSelector="G" result="r" />
        <feColorMatrix in="r" type="matrix" values={RED} result="red" />
        <feColorMatrix in="gb" type="matrix" values={GREEN_BLUE} result="greenblue" />
        <feComposite in="red" in2="greenblue" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" />
      </filter>
    </svg>
  );
}
