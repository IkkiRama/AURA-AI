import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AlignmentState, SpeechScript } from './alignment';
import {
  AUTO_FOLLOW_CONFIDENCE, AUTO_FOLLOW_INTERVAL_MS, followDuration, followTarget, manualScrollWait,
} from './scroll';
import './speech.css';

export interface SpeechScrollState {
  lastManualScrollAt: number | null;
  isAutoFollowPaused: boolean;
}

interface SpeechTextProps {
  script: SpeechScript;
  alignment: Pick<AlignmentState, 'activeWordIndex' | 'activePhraseIndex' | 'confirmedPosition' | 'alignmentConfidence' | 'status'>;
  highlightMode: 'word' | 'phrase';
  scrollMode: 'auto' | 'manual';
  sensitivity?: number;
  smoothness?: number;
  autoFollowEnabled?: boolean;
  resumeRequest?: number;
  onScrollStateChange?: (state: SpeechScrollState) => void;
}

const scrollKeys = new Set(['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' ']);

export function SpeechText(props: SpeechTextProps) {
  return <SpeechViewport key={props.script.text} {...props} />;
}

function SpeechViewport({
  script, alignment, highlightMode, scrollMode, sensitivity = 0.5, smoothness = 0.5,
  autoFollowEnabled = true, resumeRequest, onScrollStateChange,
}: SpeechTextProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const copy = useRef<HTMLParagraphElement>(null);
  const active = useRef<HTMLSpanElement>(null);
  const animation = useRef<number | null>(null);
  const programmaticTop = useRef<number | null>(null);
  const dimensions = useRef({ height: 0, scrollHeight: 0 });
  const pointerId = useRef<number | null>(null);
  const lastMovement = useRef(-Infinity);
  const lastManualAt = useRef<number | null>(null);
  const lastResumeRequest = useRef(resumeRequest);
  const reportScrollState = useRef(onScrollStateChange);
  const [manualPaused, setManualPaused] = useState(false);
  const [measureVersion, setMeasureVersion] = useState(0);
  const requestMeasurement = () => setMeasureVersion((version) => version + 1);
  const groups = useMemo(() => {
    const ranges = highlightMode === 'word'
      ? script.words.map((_, index) => ({ startWord: index, endWord: index })) : script.phrases;
    return ranges.map(({ startWord, endWord }) => {
      const start = script.words[startWord].start;
      const end = script.words[endWord + 1]?.start ?? script.text.length;
      return { start, endWord, text: script.text.slice(start, end) };
    });
  }, [highlightMode, script]);
  const activeIndex = highlightMode === 'word' ? alignment.activeWordIndex : alignment.activePhraseIndex;

  useLayoutEffect(() => { reportScrollState.current = onScrollStateChange; }, [onScrollStateChange]);

  const stopAnimation = useCallback(() => {
    if (animation.current === null) return;
    cancelAnimationFrame(animation.current);
    animation.current = null;
  }, []);

  const markManualScroll = useCallback(() => {
    if (scrollMode !== 'auto') return;
    stopAnimation();
    const now = Date.now();
    lastManualAt.current = now;
    setManualPaused(true);
    reportScrollState.current?.({ lastManualScrollAt: now, isAutoFollowPaused: true });
  }, [scrollMode, stopAnimation]);

  const resume = useCallback(() => {
    lastManualAt.current = null;
    setManualPaused(false);
    reportScrollState.current?.({ lastManualScrollAt: null, isAutoFollowPaused: false });
    requestMeasurement();
  }, []);

  useEffect(() => {
    if (lastResumeRequest.current === resumeRequest) return;
    lastResumeRequest.current = resumeRequest;
    resume();
  }, [resume, resumeRequest]);

  useLayoutEffect(() => {
    const box = viewport.current;
    if (!box) return;
    const observer = new ResizeObserver(() => {
      dimensions.current = { height: box.clientHeight, scrollHeight: box.scrollHeight };
      programmaticTop.current = box.scrollTop;
      requestMeasurement();
    });
    observer.observe(box);
    if (copy.current) observer.observe(copy.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    function releasePointer(event: PointerEvent) {
      if (event.pointerId !== pointerId.current) return;
      pointerId.current = null;
      if (lastManualAt.current !== null) markManualScroll();
      requestMeasurement();
    }
    window.addEventListener('pointerup', releasePointer);
    window.addEventListener('pointercancel', releasePointer);
    window.addEventListener('blur', releaseOnBlur);
    function releaseOnBlur() {
      if (pointerId.current === null) return;
      pointerId.current = null;
      requestMeasurement();
    }
    return () => {
      stopAnimation();
      window.removeEventListener('pointerup', releasePointer);
      window.removeEventListener('pointercancel', releasePointer);
      window.removeEventListener('blur', releaseOnBlur);
    };
  }, [markManualScroll, stopAnimation]);

  useEffect(() => {
    if (scrollMode !== 'auto' || !autoFollowEnabled || alignment.status !== 'FOLLOWING') {
      stopAnimation();
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = () => {
      const box = viewport.current;
      const cursor = active.current;
      if (!box || !cursor || pointerId.current !== null || alignment.alignmentConfidence < AUTO_FOLLOW_CONFIDENCE) return;
      const now = Date.now();
      const wait = Math.max(manualScrollWait(lastManualAt.current, now), lastMovement.current + AUTO_FOLLOW_INTERVAL_MS - now);
      if (wait > 0 || animation.current !== null) {
        timer = setTimeout(attempt, Math.max(wait, 48));
        return;
      }
      if (manualPaused) {
        setManualPaused(false);
        reportScrollState.current?.({ lastManualScrollAt: lastManualAt.current, isAutoFollowPaused: false });
      }

      const bounds = box.getBoundingClientRect();
      const reading = cursor.getBoundingClientRect();
      const from = box.scrollTop;
      const target = followTarget({
        scrollTop: from, viewportHeight: box.clientHeight, contentHeight: box.scrollHeight,
        activeTop: reading.top - bounds.top, activeBottom: reading.bottom - bounds.top,
      }, sensitivity);
      if (target === null) return;

      lastMovement.current = now;
      const setPosition = (top: number) => {
        box.scrollTop = top;
        programmaticTop.current = box.scrollTop;
      };
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setPosition(target);
        return;
      }
      const duration = followDuration(smoothness, target - from);
      const startedAt = performance.now();
      const animate = (tickAt: number) => {
        const progress = Math.min(1, Math.max(0, (tickAt - startedAt) / duration));
        const eased = 1 - (1 - progress) ** 3;
        setPosition(from + (target - from) * eased);
        animation.current = progress < 1 ? requestAnimationFrame(animate) : null;
      };
      animation.current = requestAnimationFrame(animate);
    };
    attempt();
    return () => clearTimeout(timer);
  }, [
    activeIndex, alignment.alignmentConfidence, alignment.status, autoFollowEnabled, manualPaused, measureVersion,
    scrollMode, sensitivity, smoothness, stopAnimation,
  ]);

  return <div className="aura-speech-text">
    <div ref={viewport} className="aura-speech-viewport" role="region" aria-label="Naskah teleprompter" tabIndex={0}
      onWheel={(event) => {
        const box = event.currentTarget;
        if (event.deltaY !== 0 && box.scrollHeight > box.clientHeight) markManualScroll();
      }}
      onKeyDown={(event) => {
        const box = event.currentTarget;
        if (scrollKeys.has(event.key) && box.scrollHeight > box.clientHeight) markManualScroll();
      }}
      onPointerDown={(event) => {
        const box = event.currentTarget;
        const onScrollbar = event.clientX > box.getBoundingClientRect().left + box.clientWidth;
        if (box.scrollHeight <= box.clientHeight || (event.pointerType !== 'touch' && !onScrollbar)) return;
        pointerId.current = event.pointerId;
        stopAnimation();
        if (onScrollbar) markManualScroll();
      }}
      onScroll={(event) => {
        const box = event.currentTarget;
        const sizeChanged = box.clientHeight !== dimensions.current.height || box.scrollHeight !== dimensions.current.scrollHeight;
        const fromAnimation = programmaticTop.current !== null && Math.abs(programmaticTop.current - box.scrollTop) < 0.5;
        if (sizeChanged || fromAnimation) return;
        programmaticTop.current = null;
        markManualScroll();
      }}>
      <p ref={copy} className="aura-answer-text aura-speech-copy">
        {script.text.slice(0, groups[0]?.start ?? script.text.length)}
        {groups.map((group, index) => {
          const position = index === activeIndex ? 'active' : group.endWord <= alignment.confirmedPosition ? 'complete' : 'pending';
          return <span key={group.start} ref={position === 'active' ? active : undefined} data-speech-position={position}>{group.text}</span>;
        })}
      </p>
    </div>
    {scrollMode === 'auto' && manualPaused && <button type="button" className="aura-button aura-speech-resume" onClick={resume}>Resume Auto Follow</button>}
  </div>;
}
