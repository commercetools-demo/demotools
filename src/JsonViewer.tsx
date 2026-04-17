'use client';

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import type React from 'react';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface JsonNodeProps {
  keyName?: string;
  value: any;
  depth: number;
  defaultExpanded: boolean;
  searchTerm: string;
  path: string;
  expandedPaths: Set<string>;
  togglePath: (path: string) => void;
  matchPaths: Set<string>;
  currentMatchPath: string | null;
}

function isObject(v: any): v is Record<string, any> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isArray(v: any): v is any[] {
  return Array.isArray(v);
}

function highlightMatch(text: string, search: string): React.ReactNode {
  if (!search) return text;
  const idx = text.toLowerCase().indexOf(search.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-orange-600/70 text-white rounded-sm px-0.5">{text.slice(idx, idx + search.length)}</mark>
      {text.slice(idx + search.length)}
    </>
  );
}

/** Add a path and ALL its descendants to the set */
function addAllDescendants(value: any, path: string, result: Set<string>): void {
  result.add(path);
  if (isObject(value)) {
    for (const k of Object.keys(value)) {
      addAllDescendants(value[k], path ? `${path}.${k}` : k, result);
    }
  } else if (isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      addAllDescendants(value[i], `${path}[${i}]`, result);
    }
  }
}

/** Collect all paths that contain a match (the node itself + all ancestors + all descendants of matches) */
function collectMatchPaths(value: any, search: string, path: string, result: Set<string>): boolean {
  if (!search) return false;
  const lc = search.toLowerCase();
  let matched = false;

  if (isObject(value)) {
    for (const k of Object.keys(value)) {
      const childPath = path ? `${path}.${k}` : k;
      if (k.toLowerCase().includes(lc)) {
        matched = true;
        addAllDescendants(value[k], childPath, result);
      }
      if (collectMatchPaths(value[k], search, childPath, result)) {
        matched = true;
      }
    }
  } else if (isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const childPath = `${path}[${i}]`;
      if (collectMatchPaths(value[i], search, childPath, result)) {
        matched = true;
      }
    }
  } else {
    const str = String(value);
    if (str.toLowerCase().includes(lc)) {
      matched = true;
      result.add(path);
    }
  }

  if (matched) result.add(path);
  return matched;
}

/** Collect all leaf match paths in order for next/prev navigation */
function collectLeafMatchPaths(value: any, search: string, path: string, result: string[]): void {
  if (!search) return;
  const lc = search.toLowerCase();

  if (isObject(value)) {
    for (const k of Object.keys(value)) {
      const childPath = path ? `${path}.${k}` : k;
      if (k.toLowerCase().includes(lc) && !isObject(value[k]) && !isArray(value[k])) {
        if (!result.includes(childPath)) result.push(childPath);
      }
      collectLeafMatchPaths(value[k], search, childPath, result);
    }
  } else if (isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      collectLeafMatchPaths(value[i], search, `${path}[${i}]`, result);
    }
  } else {
    if (String(value).toLowerCase().includes(lc)) {
      if (!result.includes(path)) result.push(path);
    }
  }
}

