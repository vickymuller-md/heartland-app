'use client';

/**
 * UsStateMap -- US Choropleth Map for NIW Traction Evidence
 * Requirements: REPT-07 (geographic state choropleth for NIW petition)
 * Source: HEARTLAND Protocol v3.3 -- Phase 28 Reporting & NIW Evidence
 *
 * Highlights active states (where patients/providers are located) in blue.
 * Uses us-atlas TopoJSON; state names match profiles.state column values.
 */

import {
  ComposableMap,
  Geographies,
  Geography,
} from '@vnedyalk0v/react19-simple-maps';

const GEO_URL =
  'https://cdn.jsdelivr.net/npm/us-atlas@3/states-albers-10m.json';

interface UsStateMapProps {
  activeStates: string[]; // full state names matching us-atlas properties.name
  width?: number;
}

export function UsStateMap({ activeStates, width = 800 }: UsStateMapProps) {
  const activeSet = new Set(activeStates);
  return (
    <ComposableMap
      projection="geoAlbersUsa"
      width={width}
      height={Math.round(width * 0.625)}
    >
      <Geographies geography={GEO_URL}>
        {({ geographies }: { geographies: Array<{ rsmKey: string; properties: { name: string } }> }) =>
          geographies.map((geo) => {
            const isActive = activeSet.has(geo.properties.name);
            return (
              <Geography
                key={geo.rsmKey}
                geography={geo}
                fill={isActive ? '#1e40af' : '#e5e7eb'}
                stroke="#ffffff"
                strokeWidth={0.5}
                style={{ default: { outline: 'none' }, hover: { outline: 'none' }, pressed: { outline: 'none' } }}
              />
            );
          })
        }
      </Geographies>
    </ComposableMap>
  );
}
