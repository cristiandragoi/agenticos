import React, { memo, useEffect, useRef } from 'react';
import type { JarvisState, Severity } from './JarvisTypes';
import { stateColor, CHANNELS } from './JarvisState';
import type { JarvisAnimationFrame } from './useJarvisAnimation';

interface Props {
  state: JarvisState;
  severity: Severity;
  speakingLevel: number;
  thinkingIntensity: number;
  subscribe: (fn: (f: JarvisAnimationFrame) => void) => () => void;
}

const faceDots = [
  [500,160],[455,178],[545,178],[420,215],[580,215],[438,252],[562,252],
  [465,292],[535,292],[500,325],[470,350],[530,350],[448,385],[552,385],
  [500,405],[465,430],[535,430],[500,455],[455,485],[545,485],
];

const brainLinks = [
  [500,160,455,178],[500,160,545,178],[455,178,420,215],[545,178,580,215],
  [455,178,438,252],[545,178,562,252],[438,252,465,292],[562,252,535,292],
  [465,292,500,325],[535,292,500,325],[420,215,500,325],[580,215,500,325],
];

const torsoDots = [
  [500,560],[450,575],[550,575],[398,600],[602,600],[350,630],[650,630],
  [410,650],[590,650],[465,680],[535,680],[500,720],[420,745],[580,745],
];