function JsonNode({ keyName, value, depth, defaultExpanded, searchTerm, path, expandedPaths, togglePath, matchPaths, currentMatchPath }: JsonNodeProps) {
  const isObj = isObject(value);
  const isArr = isArray(value);
  const isExpandable = isObj || isArr;

  const expanded = expandedPaths.has(path);
  const isCurrentMatch = currentMatchPath === path;

  const indent = depth * 16;

  if (!isExpandable) {
    let colorClass = 'text-[#d4d4d4]';
    let displayVal: React.ReactNode = String(value);

    if (typeof value === 'string') {
      colorClass = 'text-[#ce9178]';
      displayVal = <>"{highlightMatch(value, searchTerm)}"</>;
    } else if (typeof value === 'number') {
      colorClass = 'text-[#b5cea8]';
      displayVal = highlightMatch(String(value), searchTerm);
    } else if (typeof value === 'boolean') {
      colorClass = 'text-[#569cd6]';
    } else if (value === null) {
      colorClass = 'text-[#569cd6]';
      displayVal = 'null';
    }

    return (
      <div
        id={`json-node-${path}`}
        className={`flex items-start hover:bg-white/5 ${isCurrentMatch ? 'bg-yellow-400/15 ring-1 ring-yellow-400/40 rounded-sm' : ''}`}
        style={{ paddingLeft: indent }}
      >
        {keyName !== undefined && (
          <span className="text-[#9cdcfe] shrink-0">"{highlightMatch(keyName, searchTerm)}"<span className="text-[#d4d4d4]">: </span></span>
        )}
        <span className={colorClass}>{displayVal}</span>
      </div>
    );
  }

  // Sort keys alphabetically at root (depth 0 = the $ wrapper, depth 1 = top-level keys)
  const entries = isArr ? value : (depth <= 1 ? Object.keys(value).sort() : Object.keys(value));
  const count = entries.length;
  const bracket = isArr ? ['[', ']'] : ['{', '}'];
  const preview = isArr
    ? `${count} item${count !== 1 ? 's' : ''}`
    : `${count} key${count !== 1 ? 's' : ''}`;

  return (
    <div>
      <div
        className={`flex items-center cursor-pointer hover:bg-white/5 select-none group relative ${isCurrentMatch ? 'bg-yellow-400/15' : ''}`}
        style={{ paddingLeft: indent }}
        onClick={() => togglePath(path)}
      >
        <span className="absolute w-4 h-4 flex items-center justify-center text-[10px] text-[#858585] transition-transform" style={{ left: indent - 14, transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
          ▶
        </span>
        {keyName !== undefined && (
          <span className="text-[#9cdcfe]">"{highlightMatch(keyName, searchTerm)}"<span className="text-[#d4d4d4]">: </span></span>
        )}
        <span className="text-[#d4d4d4]">{bracket[0]}</span>
        {!expanded && (
          <>
            <span className="text-[#858585] text-[10px] mx-1">{preview}</span>
            <span className="text-[#d4d4d4]">{bracket[1]}</span>
          </>
        )}
      </div>
      {expanded && (
        <>
          {isArr
            ? value.map((item: any, i: number) => {
                const childPath = `${path}[${i}]`;
                if (searchTerm && !matchPaths.has(childPath)) return null;
                return (
                  <JsonNode
                    key={i}
                    value={item}
                    depth={depth + 1}
                    defaultExpanded={defaultExpanded}
                    searchTerm={searchTerm}
                    path={childPath}
                    expandedPaths={expandedPaths}
                    togglePath={togglePath}
                    matchPaths={matchPaths}
                    currentMatchPath={currentMatchPath}
                  />
                );
              })
            : entries.map((k: string) => {
                const childPath = path ? `${path}.${k}` : k;
                if (searchTerm && !matchPaths.has(childPath)) return null;
                return (
                  <JsonNode
                    key={k}
                    keyName={k}
                    value={value[k]}
                    depth={depth + 1}
                    defaultExpanded={defaultExpanded}
                    searchTerm={searchTerm}
                    path={childPath}
                    expandedPaths={expandedPaths}
                    togglePath={togglePath}
                    matchPaths={matchPaths}
                    currentMatchPath={currentMatchPath}
                  />
                );
              })
          }
          <div style={{ paddingLeft: indent }} className="text-[#d4d4d4]">{bracket[1]}</div>
        </>
      )}
    </div>
  );
}

function collectAllPaths(value: any, path: string, result: Set<string>): void {
  result.add(path);
  if (isObject(value)) {
    for (const k of Object.keys(value)) {
      collectAllPaths(value[k], path ? `${path}.${k}` : k, result);
    }
  } else if (isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      collectAllPaths(value[i], `${path}[${i}]`, result);
    }
  }
}

function collectTopPaths(value: any, path: string): Set<string> {
  const result = new Set<string>();
  result.add(path);
  if (isObject(value)) {
    for (const k of Object.keys(value)) {
      result.add(path ? `${path}.${k}` : k);
    }
  } else if (isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      result.add(`${path}[${i}]`);
    }
  }
  return result;
}

export interface JsonViewerProps {
  data: any;
}

