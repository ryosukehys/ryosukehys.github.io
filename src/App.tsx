import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Search, Map as MapIcon, List, X, Heart, Check, Settings, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { boothData, sakeData, AppBrewery, AppSake } from './data';

// --- Types ---
type Tag = '限定' | '有料' | '無料' | '新酒';

interface MyListState {
  want: Set<string>;
  went: Set<string>;
  favorites: Set<string>; // "boothNum:sakeName" keys
  memos: Record<string, string>; // "boothNum:sakeName" -> memo text
}

interface Filters {
  limited: boolean;
  paid: boolean;
  rice: string[];
  type: string[];
}

// --- Utilities ---
const normalizeBooth = (val: string | number | null | undefined): string => {
  if (val === null || val === undefined) return '';
  const str = String(val).trim();
  const halfWidth = str.replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
  const num = parseInt(halfWidth, 10);
  return isNaN(num) ? halfWidth : String(num);
};

const formatBreweryLabel = (name: string, isPlaceholder: boolean) => {
  const source = isPlaceholder && name.includes('洗浄') ? '洗浄' : name;
  const chars = Array.from(source).slice(0, 4);
  const line1 = (chars.slice(0, 2).join('') || '').padEnd(2, '\u3000');
  const line2 = (chars.slice(2, 4).join('') || '').padEnd(2, '\u3000');
  return { line1, line2 };
};

// --- Components ---