export const JarvisHumanoid = memo(function JarvisHumanoid({
  state,
  severity,
  speakingLevel,
  thinkingIntensity,
  subscribe,
}: Props) {
  const rootRef = useRef<SVGGElement | null>(null);
  const brainRef = useRef<SVGGElement | null>(null);
  const eyesRef = useRef<SVGGElement | null>(null);
  const chestRef = useRef<SVGGElement | null>(null);
  const mouthRef = useRef<SVGPathElement | null>(null);

  const color = stateColor(state, severity);

  useEffect(() => {
    return subscribe((f) => {
      const root = rootRef.current;
      if (!root) return;
      root.style.setProperty('--pulse', String(f.pulse));
      root.style.setProperty('--breath', String(f.breath));

      if (brainRef.current) {
        const b = state === 'thinking' || state === 'researching' || state === 'executing'
          ? 0.65 + thinkingIntensity * 0.9 + f.pulse * 0.35
          : 0.42 + f.pulse * 0.18;
        brainRef.current.style.opacity = String(Math.min(1, b));
      }

      if (eyesRef.current) {
        const e = state === 'listening' ? 1 : state === 'speaking' ? 0.75 + speakingLevel * 0.25 : 0.62 + f.eye * 0.25;
        eyesRef.current.style.opacity = String(Math.min(1, e));
      }

      if (chestRef.current) {
        const c = 0.55 + f.breath * 0.25 + (state === 'speaking' ? speakingLevel * 0.35 : 0);
        chestRef.current.style.opacity = String(Math.min(1, c));
      }

      if (mouthRef.current) {
        const open = state === 'speaking' ? 3 + speakingLevel * 7 : 2;
        mouthRef.current.setAttribute('d', `M 472 420 Q 500 ${420 + open} 528 420`);
      }
    });
  }, [state, speakingLevel, thinkingIntensity, subscribe]);

  return (
    <g ref={rootRef} className="jhv-humanoid" style={{ color }}>
      <defs>
        <filter id="jhvGlow" x="-120%" y="-120%" width="340%" height="340%">
          <feGaussianBlur stdDeviation="5" result="blur" />
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="jhvSoftGlow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="2.3" result="blur" />
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <radialGradient id="jhvCore">
          <stop offset="0%" stopColor="#ffffff"/>
          <stop offset="22%" stopColor={color}/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </radialGradient>
      </defs>

      {/* Shoulder / bust silhouette */}
      <g className="jhv-shell" fill="none" stroke="currentColor">
        <path d="M 205 810
                 C 240 720 305 675 390 648
                 C 414 640 433 620 438 592
                 L 445 535
                 C 412 508 392 470 382 425
                 L 370 315
                 C 366 212 420 124 500 112
                 C 580 124 634 212 630 315
                 L 618 425
                 C 608 470 588 508 555 535
                 L 562 592
                 C 567 620 586 640 610 648
                 C 695 675 760 720 795 810"
              strokeWidth="2.4" opacity="0.9" filter="url(#jhvSoftGlow)"/>
        <path d="M 395 220 C 430 155 570 155 605 220" strokeWidth="1.1" opacity="0.35"/>
        <path d="M 382 314 C 355 300 346 332 362 365 C 367 376 377 384 389 386" strokeWidth="1.8"/>
        <path d="M 618 314 C 645 300 654 332 638 365 C 633 376 623 384 611 386" strokeWidth="1.8"/>
        <path d="M 428 485 C 462 520 538 520 572 485" strokeWidth="1.2" opacity="0.5"/>
        <path d="M 455 534 C 470 548 530 548 545 534" strokeWidth="1.0" opacity="0.5"/>
      </g>

      {/* Face geometry */}
      <g className="jhv-face" fill="none" stroke="currentColor" filter="url(#jhvSoftGlow)">
        <path d="M 500 182 L 500 392" strokeWidth="0.9" opacity="0.35"/>
        <path d="M 438 274 Q 466 253 491 274" strokeWidth="1.6"/>
        <path d="M 509 274 Q 534 253 562 274" strokeWidth="1.6"/>
        <path d="M 500 289 C 493 317 487 344 479 362 Q 500 374 521 362" strokeWidth="1.1" opacity="0.75"/>
        <path d="M 458 391 Q 500 407 542 391" strokeWidth="0.9" opacity="0.55"/>
        <path ref={mouthRef} d="M 472 420 Q 500 422 528 420" strokeWidth="1.6"/>
        <path d="M 470 435 Q 500 443 530 435" strokeWidth="0.8" opacity="0.35"/>
        <path d="M 420 230 Q 450 205 480 210" strokeWidth="0.9" opacity="0.45"/>
        <path d="M 580 230 Q 550 205 520 210" strokeWidth="0.9" opacity="0.45"/>
      </g>

      {/* Eyes */}
      <g ref={eyesRef} className="jhv-eyes" filter="url(#jhvGlow)">
        <ellipse cx="463" cy="282" rx="12" ry="4.4" fill={color}/>
        <ellipse cx="537" cy="282" rx="12" ry="4.4" fill={color}/>
        <circle cx="463" cy="282" r="2.3" fill="#fff"/>
        <circle cx="537" cy="282" r="2.3" fill="#fff"/>
      </g>

      {/* Brain core & neural mesh */}
      <g ref={brainRef} className="jhv-brain" stroke="currentColor" fill="none" filter="url(#jhvSoftGlow)">
        {brainLinks.map((l, i) => (
          <line key={i} x1={l[0]} y1={l[1]} x2={l[2]} y2={l[3]} strokeWidth="0.8" opacity="0.58"/>
        ))}
        {faceDots.map(([x,y], i) => (
          <g key={i}>
            <circle cx={x} cy={y} r={i === 0 ? 3.8 : 2.0} fill={i === 0 ? '#fff' : color} stroke="none"/>
            {i % 4 === 0 && <circle cx={x} cy={y} r="7" stroke={color} opacity="0.18"/>}
          </g>
        ))}
        <circle cx="500" cy="160" r="23" fill="url(#jhvCore)" stroke="none" opacity="0.9"/>
        <circle cx="500" cy="160" r="8" fill="#fff" stroke="none"/>
      </g>

      {/* Facial neural traces */}
      <g className="jhv-face-neurons" stroke="currentColor" fill="none" opacity="0.46">
        <path d="M500 160 C470 215 450 250 438 310"/>
        <path d="M500 160 C530 215 550 250 562 310"/>
        <path d="M438 310 C460 338 471 367 470 405"/>
        <path d="M562 310 C540 338 529 367 530 405"/>
        <path d="M470 405 C485 430 492 457 500 500"/>
        <path d="M530 405 C515 430 508 457 500 500"/>
      </g>

      {/* Neck + torso neural pathways */}
      <g className="jhv-torso-neurons" stroke="currentColor" fill="none" opacity="0.5">
        <path d="M500 500 L500 720" strokeWidth="1.1"/>
        <path d="M465 530 C448 585 430 625 398 665"/>
        <path d="M535 530 C552 585 570 625 602 665"/>
        <path d="M500 590 C455 620 420 638 360 655"/>
        <path d="M500 590 C545 620 580 638 640 655"/>
        <path d="M500 675 C455 700 410 720 325 744"/>
        <path d="M500 675 C545 700 590 720 675 744"/>
        {torsoDots.map(([x,y],i)=><circle key={i} cx={x} cy={y} r={i===11?3.5:1.9} fill={color} stroke="none"/>)}
      </g>

      {/* Chest core */}
      <g ref={chestRef} className="jhv-chest" filter="url(#jhvGlow)">
        <circle cx="500" cy="648" r="42" fill="url(#jhvCore)" opacity="0.75"/>
        <circle cx="500" cy="648" r="12" fill="#fff"/>
        <circle cx="500" cy="648" r="24" fill="none" stroke={color} strokeWidth="1.2" opacity="0.65"/>
      </g>

      {/* lower hologram beam */}
      <g opacity="0.6" stroke="currentColor" fill="none">
        <path d="M 500 688 C 484 732 475 774 500 820 C 525 774 516 732 500 688" opacity="0.35"/>
        <ellipse cx="500" cy="822" rx="135" ry="22" opacity="0.35"/>
        <ellipse cx="500" cy="822" rx="86" ry="14" opacity="0.45"/>
        <ellipse cx="500" cy="822" rx="38" ry="7" opacity="0.8"/>
      </g>
    </g>
  );
});
