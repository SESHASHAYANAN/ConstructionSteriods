/**
 * ErrorHighlightOverlay — SVG-based annotation overlay for construction drawings.
 *
 * Replaces the old hash-based canvas annotation with real coordinate mapping.
 * Parses issue.location for grid references like "Grid B-3", "Zone C2", "Column C1"
 * and maps them to actual positions on the drawing.
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Loader2, AlertTriangle, CheckCircle, ZoomIn, X,
  Image as ImageIcon
} from 'lucide-react';
import { getProjectDrawingImage } from '../lib/api';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// ── Grid Coordinate Parser ──────────────────────────────────────────────────
// Maps grid references from issue.location to normalized (0-1) coordinates

const GRID_COLS = {
  'A': 0.10, 'B': 0.30, 'C': 0.50, 'D': 0.70, 'E': 0.85,
  'F': 0.92, 'a': 0.10, 'b': 0.30, 'c': 0.50, 'd': 0.70,
  'e': 0.85, 'f': 0.92
};

const GRID_ROWS = {
  '1': 0.12, '2': 0.30, '3': 0.50, '4': 0.70, '5': 0.85, '6': 0.92
};

// Quadrant/zone mapping for "upper-left", "lower-right", etc.
const ZONE_MAP = {
  'upper-left': { x: 0.20, y: 0.20 }, 'top-left': { x: 0.20, y: 0.20 },
  'upper-right': { x: 0.80, y: 0.20 }, 'top-right': { x: 0.80, y: 0.20 },
  'lower-left': { x: 0.20, y: 0.80 }, 'bottom-left': { x: 0.20, y: 0.80 },
  'lower-right': { x: 0.80, y: 0.80 }, 'bottom-right': { x: 0.80, y: 0.80 },
  'center': { x: 0.50, y: 0.50 }, 'middle': { x: 0.50, y: 0.50 },
  'top': { x: 0.50, y: 0.15 }, 'upper': { x: 0.50, y: 0.15 },
  'bottom': { x: 0.50, y: 0.85 }, 'lower': { x: 0.50, y: 0.85 },
  'left': { x: 0.15, y: 0.50 }, 'right': { x: 0.85, y: 0.50 },
  'north': { x: 0.50, y: 0.15 }, 'south': { x: 0.50, y: 0.85 },
  'east': { x: 0.85, y: 0.50 }, 'west': { x: 0.15, y: 0.50 },
};

/**
 * Parse issue location string to extract normalized (0-1) x,y coordinates.
 * Handles patterns like:
 *   "Grid B-3", "Grid intersection B/3", "Column C1",
 *   "Zone B3", "upper-left", "Bay 2-3", "Beam B1 at grid B-3"
 */
export function parseLocationToCoords(location, fallbackIssue) {
  if (!location || typeof location !== 'string') {
    return generateFallbackCoords(fallbackIssue);
  }

  const loc = location.trim();

  // Pattern 1: "Grid X-Y" or "Grid X/Y" or "grid intersection X-Y"
  const gridMatch = loc.match(/[Gg]rid\s*(?:intersection\s*)?([A-Fa-f])\s*[-\/,]\s*(\d)/);
  if (gridMatch) {
    const col = GRID_COLS[gridMatch[1]] || 0.5;
    const row = GRID_ROWS[gridMatch[2]] || 0.5;
    return { x: col, y: row, confidence: 'high', source: 'grid' };
  }

  // Pattern 2: "Zone XX" or just "B3", "C2" style grid ref
  const zoneGridMatch = loc.match(/(?:[Zz]one\s*|[Cc]olumn\s*|[Bb]eam\s*)?([A-Fa-f])[-\s]?(\d)/);
  if (zoneGridMatch) {
    const col = GRID_COLS[zoneGridMatch[1]] || 0.5;
    const row = GRID_ROWS[zoneGridMatch[2]] || 0.5;
    return { x: col, y: row, confidence: 'medium', source: 'zone-grid' };
  }

  // Pattern 3: Quadrant/position keywords
  const locLower = loc.toLowerCase();
  for (const [keyword, coords] of Object.entries(ZONE_MAP)) {
    if (locLower.includes(keyword)) {
      return { x: coords.x, y: coords.y, confidence: 'medium', source: 'keyword' };
    }
  }

  // Pattern 4: "Page X" or "Sheet X" — center of page
  const pageMatch = loc.match(/[Pp]age\s*(\d+)/);
  if (pageMatch) {
    return { x: 0.5, y: 0.5, confidence: 'low', source: 'page-center' };
  }

  // Pattern 5: Try to parse from description context
  return generateFallbackCoords(fallbackIssue);
}