export default function JsonViewer({ data }: JsonViewerProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => collectTopPaths(data, '$'));

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchTerm), 200);
    return () => clearTimeout(t);
  }, [searchTerm]);

  const matchPaths = useMemo(() => {
    const result = new Set<string>();
    if (debouncedSearch) {
      collectMatchPaths(data, debouncedSearch, '$', result);
    }
    return result;
  }, [data, debouncedSearch]);

  const leafMatchPaths = useMemo(() => {
    const result: string[] = [];
    if (debouncedSearch) {
      collectLeafMatchPaths(data, debouncedSearch, '$', result);
    }
    return result;
  }, [data, debouncedSearch]);

  const matchCount = leafMatchPaths.length;
  const currentMatchPath = matchCount > 0 ? leafMatchPaths[currentMatchIndex % matchCount] : null;

  useEffect(() => {
    if (debouncedSearch && matchPaths.size > 0) {
      setExpandedPaths(prev => {
        const next = new Set(prev);
        matchPaths.forEach(p => next.add(p));
        return next;
      });
      setCurrentMatchIndex(0);
    }
  }, [debouncedSearch, matchPaths]);

  useEffect(() => {
    if (currentMatchPath) {
      const el = document.getElementById(`json-node-${currentMatchPath}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentMatchPath]);

  const togglePath = useCallback((path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        for (const p of next) {
          if (p === path || p.startsWith(path + '.') || p.startsWith(path + '[')) {
            next.delete(p);
          }
        }
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    const all = new Set<string>();
    collectAllPaths(data, '$', all);
    setExpandedPaths(all);
  }, [data]);

  const collapseAll = useCallback(() => {
    setExpandedPaths(new Set(['$']));
  }, []);

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && matchCount > 0) {
      e.preventDefault();
      setCurrentMatchIndex(prev => (prev + (e.shiftKey ? -1 + matchCount : 1)) % matchCount);
    }
  };

  return (
    <div ref={containerRef}>
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#858585]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search keys or values... (Enter = next, Shift+Enter = prev)"
            className="w-full bg-[#2d2d2d] text-[#d4d4d4] text-xs pl-8 pr-20 py-1.5 rounded-sm border border-[#3e3e3e] focus:border-[#569cd6] focus:outline-none placeholder:text-[#5a5a5a]"
          />
          {searchTerm && (
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
              {debouncedSearch && (
                <span className="text-[10px] text-[#858585]">
                  {matchCount > 0 ? `${(currentMatchIndex % matchCount) + 1}/${matchCount}` : 'No matches'}
                </span>
              )}
              <button
                onClick={() => { setSearchTerm(''); setDebouncedSearch(''); }}
                className="text-[#858585] hover:text-[#d4d4d4] text-xs leading-none"
                title="Clear search"
              >
                ✕
              </button>
            </div>
          )}
        </div>
        {matchCount > 1 && (
          <div className="flex gap-0.5">
            <button
              onClick={() => setCurrentMatchIndex(prev => (prev - 1 + matchCount) % matchCount)}
              className="bg-[#2d2d2d] hover:bg-[#3e3e3e] text-[#d4d4d4] text-xs px-2 py-1.5 rounded-sm border border-[#3e3e3e]"
              title="Previous match"
            >
              ↑
            </button>
            <button
              onClick={() => setCurrentMatchIndex(prev => (prev + 1) % matchCount)}
              className="bg-[#2d2d2d] hover:bg-[#3e3e3e] text-[#d4d4d4] text-xs px-2 py-1.5 rounded-sm border border-[#3e3e3e]"
              title="Next match"
            >
              ↓
            </button>
          </div>
        )}
        <div className="flex gap-0.5">
          <button
            onClick={expandAll}
            className="bg-[#2d2d2d] hover:bg-[#3e3e3e] text-[#d4d4d4] text-[10px] px-2 py-1.5 rounded-sm border border-[#3e3e3e]"
          >
            Expand All
          </button>
          <button
            onClick={collapseAll}
            className="bg-[#2d2d2d] hover:bg-[#3e3e3e] text-[#d4d4d4] text-[10px] px-2 py-1.5 rounded-sm border border-[#3e3e3e]"
          >
            Collapse All
          </button>
        </div>
        <button
          onClick={() => {
            navigator.clipboard.writeText(JSON.stringify(data, null, 2));
            const btn = document.getElementById('json-copy-btn');
            if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy'; }, 2000); }
          }}
          id="json-copy-btn"
          className="bg-[#2d2d2d] hover:bg-[#3e3e3e] text-[#d4d4d4] text-[10px] px-2 py-1.5 rounded-sm border border-[#3e3e3e]"
        >
          Copy
        </button>
      </div>

      <div className="bg-[#1e1e1e] rounded-sm p-3 overflow-x-auto text-xs font-mono leading-relaxed">
        <JsonNode
          value={data}
          depth={0}
          defaultExpanded={true}
          searchTerm={debouncedSearch}
          path="$"
          expandedPaths={expandedPaths}
          togglePath={togglePath}
          matchPaths={matchPaths}
          currentMatchPath={currentMatchPath}
        />
      </div>
    </div>
  );
}
