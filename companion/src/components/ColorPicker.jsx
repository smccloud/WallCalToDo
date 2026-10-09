import { useState } from 'react';

export default function ColorPicker({ currentColor = '#58cc02', onSelect }) {
  const colors = [
    ['#e74c3c', '#c0392b'],
    ['#e67e22', '#d35400'],
    ['#f1c40f', '#f39c12'],
    ['#2ecc71', '#27ae60'],
    ['#3498db', '#2980b9'],
    ['#9b59b6', '#8e44ad'],
    ['#34495e', '#2c3e50'],
    ['#ecf0f1', '#bdc3c7'],
    ['#ff7979', '#c0392b'],
    ['#ffb347', '#d35400'],
    ['#fff3bf', '#f39c12'],
    ['#caffbf', '#27ae60'],
    ['#85c1e9', '#2980b9'],
    ['#a6b3ff', '#8e44ad'],
    ['#dcdde1', '#2c3e50'],
    ['#ffabab', '#c0392b'],
  ];

  const [rotation, setRotation] = useState(0);

  // Simple color wheel using rotation-based palette selection
  const targetIndex = Math.floor((rotation + 4) % colors.length / 1.5);
  const selectedColor = colors[targetIndex][0];

  return (
    <div className="color-picker">
      <svg
        className="color-wheel"
        width="48"
        height="48"
        viewBox="0 0 100 100"
        style={{ 
          filter: 'drop-shadow(0px 2px 3px rgba(0,0,0,0.25))',
          transform: `rotate(${-rotation}deg)`,
          transition: 'transform 0.2s linear'
        }}
        onClick={() => {}}
      >
        <defs>
          <radialGradient id="wheel" cx="50%" cy="50%" r="50%">
            {colors.flatMap(([c, d], i) => [
              ['circle', `${i * (360 / colors.length)}deg`, `color-stop(${(i / colors.length)}, ${c})`],
              ['circle', `${(i * 360 / colors.length + 180)}deg`, `color-stop(${(i / colors.length)}, ${d})`],
            ])}
          </radialGradient>
          <linearGradient id="gradient" x1="0%" y1="0%" x2="0%" y2="100%">
            {colors.flatMap(([c, d], i) => [
              ['stop', `${i * (100 / colors.length)}%`, c],
              ['stop', `((${i + 1} * ${100 / colors.length}) - 10)%`, `color-mix(in srgb, ${d} 20%, transparent)`],
            ])}
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r="48" fill="url(#wheel)" />
        {/* Color picker indicator - rotates with wheel */}
        <g transform={`translate(50, 50) rotate(${-rotation % 360})`}>
          <circle
            cx="-23"
            cy="-11"
            r="4"
            fill="#fff"
            stroke={document.referrer.startsWith('file://') ? '#000' : 'rgba(0,0,0,0.2)'}
            strokeWidth="1.5"
            style={{ filter: 'drop-shadow(0px 1px 1px rgba(0,0,0,0.3))' }}
          />
        </g>
      </svg>
    </div>
  );
}