/**
 * Generate deterministic but distributed fallback coordinates from issue data.
 * Uses a better hash that distributes points across the drawing, weighted
 * by issue type to cluster similar issues.
 */
function generateFallbackCoords(issue) {
  if (!issue) return { x: 0.5, y: 0.5, confidence: 'none', source: 'default' };

  const str = (issue.id || '') + (issue.issue_type || '') + (issue.drawing_ref || '');
  let h1 = 0, h2 = 0;
  for (let i = 0; i < str.length; i++) {
    h1 = ((h1 << 5) - h1 + str.charCodeAt(i)) | 0;
    h2 = ((h2 << 7) + h2 + str.charCodeAt(i)) | 0;
  }

  // Map to 0.15 - 0.85 range to keep annotations within visible drawing area
  const x = 0.15 + (Math.abs(h1 % 700) / 1000);
  const y = 0.15 + (Math.abs(h2 % 700) / 1000);
  return { x, y, confidence: 'fallback', source: 'hash' };
}

// ── SVG Annotation Component ────────────────────────────────────────────────

function SVGAnnotation({ x, y, width, height, issue, isFixed, confidence }) {
  const cx = x * width;
  const cy = y * height;
  const radius = Math.min(width, height) * 0.05;
  const crossSize = radius * 0.5;

  const strokeColor = isFixed ? '#22c55e' : '#ef4444';
  const glowColor = isFixed ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)';
  const labelText = isFixed ? 'RESOLVED' : 'ISSUE';
  const labelBg = isFixed ? '#166534' : '#991b1b';

  // Confidence indicator ring
  const confColor = confidence === 'high' ? '#22c55e'
    : confidence === 'medium' ? '#f59e0b'
    : confidence === 'low' ? '#f97316' : '#6b7280';

  return (
    <g className="error-annotation">
      {/* Pulsing glow circle */}
      <circle
        cx={cx} cy={cy} r={radius + 8}
        fill="none"
        stroke={glowColor}
        strokeWidth="6"
        opacity="0.6"
      >
        <animate
          attributeName="r"
          values={`${radius + 5};${radius + 12};${radius + 5}`}
          dur="2s"
          repeatCount="indefinite"
        />
        <animate
          attributeName="opacity"
          values="0.6;0.2;0.6"
          dur="2s"
          repeatCount="indefinite"
        />
      </circle>

      {/* Main circle */}
      <circle
        cx={cx} cy={cy} r={radius}
        fill="none"
        stroke={strokeColor}
        strokeWidth="3"
      />

      {/* Confidence indicator (small dot) */}
      <circle
        cx={cx + radius + 4} cy={cy - radius - 4} r="4"
        fill={confColor}
        stroke="#0f172a"
        strokeWidth="1"
      />

      {/* Crosshairs (for unresolved) */}
      {!isFixed && (
        <>
          <line
            x1={cx - crossSize} y1={cy} x2={cx + crossSize} y2={cy}
            stroke={strokeColor} strokeWidth="1.5" opacity="0.7"
          />
          <line
            x1={cx} y1={cy - crossSize} x2={cx} y2={cy + crossSize}
            stroke={strokeColor} strokeWidth="1.5" opacity="0.7"
          />
        </>
      )}

      {/* Checkmark for resolved */}
      {isFixed && (
        <text
          x={cx} y={cy + radius * 0.25}
          textAnchor="middle"
          fill="#22c55e"
          fontSize={Math.max(14, radius * 0.6)}
          fontWeight="bold"
          fontFamily="Calibri, sans-serif"
        >✓</text>
      )}

      {/* Label background */}
      <rect
        x={cx - 28} y={cy - radius - 24}
        width="56" height="16"
        rx="4"
        fill={labelBg}
        opacity="0.9"
      />
      {/* Label text */}
      <text
        x={cx} y={cy - radius - 12}
        textAnchor="middle"
        fill="white"
        fontSize="10"
        fontWeight="bold"
        fontFamily="Calibri, sans-serif"
      >{labelText}</text>

      {/* Location label */}
      {issue?.location && issue.location !== 'N/A' && (
        <>
          <rect
            x={cx - 40} y={cy + radius + 6}
            width="80" height="14"
            rx="3"
            fill="#1e293b"
            opacity="0.85"
            stroke={strokeColor}
            strokeWidth="0.5"
          />
          <text
            x={cx} y={cy + radius + 16}
            textAnchor="middle"
            fill="#e2e8f0"
            fontSize="8"
            fontFamily="monospace"
          >{(issue.location || '').slice(0, 16)}</text>
        </>
      )}
    </g>
  );
}

