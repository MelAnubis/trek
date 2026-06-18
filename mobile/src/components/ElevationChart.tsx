import React from 'react';
import { View } from 'react-native';
import Svg, {
  Path, Defs, LinearGradient, Stop,
  Line, Text as SvgText, Circle,
} from 'react-native-svg';
import { COLORS } from '@/theme/colors';

export interface ElevPoint { dist: number; ele: number; }

interface Props {
  points: ElevPoint[];
  width: number;
  height?: number;
  currentDist?: number;
  compact?: boolean;
}

export function ElevationChart({ points, width, height = 80, currentDist, compact = false }: Props) {
  if (points.length < 2) return null;

  const eles = points.map((p) => p.ele);
  const minEle = Math.min(...eles);
  const maxEle = Math.max(...eles);
  const eleRange = maxEle - minEle || 1;
  const totalDist = points[points.length - 1].dist;

  const pL = compact ? 4 : 36, pR = 4, pT = compact ? 4 : 8, pB = compact ? 4 : 18;
  const w = width - pL - pR;
  const h = height - pT - pB;

  const px = (d: number) => pL + (d / totalDist) * w;
  const py = (e: number) => pT + h - ((e - minEle) / eleRange) * h;

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${px(p.dist).toFixed(1)},${py(p.ele).toFixed(1)}`)
    .join(' ');
  const fillPath = `${linePath} L${px(totalDist).toFixed(1)},${(pT + h).toFixed(1)} L${px(0).toFixed(1)},${(pT + h).toFixed(1)} Z`;

  const curX = currentDist != null ? px(Math.min(currentDist, totalDist)) : null;

  return (
    <View>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="eg" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={COLORS.primary} stopOpacity="0.4" />
            <Stop offset="1" stopColor={COLORS.primary} stopOpacity="0.03" />
          </LinearGradient>
        </Defs>
        <Path d={fillPath} fill="url(#eg)" />
        <Path d={linePath} stroke={COLORS.primary} strokeWidth="1.5" fill="none" />
        {!compact && (
          <>
            <SvgText x={pL - 3} y={pT + 5} textAnchor="end" fontSize="9" fill={COLORS.textMuted}>
              {`${Math.round(maxEle)}m`}
            </SvgText>
            <SvgText x={pL - 3} y={pT + h + 1} textAnchor="end" fontSize="9" fill={COLORS.textMuted}>
              {`${Math.round(minEle)}m`}
            </SvgText>
          </>
        )}
        {curX != null && (
          <>
            <Line
              x1={curX} y1={pT} x2={curX} y2={pT + h}
              stroke="#2563EB" strokeWidth="2" strokeDasharray="3,2"
            />
            <Circle cx={curX} cy={py(points.find((p) => p.dist >= (currentDist ?? 0))?.ele ?? minEle)} r="4" fill="#2563EB" />
          </>
        )}
      </Svg>
    </View>
  );
}