function MapView({ myList, toggleMyList, toggleFavorite, resetToken, openBoothNumber, onOpenBoothHandled }: { myList: MyListState; toggleMyList: (boothNum: string, list: 'want' | 'went') => void; toggleFavorite: (sakeKey: string) => void; resetToken: number; openBoothNumber: string | null; onOpenBoothHandled: () => void }) {
  const [selectedBrewery, setSelectedBrewery] = useState<AppBrewery | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [mapScale, setMapScale] = useState(1);
  const [mapOffset, setMapOffset] = useState({ x: 0, y: 0 });
  const mapViewportRef = useRef<HTMLDivElement | null>(null);
  const mapGestureRef = useRef<{
    mode: 'pan' | 'pinch';
    startX: number;
    startY: number;
    startOffsetX: number;
    startOffsetY: number;
    startDistance: number;
    startScale: number;
    anchorX: number;
    anchorY: number;
  } | null>(null);
  const suppressTapRef = useRef(false);

  const [filters, setFilters] = useState<Filters>({
    limited: false,
    paid: false,
    rice: [],
    type: []
  });

  const riceOptions = ['越淡麗', '山田錦', '雄町', '五百万石', '高嶺錦', '愛山', 'コシヒカリ', '美山錦', '新之助', '亀の尾', '春陽'];
  const typeOptions = ['純大', '純吟', '純米', '大吟', '吟醸', '本醸', '普通', '原酒', '生酒', '無濾過', 'リキュール', '非公開', 'にごり', '梅酒', '発泡', 'その他', 'セット', '雑酒', 'みりん'];

  const toggleRice = (r: string) => {
    setFilters(prev => ({
      ...prev,
      rice: prev.rice.includes(r) ? prev.rice.filter(x => x !== r) : [...prev.rice, r]
    }));
  };

  const toggleType = (t: string) => {
    setFilters(prev => ({
      ...prev,
      type: prev.type.includes(t) ? prev.type.filter(x => x !== t) : [...prev.type, t]
    }));
  };

  const toggleLimited = () => setFilters(prev => ({ ...prev, limited: !prev.limited }));
  const togglePaid = () => setFilters(prev => ({ ...prev, paid: !prev.paid }));

  const isFilterActive = filters.limited || filters.paid || filters.rice.length > 0 || filters.type.length > 0 || searchQuery.trim() !== '';

  const isSakeMatching = (sake: { isLimited: boolean; isPaid: boolean; name: string; type: string }) => {
    if (filters.limited && !sake.isLimited) return false;
    if (filters.paid && !sake.isPaid) return false;

    if (filters.rice.length > 0) {
      const sakeName = sake.name || '';
      const hasRice = filters.rice.some(r => {
        if (r === '高嶺錦') return sakeName.includes('高嶺錦') || sakeName.includes('たかね錦');
        return sakeName.includes(r);
      });
      if (!hasRice) return false;
    }

    if (filters.type.length > 0) {
      const t = sake.type || '';
      const n = sake.name || '';
      const hasType = filters.type.some(typeFilter => {
        switch (typeFilter) {
          case '純大': return t.includes('純米大吟醸') || (n.includes('純米大吟醸') || n.includes('純米大吟'));
          case '純吟': return t.includes('純米吟醸') || (n.includes('純米吟醸') && !n.includes('純米大吟醸') && !n.includes('純米大吟'));
          case '純米': return (t.includes('純米') && !t.includes('大吟') && !t.includes('吟醸')) || (n.includes('純米') && !n.includes('純米吟醸') && !n.includes('純米大吟醸') && !n.includes('純米大吟'));
          case '大吟': return (t.includes('大吟醸') && !t.includes('純米')) || (n.includes('大吟醸') && !n.includes('純米大吟醸') && !n.includes('純米大吟'));
          case '吟醸': return (t.includes('吟醸') && !t.includes('純米') && !t.includes('大吟醸')) || (n.includes('吟醸') && !n.includes('純米吟醸') && !n.includes('純米大吟') && !n.includes('大吟醸'));
          case '本醸': return t.includes('本醸造') || t.includes('本醸') || n.includes('本醸造');
          case '普通': return t.includes('普通') || n.includes('普通酒');
          case '原酒': return t.includes('原酒') || n.includes('原酒');
          case '生酒': return t === '生酒' || n.includes('生酒');
          case '無濾過': return n.includes('無濾過');
          case '発泡': return t.includes('発泡') || n.includes('発泡') || n.includes('スパークリング');
          case 'にごり': return t.includes('にごり') || n.includes('にごり');
          case '梅酒': return t.includes('梅酒') || n.includes('梅酒');
          case 'リキュール': return t.includes('リキュール') || t.includes('酒カクテル');
          case 'その他': return t === 'その他' || t.includes('その他の醸造酒');
          case '雑酒': return t.includes('雑酒');
          case '非公開': return t.includes('非公開');
          case 'みりん': return t.includes('みりん');
          case 'セット': return t.includes('セット');
          default: return false;
        }
      });
      if (!hasType) return false;
    }

    return true;
  };

  const isSearchMatching = (sake: typeof sakeData[number]) => {
    const q = searchQuery.trim();
    if (!q) return true;
    const terms = q.split(/\s+/);
    const haystack = [
      sake.company_name || '',
      sake.isPaid ? '有料' : '無料',
      sake.category || '',
      sake.type || '',
      sake.name || '',
    ].join(' ');
    return terms.every(term => haystack.includes(term));
  };

  const isBoothMatching = (boothNum: string) => {
    if (!isFilterActive) return true;

    const targetBoothNum = normalizeBooth(boothNum);
    const sakes = sakeData.filter(s => normalizeBooth(s.booth_number) === targetBoothNum);

    if (sakes.length === 0) return false;

    return sakes.some(sake => isSakeMatching(sake) && isSearchMatching(sake));
  };

  // Group booths by row and col to create the grid
  const gridRows = 6;
  const gridCols = 14;
  
  const grid = Array.from({ length: gridRows }, () => Array(gridCols).fill(null));
  
  boothData.forEach(booth => {
    if (booth.row <= gridRows && booth.col <= gridCols) {
      // row 1 = bottom, col 1 = right end
      grid[gridRows - booth.row][gridCols - booth.col] = booth;
    }
  });

  const clampScale = useCallback((value: number) => Math.min(3, Math.max(1, value)), []);
  const clampOffset = useCallback((offset: { x: number; y: number }, scale: number) => {
    const viewport = mapViewportRef.current;
    if (!viewport || scale <= 1) return { x: 0, y: 0 };
    const minX = viewport.clientWidth * (1 - scale);
    const minY = viewport.clientHeight * (1 - scale);
    return {
      x: Math.max(minX, Math.min(0, offset.x)),
      y: Math.max(minY, Math.min(0, offset.y)),
    };
  }, []);

  const resetMapZoom = useCallback(() => {
    setMapScale(1);
    setMapOffset({ x: 0, y: 0 });
    mapGestureRef.current = null;
    suppressTapRef.current = false;
  }, []);

  useEffect(() => {
    if (selectedBrewery) resetMapZoom();
  }, [selectedBrewery, resetMapZoom]);

  useEffect(() => {
    resetMapZoom();
  }, [resetToken, resetMapZoom]);

  useEffect(() => {
    if (!openBoothNumber) return;
    const targetNum = normalizeBooth(openBoothNumber);
    const booth = boothData.find(b => normalizeBooth(b.booth_number) === targetNum);
    if (booth) {
      handleBoothClick(booth);
    }
    onOpenBoothHandled();
  }, [openBoothNumber]);

  const getDistance = (touches: React.TouchList) => {
    if (touches.length < 2) return 0;
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  };
  const getCenter = (touches: React.TouchList) => {
    if (touches.length < 2) return { x: 0, y: 0 };
    return {
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2,
    };
  };

  const handleMapTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length >= 2) {
      const rect = mapViewportRef.current?.getBoundingClientRect();
      const center = getCenter(e.touches);
      const localX = center.x - (rect?.left ?? 0);
      const localY = center.y - (rect?.top ?? 0);
      mapGestureRef.current = {
        mode: 'pinch',
        startX: 0,
        startY: 0,
        startOffsetX: mapOffset.x,
        startOffsetY: mapOffset.y,
        startDistance: getDistance(e.touches),
        startScale: mapScale,
        anchorX: (localX - mapOffset.x) / mapScale,
        anchorY: (localY - mapOffset.y) / mapScale,
      };
      return;
    }
    if (e.touches.length === 1 && mapScale > 1.01) {
      mapGestureRef.current = {
        mode: 'pan',
        startX: e.touches[0].clientX,
        startY: e.touches[0].clientY,
        startOffsetX: mapOffset.x,
        startOffsetY: mapOffset.y,
        startDistance: 0,
        startScale: mapScale,
        anchorX: 0,
        anchorY: 0,
      };
    }
  };

  const handleMapTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    const gesture = mapGestureRef.current;
    if (!gesture) return;

    if (gesture.mode === 'pinch' && e.touches.length >= 2) {
      const distance = getDistance(e.touches);
      if (distance <= 0 || gesture.startDistance <= 0) return;
      e.preventDefault();
      suppressTapRef.current = true;
      const rect = mapViewportRef.current?.getBoundingClientRect();
      const center = getCenter(e.touches);
      const localX = center.x - (rect?.left ?? 0);
      const localY = center.y - (rect?.top ?? 0);
      const nextScale = clampScale(gesture.startScale * (distance / gesture.startDistance));
      const nextOffset = clampOffset(
        {
          x: localX - gesture.anchorX * nextScale,
          y: localY - gesture.anchorY * nextScale,
        },
        nextScale
      );
      setMapScale(nextScale);
      setMapOffset(nextOffset);
      return;
    }

    if (gesture.mode === 'pan' && e.touches.length === 1) {
      const dx = e.touches[0].clientX - gesture.startX;
      const dy = e.touches[0].clientY - gesture.startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
        e.preventDefault();
        suppressTapRef.current = true;
      }
      setMapOffset(clampOffset({ x: gesture.startOffsetX + dx, y: gesture.startOffsetY + dy }, mapScale));
    }
  };

  const handleMapTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length >= 2) {
      const rect = mapViewportRef.current?.getBoundingClientRect();
      const center = getCenter(e.touches);
      const localX = center.x - (rect?.left ?? 0);
      const localY = center.y - (rect?.top ?? 0);
      mapGestureRef.current = {
        mode: 'pinch',
        startX: 0,
        startY: 0,
        startOffsetX: mapOffset.x,
        startOffsetY: mapOffset.y,
        startDistance: getDistance(e.touches),
        startScale: mapScale,
        anchorX: (localX - mapOffset.x) / mapScale,
        anchorY: (localY - mapOffset.y) / mapScale,
      };
      return;
    }
    if (e.touches.length === 1 && mapScale > 1.01) {
      mapGestureRef.current = {
        mode: 'pan',
        startX: e.touches[0].clientX,
        startY: e.touches[0].clientY,
        startOffsetX: mapOffset.x,
        startOffsetY: mapOffset.y,
        startDistance: 0,
        startScale: mapScale,
        anchorX: 0,
        anchorY: 0,
      };
      return;
    }
    mapGestureRef.current = null;
    window.setTimeout(() => {
      suppressTapRef.current = false;
    }, 80);
  };

  const handleBoothClick = (booth: typeof boothData[number]) => {
    if (booth.booth_number === '-') return;

    const targetBoothNum = normalizeBooth(booth.booth_number);

    // Find sakes for this brewery
    const sakesForBrewery = sakeData.filter(s => normalizeBooth(s.booth_number) === targetBoothNum);

    const brewery: AppBrewery = {
      id: String(booth.booth_number),
      boothNumber: String(booth.booth_number),
      name: booth.brewery_name || '',
      region: booth.area || '',
      color: booth.color_code || '#cccccc',
      sakes: sakesForBrewery.map((s, index) => {
        const typeStr = s.type || '';
        return {
          id: `${s.name || 'sake'}-${index}`,
          name: s.name || '不明な銘柄',
          shortType: typeStr.substring(0, 3),
          typeColor: typeStr.includes('大吟醸') ? 'bg-slate-800' : typeStr.includes('吟醸') ? 'bg-amber-700' : 'bg-stone-500',
          tags: [
            ...(s.isLimited ? ['限定'] : []),
            ...(s.isPaid ? ['有料'] : [])
          ] as ('限定' | '有料')[],
          rawType: typeStr,
          rawIsLimited: s.isLimited,
          rawIsPaid: s.isPaid,
          rawCompany: s.company_name || '',
          rawCategory: s.category || '',
        };
      })
    };
    
    setSelectedBrewery(brewery);
  };

  return (
    <div
      className="flex flex-col h-full text-gray-800 overflow-hidden relative"
      style={{ backgroundColor: '#EEEBEA' }}
    >
      {/* Header */}
      <div className="pt-3 pb-2 px-4 text-center">
        <h1 className="text-base font-bold font-serif tracking-wider text-gray-700 flex items-center justify-center gap-2">
          <svg width="24" height="24" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
            <circle cx="50" cy="50" r="45" fill="#152F83" />
            <circle cx="50" cy="50" r="30" fill="white" />
            <circle cx="50" cy="50" r="22" fill="#152F83" />
            <circle cx="50" cy="50" r="10" fill="white" />
          </svg>
          にいがた酒の陣 2026 出品酒マップ
        </h1>
      </div>

      {/* Search */}
      <div className="px-4 mb-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="全文検索（スペースでAND検索できます）"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white text-gray-800 rounded-full py-2 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-amber-400 placeholder-gray-400 border border-gray-200/80 shadow-sm"
          />
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-0.5 px-4 pb-3">
        {/* Row 1: Limited & Paid */}
        <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-0 items-center">
          <button
            onClick={() => setFilters(prev => ({ ...prev, limited: false, paid: false }))}
            className={`shrink-0 w-5 h-5 flex items-center justify-center rounded-full transition-opacity ${filters.limited || filters.paid ? 'opacity-80' : 'opacity-20 pointer-events-none'}`}
          >
            <X className="w-3.5 h-3.5 text-gray-500" />
          </button>
          <button
            onClick={toggleLimited}
            className={`whitespace-nowrap text-xs px-3 py-1.5 rounded-full font-medium transition-colors border ${
              filters.limited ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-600 border-gray-200 shadow-sm'
            }`}
          >
            限定酒
          </button>
          <button
            onClick={togglePaid}
            className={`whitespace-nowrap text-xs px-3 py-1.5 rounded-full font-medium transition-colors border ${
              filters.paid ? 'bg-orange-600 text-white border-orange-600' : 'bg-white text-gray-600 border-gray-200 shadow-sm'
            }`}
          >
            有料試飲
          </button>
        </div>

        {/* Row 2: Type */}
        <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-0 items-center">
          <button
            onClick={() => setFilters(prev => ({ ...prev, type: [] }))}
            className={`shrink-0 w-5 h-5 flex items-center justify-center rounded-full transition-opacity ${filters.type.length > 0 ? 'opacity-80' : 'opacity-20 pointer-events-none'}`}
          >
            <X className="w-3.5 h-3.5 text-gray-500" />
          </button>
          {typeOptions.map(t => (
            <button
              key={t}
              onClick={() => toggleType(t)}
              className={`whitespace-nowrap text-xs px-3 py-1.5 rounded-full font-medium transition-colors border ${
                filters.type.includes(t) ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-200 shadow-sm'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Row 3: Rice */}
        <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-0 items-center">
          <button
            onClick={() => setFilters(prev => ({ ...prev, rice: [] }))}
            className={`shrink-0 w-5 h-5 flex items-center justify-center rounded-full transition-opacity ${filters.rice.length > 0 ? 'opacity-80' : 'opacity-20 pointer-events-none'}`}
          >
            <X className="w-3.5 h-3.5 text-gray-500" />
          </button>
          {riceOptions.map(r => (
            <button
              key={r}
              onClick={() => toggleRice(r)}
              className={`whitespace-nowrap text-xs px-3 py-1.5 rounded-full font-medium transition-colors border ${
                filters.rice.includes(r) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 shadow-sm'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* Grid (fixed viewport) */}
      <div className="px-2">
        <div
          ref={mapViewportRef}
          className="overflow-hidden rounded-xl border border-gray-200/80 bg-white/30 h-[41vh] min-h-[250px] max-h-[390px]"
          onTouchStart={handleMapTouchStart}
          onTouchMove={handleMapTouchMove}
          onTouchEnd={handleMapTouchEnd}
          onTouchCancel={handleMapTouchEnd}
        >
          <div
            className="flex flex-col p-1"
            style={{
              transform: `translate3d(${mapOffset.x}px, ${mapOffset.y}px, 0) scale(${mapScale})`,
              transformOrigin: 'top left',
              transition: mapGestureRef.current ? 'none' : 'transform 120ms ease-out',
            }}
          >
          {grid.map((row, rowIndex) => (
            <div key={rowIndex}>
              {/* Horizontal pathway line between 2×2 blocks (after row 1, 3) */}
              {rowIndex > 0 && rowIndex % 2 === 0 && (
                <div className="flex justify-center my-1">
                  <div className="w-[95%] border-t border-dashed border-gray-400/40" />
                </div>
              )}
              <div className="flex justify-center" style={{ gap: '2px', marginTop: rowIndex > 0 && rowIndex % 2 !== 0 ? '2px' : '0' }}>
                {row.map((cell, colIndex) => {
                  const verticalSep = colIndex > 0 && colIndex % 2 === 0 ? (
                    <div key={`sep-${rowIndex}-${colIndex}`} className="border-l border-dashed border-gray-400/40" style={{ marginLeft: '2px', marginRight: '2px' }} />
                  ) : null;

                  if (!cell) {
                    return (
                      <React.Fragment key={`${rowIndex}-${colIndex}`}>{verticalSep}<div className="aspect-square" style={{ width: '6%', minWidth: 0 }} /></React.Fragment>
                    );
                  }

                  const isPlaceholder = cell.booth_number === '-';
                  const isMatched = !isPlaceholder && isBoothMatching(cell.booth_number);
                  const opacityClass = isFilterActive && !isPlaceholder && !isMatched ? 'opacity-20' : 'opacity-100';
                  const boothLabel = formatBreweryLabel(cell.brewery_name, isPlaceholder);

                  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
                  let isLongPress = false;
                  let touchStartPoint: { x: number; y: number } | null = null;
                  const clearLongPressTimer = () => {
                    if (longPressTimer) {
                      clearTimeout(longPressTimer);
                      longPressTimer = null;
                    }
                  };
                  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
                    if (isPlaceholder) return;
                    const touch = e.touches[0];
                    touchStartPoint = { x: touch.clientX, y: touch.clientY };
                    isLongPress = false;
                    clearLongPressTimer();
                    longPressTimer = setTimeout(() => {
                      isLongPress = true;
                      toggleMyList(String(cell.booth_number), 'want');
                    }, 500);
                  };
                  const handleTouchEnd = () => {
                    clearLongPressTimer();
                    touchStartPoint = null;
                  };
                  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
                    if (!touchStartPoint) return;
                    const touch = e.touches[0];
                    const moved = Math.hypot(touch.clientX - touchStartPoint.x, touch.clientY - touchStartPoint.y);
                    if (moved > 8) {
                      clearLongPressTimer();
                    }
                  };
                  const handleClick = () => {
                    if (suppressTapRef.current) return;
                    if (isLongPress) { isLongPress = false; return; }
                    handleBoothClick(cell);
                  };
                  const handleMouseStart = () => {
                    if (isPlaceholder) return;
                    isLongPress = false;
                    clearLongPressTimer();
                    longPressTimer = setTimeout(() => {
                      isLongPress = true;
                      toggleMyList(String(cell.booth_number), 'want');
                    }, 500);
                  };

                  return (
                    <React.Fragment key={`${rowIndex}-${colIndex}`}>{verticalSep}<div
                      className={`flex flex-col items-center ${!isPlaceholder ? 'cursor-pointer' : ''} ${opacityClass} transition-opacity duration-300 select-none`}
                      style={{ width: '6%', minWidth: 0 }}
                      onClick={handleClick}
                      onTouchStart={handleTouchStart}
                      onTouchEnd={handleTouchEnd}
                      onTouchMove={handleTouchMove}
                      onMouseDown={handleMouseStart}
                      onMouseUp={handleTouchEnd}
                      onMouseLeave={handleTouchEnd}
                    >
                      {rowIndex % 2 === 0 && (
                        <span className="text-[10px] mb-0.5 text-center leading-tight truncate w-full text-gray-500 font-bold">
                          {!isPlaceholder ? cell.booth_number : '\u00A0'}
                        </span>
                      )}
                      <div
                        className={`w-full aspect-square relative flex items-center justify-center rounded font-bold overflow-hidden p-px ${isPlaceholder ? 'bg-gray-200/60 text-gray-400' : 'text-gray-900'}`}
                        style={!isPlaceholder ? { backgroundColor: cell.color_code, boxShadow: '0 0 3px 1px rgba(0,0,0,0.2)' } : undefined}
                      >
                        {!isPlaceholder && myList.want.has(String(cell.booth_number)) && (
                          <Heart className="absolute top-0 left-0 w-[40%] h-[40%] text-pink-500 fill-pink-500 drop-shadow-sm" />
                        )}
                        {!isPlaceholder && myList.went.has(String(cell.booth_number)) && (
                          <span className={`absolute top-0 flex items-center justify-center w-[40%] h-[40%] bg-emerald-500 rounded-full drop-shadow-sm ${myList.want.has(String(cell.booth_number)) ? 'right-0' : 'left-0'}`}>
                            <Check className="w-[70%] h-[70%] text-white" strokeWidth={3} />
                          </span>
                        )}
                        <span className="text-center leading-[0.92] whitespace-nowrap inline-block" style={{ fontSize: 'clamp(7.6px, 2.66vw, 12.35px)' }}>
                          {boothLabel.line1}
                          <br />
                          {boothLabel.line2}
                        </span>
                      </div>
                      {rowIndex % 2 === 1 && (
                        <span className="text-[10px] mt-0.5 text-center leading-tight truncate w-full text-gray-500 font-bold">
                          {!isPlaceholder ? cell.booth_number : '\u00A0'}
                        </span>
                      )}
                    </div></React.Fragment>
                  );
                })}
              </div>
            </div>
          ))}
          </div>
        </div>
      </div>

      {/* Legend (scrollable) */}
      <div className="flex-1 overflow-y-auto px-2 pb-24 mt-3">
        {/* Area Legend */}
        <div className="flex justify-center gap-4 mb-1 px-4">
          {[
            { area: '上越', color: '#d3dbe3' },
            { area: '中越', color: '#d4e4c9' },
            { area: '下越', color: '#f0ced9' },
            { area: '佐渡', color: '#d9c876' },
          ].map(({ area, color }) => (
            <div key={area} className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: color, boxShadow: '0 0 2px rgba(0,0,0,0.15)' }} />
              <span className="text-[11px] text-gray-500 font-medium">{area}</span>
            </div>
          ))}
        </div>
        <p className="text-center text-[11px] text-gray-500 mt-2 mb-1">
          制作: 徒然研究室 Tsurezure Lab
        </p>

      </div>

      {/* Bottom Sheet */}
      <AnimatePresence>
        {selectedBrewery && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black z-10"
              onClick={() => setSelectedBrewery(null)}
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              drag="y"
              dragConstraints={{ top: 0 }}
              dragElastic={0.2}
              onDragEnd={(_e, info) => { if (info.offset.y > 100 || info.velocity.y > 300) setSelectedBrewery(null); }}
              className="absolute bottom-0 left-0 right-0 bg-white text-gray-800 rounded-t-3xl z-20 max-h-[80vh] flex flex-col shadow-2xl"
            >
              <div className="w-12 h-1.5 bg-gray-300 rounded-full mx-auto mt-3 mb-4 cursor-grab active:cursor-grabbing" />
              
              <div className="px-5 pb-4 border-b border-gray-200">
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg shadow-sm"
                    style={{ backgroundColor: selectedBrewery.color }}
                  >
                    {selectedBrewery.boothNumber}
                  </div>
                  <h2 className="text-xl font-bold flex-1">{selectedBrewery.name} <span className="text-gray-500 font-normal text-lg">| {selectedBrewery.region}</span></h2>
                </div>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => toggleMyList(selectedBrewery.boothNumber, 'want')}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-colors border ${
                      myList.want.has(selectedBrewery.boothNumber)
                        ? 'bg-pink-50 text-pink-600 border-pink-300'
                        : 'bg-gray-50 text-gray-500 border-gray-200'
                    }`}
                  >
                    <Heart className={`w-4 h-4 ${myList.want.has(selectedBrewery.boothNumber) ? 'fill-pink-600' : ''}`} />
                    行きたい！
                  </button>
                  <button
                    onClick={() => toggleMyList(selectedBrewery.boothNumber, 'went')}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-colors border ${
                      myList.went.has(selectedBrewery.boothNumber)
                        ? 'bg-emerald-50 text-emerald-600 border-emerald-300'
                        : 'bg-gray-50 text-gray-500 border-gray-200'
                    }`}
                  >
                    {myList.went.has(selectedBrewery.boothNumber)
                      ? <span className="w-4 h-4 bg-emerald-600 rounded-full flex items-center justify-center"><Check className="w-3 h-3 text-white" strokeWidth={3} /></span>
                      : <span className="w-4 h-4 border-2 border-gray-300 rounded-full" />
                    }
                    行った！
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-4">
                <div className="space-y-3">
                  {selectedBrewery.sakes.length > 0 ? (
                    selectedBrewery.sakes.map((sake) => {
                      const sakeForMatch = { isLimited: sake.rawIsLimited, isPaid: sake.rawIsPaid, name: sake.name, type: sake.rawType, company_name: sake.rawCompany, category: sake.rawCategory } as typeof sakeData[number];
                      const highlighted = isFilterActive && isSakeMatching(sakeForMatch) && isSearchMatching(sakeForMatch);
                      return (
                      <div key={sake.id} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors ${highlighted ? 'bg-amber-100 ring-1 ring-amber-300' : ''} ${isFilterActive && !highlighted ? 'opacity-40' : ''}`}>
                        {sake.shortType ? (
                          <span className={`text-[10px] text-white px-2 py-1 rounded-full whitespace-nowrap min-w-[50px] text-center ${sake.typeColor}`}>
                            {sake.shortType}
                          </span>
                        ) : (
                          <span className="min-w-[50px]"></span>
                        )}
                        <div className="flex-1 leading-snug min-w-0">
                          <span className="font-medium text-sm">{sake.name}</span>
                        </div>
                        <div className="flex gap-1 shrink-0 items-center">
                          {sake.tags.map(tag => (
                            <span key={tag} className={`text-[10px] text-white px-1.5 py-0.5 rounded ${tag === '限定' ? 'bg-purple-600' : 'bg-orange-600'}`}>
                              {tag}
                            </span>
                          ))}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const key = `${selectedBrewery.boothNumber}:${sake.name}`;
                              const isAdding = !myList.favorites.has(key);
                              toggleFavorite(key);
                              if (isAdding && !myList.went.has(selectedBrewery.boothNumber)) {
                                toggleMyList(selectedBrewery.boothNumber, 'went');
                              }
                            }}
                            className="p-0.5"
                          >
                            <Check className={`w-4 h-4 transition-colors ${myList.favorites.has(`${selectedBrewery.boothNumber}:${sake.name}`) ? 'text-emerald-500' : 'text-gray-300'}`} />
                          </button>
                        </div>
                      </div>
                      );
                    })
                  ) : (
                    <div className="text-center text-gray-500 py-4">出品酒データがありません</div>
                  )}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function MyListView({ myList, toggleMyList, onBreweryTap }: { myList: MyListState; toggleMyList: (boothNum: string, list: 'want' | 'went') => void; onBreweryTap: (boothNum: string) => void }) {
  const [activeTab, setActiveTab] = useState<'want' | 'went'>('want');

  const myListData = useMemo(() => {
    const boothNums = activeTab === 'want' ? Array.from(myList.want) : Array.from(myList.went);
    return boothNums.map(boothNum => {
      const targetBoothNum = normalizeBooth(boothNum);
      const boothInfo = boothData.find(b => normalizeBooth(b.booth_number) === targetBoothNum);
      if (!boothInfo) return null;
      const sakes = sakeData.filter(s => normalizeBooth(s.booth_number) === targetBoothNum);
      return {
        id: `m-${boothNum}`,
        boothNumber: String(boothInfo.booth_number),
        name: boothInfo.brewery_name || '',
        region: boothInfo.area || '',
        color: boothInfo.color_code || '#cccccc',
        sakes: sakes.map(s => ({
          name: s.name || '不明な銘柄',
          tags: [
            ...(s.isLimited ? ['限定'] : []),
            ...(s.isPaid ? ['有料'] : [])
          ] as Tag[]
        }))
      };
    }).filter((x): x is NonNullable<typeof x> => x !== null);
  }, [activeTab, myList]);

  return (
    <div className="flex flex-col h-full text-gray-800 overflow-hidden" style={{ backgroundColor: '#EEEBEA' }}>
      <div className="pt-12 pb-4 px-4 text-center">
        <h1 className="text-xl font-bold text-gray-700">行きたい！/行った！</h1>
      </div>

      <div className="px-4 mb-4">
        <div className="flex bg-gray-200/70 rounded-lg p-1">
          <button
            className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${activeTab === 'want' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'}`}
            onClick={() => setActiveTab('want')}
          >
            行きたい！{myList.want.size > 0 && <span className="ml-1 text-xs text-pink-500">({myList.want.size})</span>}
          </button>
          <button
            className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${activeTab === 'went' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'}`}
            onClick={() => setActiveTab('went')}
          >
            行った！{myList.went.size > 0 && <span className="ml-1 text-xs text-emerald-500">({myList.went.size})</span>}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-24 space-y-4">
        {myListData.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <span className="text-4xl mb-3">{activeTab === 'want' ? '🍶' : '✅'}</span>
            <p className="text-sm">マップから酒蔵を{activeTab === 'want' ? '「行きたい！」に' : '「行った！」に'}追加しよう</p>
          </div>
        ) : (
          myListData.map((item) => (
            <div key={item.id} className={`rounded-xl p-4 shadow-sm border border-gray-200/60 cursor-pointer active:bg-gray-50 transition-opacity ${activeTab === 'want' && myList.went.has(item.boothNumber) ? 'bg-gray-100 text-gray-400 opacity-60' : 'bg-white text-gray-800'}`} onClick={() => onBreweryTap(item.boothNumber)}>
              <div className="flex items-center gap-3 mb-3">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg shadow-sm shrink-0"
                  style={{ backgroundColor: item.color }}
                >
                  {item.boothNumber}
                </div>
                <div className="flex-1 min-w-0">
                  <span className="font-bold text-sm">{item.name}</span>
                  <span className="text-xs text-gray-500 ml-2">{item.region}</span>
                </div>
                {activeTab === 'want' && (
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleMyList(item.boothNumber, 'went'); }}
                    className={`shrink-0 p-1.5 rounded-full transition-colors ${myList.went.has(item.boothNumber) ? 'bg-emerald-100' : 'hover:bg-gray-100'}`}
                    title="行った！"
                  >
                    <Check className={`w-4 h-4 ${myList.went.has(item.boothNumber) ? 'text-emerald-600' : 'text-gray-400'}`} />
                  </button>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); toggleMyList(item.boothNumber, activeTab); }}
                  className="shrink-0 p-1.5 rounded-full hover:bg-gray-100 transition-colors"
                >
                  <X className="w-4 h-4 text-gray-400" />
                </button>
              </div>
              <div className="space-y-1.5 pl-[52px]">
                {item.sakes.map((sake, i) => (
                  <div key={i} className="flex justify-between items-start gap-2">
                    <span className="text-sm leading-tight font-medium">{sake.name}</span>
                    <div className="flex gap-1 shrink-0">
                      {sake.tags.map(tag => (
                        <span key={tag} className={`text-[10px] text-white px-1.5 py-0.5 rounded ${tag === '限定' ? 'bg-purple-600' : 'bg-orange-600'}`}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function FavoritesView({ myList, toggleFavorite, updateMemo }: { myList: MyListState; toggleFavorite: (sakeKey: string) => void; updateMemo: (sakeKey: string, text: string) => void }) {
  const favoriteItems = useMemo(() => {
    return Array.from(myList.favorites).map(key => {
      const [boothNum, ...nameParts] = key.split(':');
      const sakeName = nameParts.join(':');
      const boothInfo = boothData.find(b => normalizeBooth(b.booth_number) === normalizeBooth(boothNum));
      const sakeInfo = sakeData.find(s => normalizeBooth(s.booth_number) === normalizeBooth(boothNum) && s.name === sakeName);
      return { key, boothNum, sakeName, boothInfo, sakeInfo };
    }).filter(item => item.boothInfo);
  }, [myList.favorites]);

  return (
    <div className="flex flex-col h-full text-gray-800 overflow-hidden" style={{ backgroundColor: '#EEEBEA' }}>
      <div className="pt-12 pb-4 px-4 text-center">
        <h1 className="text-xl font-bold text-gray-700">飲んだ！</h1>
        {favoriteItems.length > 0 && <p className="text-xs text-gray-400 mt-1">{favoriteItems.length}銘柄</p>}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-24 space-y-3">
        {favoriteItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <span className="text-4xl mb-3">☑️</span>
            <p className="text-sm">マップで銘柄のハートをタップして追加しよう</p>
          </div>
        ) : (
          favoriteItems.map(item => {
            const typeStr = item.sakeInfo?.type || '';
            const shortType = typeStr.substring(0, 3);
            const typeColor = typeStr.includes('大吟醸') ? 'bg-slate-800' : typeStr.includes('吟醸') ? 'bg-amber-700' : 'bg-stone-500';
            return (
              <div key={item.key} className="bg-white rounded-xl px-4 py-3 shadow-sm border border-gray-200/60">
                <div className="flex items-center gap-2">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm shrink-0"
                    style={{ backgroundColor: item.boothInfo?.color_code || '#ccc' }}
                  >
                    {item.boothNum}
                  </div>
                  <span className="text-xs text-gray-500 font-medium">{item.boothInfo?.brewery_name}</span>
                  <span className="text-xs text-gray-400">{item.boothInfo?.area}</span>
                  <div className="flex-1" />
                  <button onClick={() => toggleFavorite(item.key)} className="p-1">
                    <Check className="w-4 h-4 text-emerald-500" />
                  </button>
                </div>
                <div className="flex items-center gap-2 mt-2 pl-10">
                  {shortType && (
                    <span className={`text-[10px] text-white px-2 py-0.5 rounded-full whitespace-nowrap ${typeColor}`}>
                      {shortType}
                    </span>
                  )}
                  <span className="font-medium text-sm">{item.sakeName}</span>
                  <div className="flex gap-1 ml-auto shrink-0">
                    {item.sakeInfo?.isLimited && <span className="text-[10px] text-white px-1.5 py-0.5 rounded bg-purple-600">限定</span>}
                    {item.sakeInfo?.isPaid && <span className="text-[10px] text-white px-1.5 py-0.5 rounded bg-orange-600">有料</span>}
                  </div>
                </div>
                <div className="mt-2 pl-10">
                  <textarea
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-700 resize-none focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 placeholder-gray-300"
                    placeholder="ひとくちメモ…"
                    rows={2}
                    defaultValue={myList.memos[item.key] || ''}
                    onBlur={(e) => updateMemo(item.key, e.target.value)}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function SettingsView({ myList, clearMyList }: { myList: MyListState; clearMyList: (target: 'want' | 'went' | 'favorites') => void }) {
  const [confirmTarget, setConfirmTarget] = useState<'want' | 'went' | 'favorites' | null>(null);

  const items: { key: 'want' | 'went' | 'favorites'; label: string; icon: string; count: number }[] = [
    { key: 'want', label: '行きたい！', icon: '🍶', count: myList.want.size },
    { key: 'went', label: '行った！', icon: '✅', count: myList.went.size },
    { key: 'favorites', label: '飲んだ！', icon: '☑️', count: myList.favorites.size },
  ];

  return (
    <div className="flex flex-col h-full text-gray-800 overflow-hidden" style={{ backgroundColor: '#EEEBEA' }}>
      <div className="pt-12 pb-4 px-4 text-center">
        <h1 className="text-xl font-bold text-gray-700">説明/管理</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-24 space-y-3">
        <div className="px-4 py-4 bg-white/70 rounded-xl text-gray-500 text-[11px] leading-relaxed space-y-3 border border-gray-200/60">
          <div>
            <p className="font-bold text-gray-600 text-xs mb-1">📖 使い方</p>
            <ul className="space-y-0.5 list-disc list-inside">
              <li>まず「マップ」タブで会場全体を見て、気になるブースを探します。</li>
              <li>ブースをタップすると、その蔵の出品酒リストが下から表示されます。</li>
              <li>ブースを長押しすると、その蔵を「行きたい！」に追加できます。</li>
              <li>出品酒リストのチェックを押すと「飲んだ！」に追加されます。</li>
              <li>下のタブ「行きたい！/行った！」で、訪問したい蔵・訪問済みの蔵を確認できます。</li>
              <li>下のタブ「飲んだ！」では、追加した銘柄の確認とメモ記録ができます。</li>
              <li>上部のフィルタ（限定酒・有料試飲・種類・酒米）で候補を絞り込めます。</li>
              <li>検索欄はスペース区切りのAND検索です（例: 「純米 山田錦」）。</li>
              <li>Safariでうまく動作しないときはChromeで開いてみてください。</li>
            </ul>
          </div>
          <div className="border-t border-gray-200 pt-3">
            <p className="font-bold text-gray-600 text-xs mb-1">⚠️ ご注意</p>
            <p>本サイトは徒然研究室（X: <a href="https://x.com/tsurezure_lab" target="_blank" rel="noopener noreferrer" className="text-blue-500 underline">@tsurezure_lab</a>）が個人的に作成した非公式の出品酒マップです。にいがた酒の陣実行委員会とは一切関係ありません。掲載内容に誤りがある場合があります。正確な情報は公式サイト・会場配布資料をご確認ください。</p>
          </div>
          <div className="border-t border-gray-200 pt-3">
            <p className="font-bold text-gray-600 text-xs mb-1">🔒 プライバシー</p>
            <p>「行きたい！」「飲んだ！」等のデータは、お使いのブラウザ内（localStorage）にのみ保存されます。氏名・メールアドレスなどの個人情報は取得しません。改善目的で、設定が有効な場合のみ匿名アクセス解析（クッキーレス）を使用することがあります。</p>
          </div>
        </div>
        <p className="text-xs text-gray-500 px-1 mb-2">登録データのクリア</p>
        {items.map(item => (
          <div key={item.key} className="bg-white rounded-xl px-4 py-4 shadow-sm border border-gray-200/60">
            {confirmTarget === item.key ? (
              <div className="flex items-center justify-between">
                <span className="text-sm text-red-600 font-medium">「{item.label}」を全件クリアしますか？</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfirmTarget(null)}
                    className="px-3 py-1.5 text-xs rounded-lg border border-gray-300 text-gray-600"
                  >
                    戻る
                  </button>
                  <button
                    onClick={() => { clearMyList(item.key); setConfirmTarget(null); }}
                    className="px-3 py-1.5 text-xs rounded-lg bg-red-500 text-white"
                  >
                    クリア
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span>{item.icon}</span>
                  <span className="text-sm font-medium">{item.label}</span>
                  <span className="text-xs text-gray-400">({item.count}件)</span>
                </div>
                <button
                  onClick={() => item.count > 0 && setConfirmTarget(item.key)}
                  className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border transition-colors ${item.count > 0 ? 'border-red-300 text-red-500 hover:bg-red-50' : 'border-gray-200 text-gray-300 cursor-not-allowed'}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  クリア
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Main App ---
export default function App() {
  const [currentTab, setCurrentTab] = useState<'map' | 'list' | 'favorites' | 'settings'>('map');
  const [mapResetToken, setMapResetToken] = useState(0);
  const [openBoothNumber, setOpenBoothNumber] = useState<string | null>(null);
  const [myList, setMyList] = useState<MyListState>(() => {
    try {
      const saved = localStorage.getItem('sakenojin-mylist');
      if (saved) {
        const parsed = JSON.parse(saved);
        return { want: new Set(parsed.want || []), went: new Set(parsed.went || []), favorites: new Set(parsed.favorites || []), memos: parsed.memos || {} };
      }
    } catch {}
    return { want: new Set<string>(), went: new Set<string>(), favorites: new Set<string>(), memos: {} as Record<string, string> };
  });

  useEffect(() => {
    const getMeta = (name: string) => document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content?.trim() ?? '';
    const provider = getMeta('analytics-provider');
    if (!provider) return;
    if (navigator.doNotTrack === '1') return;
    if (new URLSearchParams(window.location.search).get('no_analytics') === '1') return;
    if (document.querySelector('script[data-analytics-loader="true"]')) return;

    // Improve source analysis without cookies by normalizing referrer source into the path.
    // Example: "/?utm_source=line" -> "/s/line"
    const url = new URL(window.location.href);
    const sourceRaw =
      url.searchParams.get('utm_source') ||
      url.searchParams.get('source') ||
      url.searchParams.get('utm_campaign') ||
      url.searchParams.get('campaign');
    if (sourceRaw && (url.pathname === '/' || url.pathname === '/index.html')) {
      const source = sourceRaw
        .toLowerCase()
        .replace(/[^a-z0-9-_]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 64);
      if (source) {
        const nextUrl = `/s/${source}${url.hash}`;
        window.history.replaceState({}, '', nextUrl);
      }
    }

    const script = document.createElement('script');
    script.defer = true;
    script.setAttribute('data-analytics-loader', 'true');

    if (provider === 'cloudflare') {
      const token = getMeta('analytics-token');
      if (!token) return;
      script.src = 'https://static.cloudflareinsights.com/beacon.min.js';
      script.setAttribute('data-cf-beacon', JSON.stringify({ token }));
      document.head.appendChild(script);
      return;
    }

    if (provider === 'umami') {
      const websiteId = getMeta('analytics-website-id');
      if (!websiteId) return;
      script.src = getMeta('analytics-src') || 'https://cloud.umami.is/script.js';
      script.setAttribute('data-website-id', websiteId);
      document.head.appendChild(script);
    }
  }, []);

  useEffect(() => {
    // Block browser-level pinch zoom so zoom behavior stays inside the custom map area only.
    const preventGesture = (e: Event) => e.preventDefault();
    const preventMultiTouchZoom = (e: TouchEvent) => {
      if (e.touches.length > 1) {
        e.preventDefault();
      }
    };

    document.addEventListener('gesturestart', preventGesture, { passive: false });
    document.addEventListener('gesturechange', preventGesture, { passive: false });
    document.addEventListener('gestureend', preventGesture, { passive: false });
    document.addEventListener('touchmove', preventMultiTouchZoom, { passive: false });

    return () => {
      document.removeEventListener('gesturestart', preventGesture);
      document.removeEventListener('gesturechange', preventGesture);
      document.removeEventListener('gestureend', preventGesture);
      document.removeEventListener('touchmove', preventMultiTouchZoom);
    };
  }, []);

  const saveMyList = (next: MyListState) => {
    localStorage.setItem('sakenojin-mylist', JSON.stringify({ want: Array.from(next.want), went: Array.from(next.went), favorites: Array.from(next.favorites), memos: next.memos }));
  };

  const toggleMyList = useCallback((boothNum: string, list: 'want' | 'went') => {
    setMyList(prev => {
      const next: MyListState = { want: new Set(prev.want), went: new Set(prev.went), favorites: new Set(prev.favorites), memos: { ...prev.memos } };
      if (next[list].has(boothNum)) {
        next[list].delete(boothNum);
      } else {
        next[list].add(boothNum);
      }
      saveMyList(next);
      return next;
    });
  }, []);

  const toggleFavorite = useCallback((sakeKey: string) => {
    setMyList(prev => {
      const next: MyListState = { want: new Set(prev.want), went: new Set(prev.went), favorites: new Set(prev.favorites), memos: { ...prev.memos } };
      if (next.favorites.has(sakeKey)) {
        next.favorites.delete(sakeKey);
      } else {
        next.favorites.add(sakeKey);
      }
      saveMyList(next);
      return next;
    });
  }, []);

  const updateMemo = useCallback((sakeKey: string, text: string) => {
    setMyList(prev => {
      const next: MyListState = { want: new Set(prev.want), went: new Set(prev.went), favorites: new Set(prev.favorites), memos: { ...prev.memos } };
      if (text.trim()) {
        next.memos[sakeKey] = text;
      } else {
        delete next.memos[sakeKey];
      }
      saveMyList(next);
      return next;
    });
  }, []);

  const clearMyList = useCallback((target: 'want' | 'went' | 'favorites') => {
    setMyList(prev => {
      const next: MyListState = { want: new Set(prev.want), went: new Set(prev.went), favorites: new Set(prev.favorites), memos: { ...prev.memos } };
      next[target] = new Set<string>();
      if (target === 'favorites') {
        next.memos = {};
      }
      saveMyList(next);
      return next;
    });
  }, []);

  const handleMapTabClick = useCallback(() => {
    setCurrentTab('map');
    setMapResetToken(prev => prev + 1);
  }, []);

  const navigateToBooth = useCallback((boothNum: string) => {
    setOpenBoothNumber(boothNum);
    setCurrentTab('map');
  }, []);

  return (
    <div className="w-full flex justify-center bg-gray-300" style={{ height: '100dvh' }}>
      <div className="w-full max-w-md h-full relative flex flex-col shadow-2xl overflow-hidden" style={{ backgroundColor: '#EEEBEA' }}>
        
        {/* Main Content Area */}
        <div className="flex-1 overflow-hidden relative">
          <AnimatePresence mode="wait">
            {currentTab === 'map' && (
              <motion.div key="map" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0">
                <MapView myList={myList} toggleMyList={toggleMyList} toggleFavorite={toggleFavorite} resetToken={mapResetToken} openBoothNumber={openBoothNumber} onOpenBoothHandled={() => setOpenBoothNumber(null)} />
              </motion.div>
            )}
            {currentTab === 'list' && (
              <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0">
                <MyListView myList={myList} toggleMyList={toggleMyList} onBreweryTap={navigateToBooth} />
              </motion.div>
            )}
            {currentTab === 'favorites' && (
              <motion.div key="favorites" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0">
                <FavoritesView myList={myList} toggleFavorite={toggleFavorite} updateMemo={updateMemo} />
              </motion.div>
            )}
            {currentTab === 'settings' && (
              <motion.div key="settings" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0">
                <SettingsView myList={myList} clearMyList={clearMyList} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Bottom Navigation */}
        <div className="h-20 bg-white border-t border-gray-200 flex justify-around items-center px-6 pb-4 pt-2 shrink-0 z-50 relative">
          <button
            className={`flex flex-col items-center gap-1 transition-colors ${currentTab === 'map' ? 'text-amber-700' : 'text-gray-400'}`}
            onClick={handleMapTabClick}
          >
            <MapIcon className="w-6 h-6" />
            <span className="text-[10px] font-medium">マップ</span>
          </button>
          <button
            className={`flex flex-col items-center gap-1 transition-colors ${currentTab === 'list' ? 'text-amber-700' : 'text-gray-400'}`}
            onClick={() => setCurrentTab('list')}
          >
            <List className="w-6 h-6" />
            <span className="text-[10px] font-medium">行きたい！/行った！</span>
          </button>
          <button
            className={`flex flex-col items-center gap-1 transition-colors ${currentTab === 'favorites' ? 'text-amber-700' : 'text-gray-400'}`}
            onClick={() => setCurrentTab('favorites')}
          >
            <Check className="w-6 h-6" />
            <span className="text-[10px] font-medium">飲んだ！</span>
          </button>
          <button
            className={`flex flex-col items-center gap-1 transition-colors ${currentTab === 'settings' ? 'text-amber-700' : 'text-gray-400'}`}
            onClick={() => setCurrentTab('settings')}
          >
            <Settings className="w-6 h-6" />
            <span className="text-[10px] font-medium">説明/管理</span>
          </button>
        </div>
      </div>
    </div>
  );
}