// ── Main Overlay Component ──────────────────────────────────────────────────

export default function ErrorHighlightOverlay({ projectId, issue, isFixed }) {
  const imageRef = useRef(null);
  const containerRef = useRef(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [pdfReady, setPdfReady] = useState(false);
  const [containerSize, setContainerSize] = useState({ width: 600, height: 450 });
  const [showZoom, setShowZoom] = useState(false);

  const { data: drawingData } = useQuery({
    queryKey: ['drawing-image', projectId],
    queryFn: () => getProjectDrawingImage(projectId),
    enabled: !!projectId,
    retry: false,
  });

  const fileUrl = drawingData?.url ? `${API_BASE}${drawingData.url}` : null;
  const isPdf = drawingData?.type === 'pdf';

  // Parse issue location to real coordinates
  const coords = parseLocationToCoords(issue?.location, issue);

  const onPdfRenderSuccess = useCallback(() => {
    setPdfReady(true);
    // Measure PDF canvas size
    const container = containerRef.current;
    if (container) {
      const pdfCanvas = container.querySelector('.react-pdf__Page__canvas');
      if (pdfCanvas) {
        setContainerSize({
          width: pdfCanvas.offsetWidth || 600,
          height: pdfCanvas.offsetHeight || 450,
        });
      }
    }
  }, []);

  useEffect(() => {
    if (!isPdf && imageLoaded && imageRef.current) {
      setContainerSize({
        width: imageRef.current.naturalWidth || 800,
        height: imageRef.current.naturalHeight || 600,
      });
    }
  }, [imageLoaded, isPdf]);

  if (!fileUrl) {
    return (
      <div className="p-6 text-center">
        <ImageIcon className="w-8 h-8 text-surface-600 mx-auto mb-2" />
        <p className="text-surface-500 text-sm">No drawing image available for this project</p>
      </div>
    );
  }

  const annotationOverlay = (w, h) => (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="absolute top-0 left-0 pointer-events-none"
      style={{ zIndex: 10 }}
    >
      <SVGAnnotation
        x={coords.x}
        y={coords.y}
        width={w}
        height={h}
        issue={issue}
        isFixed={isFixed}
        confidence={coords.confidence}
      />
    </svg>
  );

  return (
    <div className="relative">
      {isPdf ? (
        <div ref={containerRef} className="relative cursor-pointer" onClick={() => setShowZoom(!showZoom)}>
          <Document
            file={fileUrl}
            loading={
              <div className="p-8 text-center">
                <Loader2 className="w-6 h-6 text-surface-400 mx-auto animate-spin" />
                <p className="text-surface-500 text-xs mt-2">Loading drawing...</p>
              </div>
            }
            error={
              <div className="p-6 text-center">
                <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-2" />
                <p className="text-surface-400 text-sm">Failed to load PDF drawing</p>
              </div>
            }
          >
            <Page
              pageNumber={1}
              width={600}
              onRenderSuccess={onPdfRenderSuccess}
              renderTextLayer={false}
              renderAnnotationLayer={false}
            />
          </Document>
          {pdfReady && annotationOverlay(containerSize.width, containerSize.height)}
          {pdfReady && (
            <div className="flex items-center justify-between mt-2">
              <div className="flex items-center gap-2">
                {isFixed ? (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                    <CheckCircle className="w-3.5 h-3.5" /> Issue resolved — annotation updated
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs text-red-400">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {coords.confidence === 'high' ? 'Error located at grid reference' :
                     coords.confidence === 'medium' ? 'Error location estimated from zone' :
                     'Error highlighted (approximate location)'}
                  </span>
                )}
              </div>
              <button className="btn-ghost text-xs" onClick={(e) => { e.stopPropagation(); setShowZoom(!showZoom); }}>
                <ZoomIn className="w-3.5 h-3.5" />
                {showZoom ? 'Collapse' : 'Expand'}
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          <img
            ref={imageRef}
            src={fileUrl}
            alt="Drawing"
            className="hidden"
            crossOrigin="anonymous"
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageLoaded(false)}
          />
          {!imageLoaded ? (
            <div className="p-8 text-center">
              <Loader2 className="w-6 h-6 text-surface-400 mx-auto animate-spin" />
              <p className="text-surface-500 text-xs mt-2">Loading drawing...</p>
            </div>
          ) : (
            <>
              <div className="relative w-full" style={{ maxHeight: '300px' }}>
                <img
                  src={fileUrl}
                  alt="Drawing"
                  className="w-full rounded-xl border border-surface-700 cursor-pointer"
                  style={{ maxHeight: '300px', objectFit: 'contain' }}
                  onClick={() => setShowZoom(!showZoom)}
                  crossOrigin="anonymous"
                />
                {annotationOverlay(containerSize.width, containerSize.height)}
              </div>
              <div className="flex items-center justify-between mt-2">
                <div className="flex items-center gap-2">
                  {isFixed ? (
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                      <CheckCircle className="w-3.5 h-3.5" /> Issue resolved — annotation updated
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-red-400">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {coords.confidence === 'high' ? 'Error located at grid reference' :
                       coords.confidence === 'medium' ? 'Error location estimated from zone' :
                       'Error highlighted (approximate location)'}
                    </span>
                  )}
                </div>
                <button className="btn-ghost text-xs" onClick={() => setShowZoom(!showZoom)}>
                  <ZoomIn className="w-3.5 h-3.5" />
                  {showZoom ? 'Collapse' : 'Expand'}
                </button>
              </div>
            </>
          )}
        </>
      )}

      {/* Expanded zoom overlay */}
      {showZoom && (pdfReady || imageLoaded) && (
        <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-8" onClick={() => setShowZoom(false)}>
          <div className="relative max-w-5xl max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            {isPdf ? (
              <div className="relative" ref={(el) => {
                if (!el) return;
                setTimeout(() => {
                  const pdfC = el.querySelector('.react-pdf__Page__canvas');
                  if (pdfC) {
                    setContainerSize({ width: pdfC.offsetWidth, height: pdfC.offsetHeight });
                  }
                }, 200);
              }}>
                <Document file={fileUrl}>
                  <Page pageNumber={1} width={1200} renderTextLayer={false} renderAnnotationLayer={false} />
                </Document>
                {annotationOverlay(1200, 900)}
              </div>
            ) : (
              <div className="relative">
                <img
                  src={fileUrl}
                  alt="Drawing Zoomed"
                  className="rounded-xl border border-surface-700"
                  crossOrigin="anonymous"
                />
                {annotationOverlay(containerSize.width, containerSize.height)}
              </div>
            )}
            <button
              className="absolute top-2 right-2 p-2 rounded-full bg-surface-900/80 text-white hover:bg-surface-800"
              onClick={() => setShowZoom(false)}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
